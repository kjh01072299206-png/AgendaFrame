import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import sourcePanel from "../data/sources.json" with { type: "json" };
import { ANALYSIS_MODEL_VERSION, ANALYSIS_PROVIDER, analyzeArticles, titleTokens } from "../worker/analysis.mjs";
import { getAnalysisProvider } from "../worker/analysis-provider.mjs";
import { calculateQualityMetrics, canonicalizeArticleUrl, configureSourcePanel, handleApiRequest, validateImportRows } from "../worker/runtime.mjs";

configureSourcePanel(sourcePanel);

test("builds the real React dashboard and admin application", async () => {
  const manifest = JSON.parse(await readFile(new URL("../dist/client/.vite/manifest.json", import.meta.url), "utf8"));
  const builtFiles = Object.values(manifest).flatMap((entry) => [entry.file, ...(entry.css ?? [])]).join("\n");
  assert.match(builtFiles, /agenda-dashboard/);
  assert.match(builtFiles, /admin-client/);

  const worker = await readFile(new URL("../dist/server/index.js", import.meta.url), "utf8");
  assert.match(worker, /\/api\/analyze/);
  assert.match(worker, /rules_local/);
  assert.match(worker, /agenda-rules-v1/);
  assert.match(worker, /\/api\/quality/);
});

test("packages Sites hosting metadata and both database migrations", async () => {
  const hosting = JSON.parse(await readFile(new URL("../dist/.openai/hosting.json", import.meta.url), "utf8"));
  assert.equal(hosting.project_id, "appgprj_6a54eb02c21c819199c3369cc67c6857");
  assert.equal(hosting.d1, "DB");
  assert.equal(hosting.r2, null);
  const migration = await readFile(new URL("../dist/.openai/drizzle/0001_easy_dexter_bennett.sql", import.meta.url), "utf8");
  for (const table of ["analysis_runs", "issues", "issue_articles", "frame_analyses", "ai_reports"]) {
    assert.ok(migration.includes(`CREATE TABLE \`${table}\``));
  }
  const qualityMigration = await readFile(new URL("../dist/.openai/drizzle/0002_colorful_master_mold.sql", import.meta.url), "utf8");
  for (const table of ["quality_reviews", "quality_review_article_flags", "quality_review_missing_articles"]) {
    assert.ok(qualityMigration.includes(`CREATE TABLE \`${table}\``));
  }
});

test("calculates transparent human-review quality estimates", () => {
  const metrics = calculateQualityMetrics([
    { reviewId: "r1", articleCount: 10, misplacedCount: 2, missingCount: 1, sourceCount: 5, clusterVerdict: "correct", agendaVerdict: "appropriate", frameVerdict: "appropriate" },
    { reviewId: "r2", articleCount: 5, misplacedCount: 0, missingCount: 4, sourceCount: 3, clusterVerdict: "partial", agendaVerdict: "overstated", frameVerdict: "partial" },
    { reviewId: null, articleCount: 20, misplacedCount: 0, missingCount: 0, sourceCount: 5 },
  ]);
  assert.equal(metrics.reviewedIssueCount, 2);
  assert.equal(metrics.reviewedArticleCount, 15);
  assert.equal(metrics.misplacedArticleCount, 2);
  assert.equal(metrics.missingArticleCount, 5);
  assert.equal(metrics.estimatedPrecision, 86.7);
  assert.equal(metrics.estimatedRecall, 72.2);
  assert.equal(metrics.clusterAgreement, 75);
  assert.equal(metrics.agendaAgreement, 50);
  assert.equal(metrics.frameAgreement, 75);
  assert.equal(metrics.sourceDiversityCoverage, 80);
  assert.equal(metrics.progressPercent, 4);
  assert.equal(metrics.sampleStatus, "collecting");
});

test("clusters real-looking article titles and produces explainable scores", () => {
  const articles = [
    { id: "a1", sourceId: "hani", source: "한겨레", title: "정부 청년 주거 지원 정책 확대 발표", section: "정치>행정", homepagePlacement: "top" },
    { id: "a2", sourceId: "khan", source: "경향신문", title: "정부, 청년 주거 지원 정책 확대", section: "정치>행정", homepagePlacement: "main" },
    { id: "a3", sourceId: "chosun", source: "조선일보", title: "청년 주거 지원 확대…정부 정책 효과는", section: "정치>행정", homepagePlacement: "section" },
    { id: "a4", sourceId: "joongang", source: "중앙일보", title: "한국은행 기준금리 동결 결정", section: "경제>금융", homepagePlacement: "list" },
  ];
  const issues = analyzeArticles(articles, { configuredSourceCount: 5 });
  const housing = issues.find((issue) => issue.articleCount === 3);
  assert.ok(housing);
  assert.equal(housing.sourceCount, 3);
  assert.equal(housing.diversityScore, 60);
  assert.equal(housing.frames.length, 6);
  assert.equal(housing.articles.filter((article) => article.representative).length, 1);
  assert.match(housing.report.summary, /규칙 분석/);
  assert.match(housing.report.caution, /Vertex AI/);
  assert.ok(housing.agendaScore > issues.find((issue) => issue.articleCount === 1).agendaScore);
  assert.deepEqual(titleTokens("[단독] 정부의 청년 주거지원 정책 발표"), ["청년", "주거지원", "정책", "발표"]);
  assert.equal(ANALYSIS_PROVIDER, "rules_local");
  assert.equal(ANALYSIS_MODEL_VERSION, "agenda-rules-v1");
  assert.equal(getAnalysisProvider().analyze, analyzeArticles);
  assert.throws(() => getAnalysisProvider("vertex_ai"), /지원하지 않는 분석 공급자/);
});

test("validates metadata-only imports and canonicalizes duplicate URLs", () => {
  const [row] = validateImportRows([{
    source: "한겨레",
    title: "검증용 기사 제목",
    url: "https://www.hani.co.kr/arti/politics/test.html?utm_source=test&b=2#headline",
    published_at: "2026-07-14T09:30:00+09:00",
    collected_at: "2026-07-14T10:00:00+09:00",
    section: "정치",
    homepage_placement: "TOP",
    homepage_rank: "1",
  }]);
  assert.equal(row.source.id, "hani");
  assert.equal(row.canonicalUrl, "https://www.hani.co.kr/arti/politics/test.html?b=2");
  assert.equal(row.homepagePlacement, "top");
  assert.equal(row.homepageRank, 1);
  assert.equal(canonicalizeArticleUrl("https://example.com/a?utm_medium=x&b=2"), "https://example.com/a?b=2");

  assert.throws(() => validateImportRows([{ source: "한겨레", title: "다른 도메인", url: "https://example.com/article", published_at: "2026-07-14" }]), /공식 도메인/);
  assert.throws(() => validateImportRows([{ source: "한겨레", title: "본문 포함", url: "https://www.hani.co.kr/arti/test.html", published_at: "2026-07-14", content: "저장하면 안 되는 기사 본문" }]), /기사 본문/);
});

test("reports no-cost health and protects write endpoints", async () => {
  const health = await handleApiRequest(new Request("https://example.test/api/health"));
  assert.equal(health.status, 200);
  const healthBody = await health.json();
  assert.equal(healthBody.status, "ok");
  assert.equal(healthBody.mode, "demo");
  assert.equal(healthBody.collection.method, "bigkinds_export");
  assert.equal(healthBody.collection.directCrawling, false);
  assert.equal(healthBody.collection.configuredSources, 5);

  const sources = await handleApiRequest(new Request("https://example.test/api/sources"));
  const sourceBody = await sources.json();
  assert.equal(sourceBody.sources.length, 5);
  assert.ok(sourceBody.sources.every((source) => !("domains" in source)));

  const unavailable = await handleApiRequest(new Request("https://example.test/api/analyze", { method: "POST" }));
  assert.equal(unavailable.status, 503);
  const unauthorized = await handleApiRequest(new Request("https://example.test/api/import", {
    method: "POST",
    headers: { authorization: "Bearer wrong", "content-type": "application/json", origin: "https://example.test" },
    body: JSON.stringify({ rows: [] }),
  }), { DB: {}, IMPORT_TOKEN: "correct" });
  assert.equal(unauthorized.status, 401);
  const qualityUnauthorized = await handleApiRequest(new Request("https://example.test/api/quality?date=2026-07-14", {
    headers: { authorization: "Bearer wrong", origin: "https://example.test" },
  }), { DB: {}, IMPORT_TOKEN: "correct" });
  assert.equal(qualityUnauthorized.status, 401);

  const missing = await handleApiRequest(new Request("https://example.test/api/missing"));
  assert.equal(missing.status, 404);
});

test("filters and paginates the complete article collection", async () => {
  const statements = [];
  const article = { id: "article-1", sourceId: "hani", source: "한겨레", title: "주거 정책 기사", url: "https://www.hani.co.kr/arti/politics/test.html", section: "정치_국회", publishedAt: Date.parse("2026-07-14T17:44:48+09:00"), collectedAt: Date.parse("2026-07-14T18:00:00+09:00"), homepagePlacement: null, homepageRank: null };
  const DB = {
    prepare(sql) {
      return {
        bind(...parameters) {
          statements.push({ sql, parameters });
          return sql.includes("COUNT(*)") ? { first: async () => ({ total: 123 }) } : { all: async () => ({ results: [article] }) };
        },
      };
    },
  };

  const response = await handleApiRequest(new Request("https://example.test/api/articles?limit=25&offset=50&source=%ED%95%9C%EA%B2%A8%EB%A0%88&section=%EC%A0%95%EC%B9%98&q=%EC%A3%BC%EA%B1%B0&date=2026-07-14"), { DB });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.total, 123);
  assert.equal(body.limit, 25);
  assert.equal(body.offset, 50);
  assert.equal(body.hasMore, true);
  assert.deepEqual(body.articles, [article]);
  assert.equal(statements.length, 2);
  assert.match(statements[0].sql, /a\.source_id = \?/);
  assert.match(statements[0].sql, /a\.section LIKE \?/);
  assert.match(statements[0].sql, /a\.title LIKE \?/);
  assert.match(statements[0].sql, /a\.published_at >= \?/);
  assert.deepEqual(statements[1].parameters.slice(-2), [25, 50]);
});
