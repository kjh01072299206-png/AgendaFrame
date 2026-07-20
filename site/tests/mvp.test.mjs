import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import sourcePanel from "../data/sources.json" with { type: "json" };
import { ANALYSIS_MODEL_VERSION, ANALYSIS_PROVIDER, analyzeArticles, titleTokens } from "../worker/analysis.mjs";
import { getAnalysisProvider } from "../worker/analysis-provider.mjs";
import { calculateQualityMetrics, canonicalizeArticleUrl, classifySnapshotStatus, configureSourcePanel, enumerateKstDates, handleApiRequest, validateImportRows, withDocumentSecurityHeaders, withSecurityHeaders } from "../worker/runtime.mjs";

configureSourcePanel(sourcePanel);

test("builds the real React dashboard and admin application", async () => {
  const manifest = JSON.parse(await readFile(new URL("../dist/client/.vite/manifest.json", import.meta.url), "utf8"));
  const builtFiles = Object.values(manifest).flatMap((entry) => [entry.file, ...(entry.css ?? [])]).join("\n");
  assert.match(builtFiles, /agenda-dashboard/);
  assert.match(builtFiles, /admin-client/);

  const worker = await readFile(new URL("../dist/server/index.js", import.meta.url), "utf8");
  assert.match(worker, /\/api\/analyze/);
  assert.match(worker, /rules_local/);
  assert.match(worker, /agenda-rules-v3/);
  assert.match(worker, /\/api\/quality/);
  assert.match(worker, /\/api\/analysis\/runs/);
});

test("keeps the public dashboard readable, evidence-first, and explicit about limits", async () => {
  const dashboard = await readFile(new URL("../app/agenda-dashboard.tsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

  for (const copy of ["같은 사건,", "근거가 부족한 분석은", "승인 본문", "사람 검토", "중요도·사실성·여론을 뜻하지 않습니다"]) {
    assert.match(dashboard, new RegExp(copy));
  }
  assert.match(dashboard, /22개 주요 종합일간지·경제매체·뉴스통신사/);
  assert.match(dashboard, /fetch\("\/api\/sources"/);
  assert.doesNotMatch(dashboard, /\["한겨레","경향신문","한국일보","중앙일보","조선일보"\]/);
  assert.match(dashboard, /<details className="score-details">/);
  assert.match(dashboard, /role="tab"/);
  assert.match(dashboard, /aria-controls={`analysis-panel-/);
  assert.doesNotMatch(dashboard, /신뢰도 \{/);
  assert.doesNotMatch(dashboard, /agenda-list" aria-live/);

  assert.match(styles, /\.hero-copy, \.snapshot \{ min-width: 0; \}/);
  assert.match(styles, /@media \(max-width: 780px\)/);
  assert.match(styles, /\.live-filter-form input, \.live-filter-form select \{ font-size: 16px; \}/);
  assert.match(styles, /min-height: 44px/);
});

test("packages Sites hosting metadata and database migrations", async () => {
  const hosting = JSON.parse(await readFile(new URL("../dist/.openai/hosting.json", import.meta.url), "utf8"));
  assert.equal(hosting.project_id, "appgprj_6a54eb02c21c819199c3369cc67c6857");
  assert.equal(hosting.d1, "DB");
  assert.equal(hosting.r2, "CONTENT");
  const migration = await readFile(new URL("../dist/.openai/drizzle/0001_easy_dexter_bennett.sql", import.meta.url), "utf8");
  for (const table of ["analysis_runs", "issues", "issue_articles", "frame_analyses", "ai_reports"]) {
    assert.ok(migration.includes(`CREATE TABLE \`${table}\``));
  }
  const qualityMigration = await readFile(new URL("../dist/.openai/drizzle/0002_colorful_master_mold.sql", import.meta.url), "utf8");
  for (const table of ["quality_reviews", "quality_review_article_flags", "quality_review_missing_articles"]) {
    assert.ok(qualityMigration.includes(`CREATE TABLE \`${table}\``));
  }
  const evidenceMigration = await readFile(new URL("../dist/.openai/drizzle/0003_complex_mikhail_rasputin.sql", import.meta.url), "utf8");
  for (const table of ["homepage_snapshots", "placement_observations", "article_contents"]) {
    assert.ok(evidenceMigration.includes(`CREATE TABLE \`${table}\``));
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
  assert.equal(metrics.overmergeRate, 13.3);
  assert.equal(metrics.undermergeRate, 27.8);
  assert.equal(metrics.pairwiseF1, null);
  assert.equal(metrics.hardNegativeAccuracy, null);
  assert.equal(metrics.clusterAgreement, 75);
  assert.equal(metrics.agendaAgreement, 50);
  assert.equal(metrics.frameAgreement, 75);
  assert.equal(metrics.sourceDiversityCoverage, 80);
  assert.equal(metrics.progressPercent, 4);
  assert.equal(metrics.sampleStatus, "collecting");
});

test("enumerates safe resumable KST analysis ranges", () => {
  assert.deepEqual(enumerateKstDates("2026-07-08", "2026-07-14", 7), [
    "2026-07-08", "2026-07-09", "2026-07-10", "2026-07-11", "2026-07-12", "2026-07-13", "2026-07-14",
  ]);
  assert.throws(() => enumerateKstDates("2026-07-14", "2026-07-08", 7), /종료일/);
  assert.throws(() => enumerateKstDates("2026-07-01", "2026-07-08", 7), /최대 7일/);
  assert.throws(() => enumerateKstDates("2026-02-30", "2026-03-01", 7), /유효한 분석 기간/);
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
  assert.match(housing.report.summary, /제목/);
  assert.match(housing.report.caution, /제목 표현/);
  assert.ok(housing.agendaScore > issues.find((issue) => issue.articleCount === 1).agendaScore);
  assert.deepEqual(titleTokens("[단독] 정부의 청년 주거지원 정책 발표"), ["청년", "주거지원", "정책", "발표"]);
  assert.equal(ANALYSIS_PROVIDER, "rules_local");
  assert.equal(ANALYSIS_MODEL_VERSION, "agenda-rules-v3");
  assert.equal(getAnalysisProvider().analyze, analyzeArticles);
  assert.throws(() => getAnalysisProvider("vertex_ai"), /지원하지 않는 분석 공급자/);
});

test("counts related outlets but deduplicates shared media groups in coverage", () => {
  const issues = analyzeArticles([
    { id: "c1", sourceId: "chosun", source: "조선일보", mediaGroupId: "chosun_group", title: "정부 청년 주거 지원 정책 확대 발표", section: "정치" },
    { id: "c2", sourceId: "chosunbiz", source: "조선비즈", mediaGroupId: "chosun_group", title: "정부 청년 주거 지원 정책 확대", section: "정치" },
  ], { configuredSourceCount: 2, configuredSourceGroupCount: 2 });
  assert.equal(issues[0].sourceCount, 2);
  assert.equal(issues[0].diversityScore, 50);
});

test("proxies both the Vercel root and nested routes to the validated origin", async () => {
  const config = JSON.parse(await readFile(new URL("../vercel-proxy/vercel.json", import.meta.url), "utf8"));
  assert.deepEqual(config.rewrites, [
    {
      source: "/",
      destination: "https://agendaframe-capstone.kjh01072299206.chatgpt.site/",
    },
    {
      source: "/:path*",
      destination: "https://agendaframe-capstone.kjh01072299206.chatgpt.site/:path*",
    },
  ]);
});

test("uses repeated placement observations and keeps authorized body text private", () => {
  const privateBody = "정부 정책의 책임 소재를 두고 국회와 관계 부처가 서로 다른 설명을 내놓았다. 관계자는 후속 대책을 검토한다고 밝혔다.";
  const [issue] = analyzeArticles([
    {
      id: "body-1",
      sourceId: "hani",
      source: "한겨레",
      title: "정부 청년 주거 정책 확대 발표",
      section: "정치",
      bodyText: privateBody,
      contentVersionId: "content-1",
      publicEvidenceAllowed: false,
      placementObservations: [
        { zone: "top", pageRank: 1, aboveFold: true, observedAt: 1 },
        { zone: "main", pageRank: 3, aboveFold: true, observedAt: 2 },
      ],
    },
  ]);
  const responsibility = issue.frames.find((frame) => frame.frame === "responsibility");
  assert.equal(issue.placementObservedCount, 1);
  assert.equal(issue.placementObservationCount, 2);
  assert.equal(issue.placementScore, 91);
  assert.equal(responsibility.evidenceBasis, "body_private");
  assert.equal(responsibility.contentVersionId, "content-1");
  assert.match(responsibility.evidenceText, /공개 검토 전/);
  assert.equal(issue.articles[0].contentAvailable, true);
  assert.equal("bodyText" in issue.articles[0], false);
  assert.equal(JSON.stringify(issue).includes(privateBody), false);
});

test("stores only attested article bodies in the private object binding", async () => {
  const statements = [];
  const objects = [];
  const DB = {
    prepare(sql) {
      return {
        bind(...parameters) {
          statements.push({ sql, parameters });
          if (sql.includes("SELECT a.id, a.title")) return { first: async () => ({ id: "article-1", title: "검증 기사", source: "한겨레" }) };
          if (sql.includes("FROM article_contents") && sql.includes("body_hash")) return { first: async () => null };
          if (sql.includes("INSERT INTO article_contents")) return { run: async () => ({ success: true }) };
          throw new Error(`Unexpected SQL: ${sql}`);
        },
      };
    },
  };
  const CONTENT = { put: async (key, value, options) => objects.push({ key, value, options }) };
  const body = "정부 정책의 문제 정의와 책임 소재, 시민 영향, 제도 개선 대안을 여러 취재원의 발언과 함께 설명한다. ".repeat(8);
  const request = new Request("https://example.test/api/content", {
    method: "POST",
    headers: { authorization: "Bearer correct", origin: "https://example.test", "sec-fetch-site": "same-origin", "content-type": "application/json" },
    body: JSON.stringify({
      url: "https://www.hani.co.kr/arti/politics/test.html",
      body,
      acquired_at: "2026-07-19T10:00:00+09:00",
      acquisition_method: "manual_research",
      usage_basis: "연구 프로젝트에서 분석이 허용된 내부 표본",
      analysis_allowed: true,
      public_evidence_allowed: false,
      rights_attested: true,
    }),
  });
  const response = await handleApiRequest(request, { DB, CONTENT, IMPORT_TOKEN: "correct" });
  assert.equal(response.status, 201);
  assert.equal(objects.length, 1);
  assert.equal(objects[0].value, body.trim());
  assert.match(objects[0].key, /^article-content\/article-1\/[a-f0-9]{64}\.txt$/);
  const result = await response.json();
  assert.equal(result.publicEvidenceAllowed, false);
  assert.equal("body" in result, false);
  assert.ok(statements.some((statement) => statement.sql.includes("INSERT INTO article_contents")));

  const unattested = await handleApiRequest(new Request("https://example.test/api/content", {
    method: "POST",
    headers: { authorization: "Bearer correct", origin: "https://example.test", "sec-fetch-site": "same-origin", "content-type": "application/json" },
    body: JSON.stringify({ url: "https://www.hani.co.kr/arti/politics/test.html", body, rights_attested: false }),
  }), { DB, CONTENT, IMPORT_TOKEN: "correct" });
  assert.equal(unattested.status, 400);
  assert.match((await unattested.json()).error.message, /권한/);
  assert.equal(objects.length, 1);
});

test("accepts authenticated homepage geometry as repeated observations", async () => {
  const statements = [];
  const DB = {
    prepare(sql) {
      return {
        bind(...parameters) {
          const statement = { sql, parameters, run: async () => ({ success: true }), first: async () => ({ count: 1 }) };
          statements.push(statement);
          return statement;
        },
      };
    },
    batch: async (batch) => batch.map(() => ({ success: true, meta: { changes: 1 } })),
  };
  const response = await handleApiRequest(new Request("https://example.test/api/observations/homepage", {
    method: "POST",
    headers: { authorization: "Bearer correct", origin: "https://example.test", "sec-fetch-site": "same-origin", "content-type": "application/json" },
    body: JSON.stringify({
      source: "한겨레",
      homepage_url: "https://www.hani.co.kr/",
      observed_at: "2026-07-19T09:00:00+09:00",
      viewport: { width: 1440, height: 1200 },
      collector_version: "playwright-layout-v1",
      placements: [{
        url: "https://www.hani.co.kr/arti/politics/test.html",
        title: "홈페이지에 관측된 기사",
        zone: "top",
        rank: 1,
        x: 80,
        y: 140,
        width: 720,
        height: 360,
        above_fold: true,
        module_name: "주요뉴스",
      }],
    }),
  }), { DB, IMPORT_TOKEN: "correct" });
  assert.equal(response.status, 201);
  const result = await response.json();
  assert.equal(result.observed, 1);
  assert.equal(result.matched, 1);
  assert.ok(statements.some((statement) => statement.sql.includes("INSERT INTO homepage_snapshots")));
  assert.ok(statements.some((statement) => statement.sql.includes("INSERT INTO placement_observations")));
});

test("uses the checked-in JSON Schema as the public lineage contract", async () => {
  const schema = JSON.parse(await readFile(new URL("../docs/public-api.schema.json", import.meta.url), "utf8"));
  assert.equal(schema["x-api-version"], "agendaframe-public-v3");
  const required = schema.$defs.LineageMeta.required;
  for (const field of ["snapshotId", "runId", "sourcePolicyVersion", "clusteringVersion", "scoreVersion", "modelId", "promptVersion", "evaluationDatasetVersion", "publishedAt"]) {
    assert.ok(required.includes(field), `missing lineage field: ${field}`);
  }
  assert.ok(schema.$defs.IssueDetailResponse.required.includes("comparison"));
  assert.ok(schema.$defs.Comparison.required.includes("availableHeadlineEvidence"));
});

test("keeps release thresholds blocked until a real labeled holdout exists", async () => {
  const thresholds = await readFile(new URL("../../evals/thresholds.yaml", import.meta.url), "utf8");
  assert.match(thresholds, /release_status: blocked_until_labeled_holdout/);
  assert.match(thresholds, /hard_negative_accuracy_min: 0\.95/);
  assert.match(thresholds, /required_before_numeric_confidence: true/);
  assert.match(thresholds, /production_release_requires_real_labeled_cases: true/);
});

test("separates the deployed overmerge hard negatives by actor and event action", () => {
  const issues = analyzeArticles([
    { id: "sim-1", sourceId: "hani", source: "한겨레", title: "심우정 검찰총장 사퇴 압박 거세져", section: "정치" },
    { id: "sim-2", sourceId: "khan", source: "경향신문", title: "심우정 검찰총장 사퇴 요구 확산", section: "정치" },
    { id: "yoo-1", sourceId: "chosun", source: "조선일보", title: "유병호 감사위원 구속영장 청구", section: "정치" },
    { id: "yoo-2", sourceId: "joongang", source: "중앙일보", title: "유병호 감사위원 구속영장 청구 논란", section: "정치" },
    { id: "kang-1", sourceId: "hankook", source: "한국일보", title: "강호필 육군총장 취임 후 첫 지휘관회의", section: "정치" },
  ]);
  assert.deepEqual(issues.map((issue) => issue.articles.map((article) => article.id).sort()).sort((a, b) => a[0].localeCompare(b[0])), [
    ["kang-1"], ["sim-1", "sim-2"], ["yoo-1", "yoo-2"],
  ]);
  assert.ok(issues.every((issue) => issue.confidence === null));
});

test("prevents transitive single-link merges across distinct actions", () => {
  const issues = analyzeArticles([
    { id: "a", sourceId: "hani", source: "한겨레", title: "홍길동 의원 구속영장 청구", section: "정치" },
    { id: "b", sourceId: "khan", source: "경향신문", title: "홍길동 의원 구속영장 청구 수사", section: "정치" },
    { id: "c", sourceId: "chosun", source: "조선일보", title: "홍길동 의원 수사 결과 무혐의 발표", section: "정치" },
  ]);
  assert.equal(issues.length, 2);
  assert.deepEqual(issues.map((issue) => issue.articles.map((article) => article.id).sort()).sort((a, b) => a.length - b.length), [["c"], ["a", "b"]]);
});

test("withholds missing frame evidence and excludes unobserved placement", () => {
  const [issue] = analyzeArticles([
    { id: "only", sourceId: "hani", source: "한겨레", title: "봄철 벚꽃 개화 소식", section: "문화", homepagePlacement: null },
  ]);
  assert.equal(issue.placementScore, null);
  assert.equal(issue.scoreStatus, "placement_excluded");
  assert.equal(issue.placementObservedCount, 0);
  assert.ok(issue.frames.every((frame) => frame.score === 0 && frame.evidenceText === null && frame.articleId === null && frame.confidence === null));
});

test("classifies freshness states with a deterministic KST clock", () => {
  const now = Date.parse("2026-07-19T12:00:00+09:00");
  assert.equal(classifySnapshotStatus({}, now).status, "analysis_pending");
  assert.equal(classifySnapshotStatus({ targetDate: "2026-07-19", collectionStatus: "partial", latestSourceCount: 3, configuredSources: 5 }, now).status, "partial_collection");
  assert.deepEqual(classifySnapshotStatus({ targetDate: "2026-07-14", dataAsOf: "2026-07-14T18:00:00+09:00", latestSourceCount: 5, configuredSources: 5 }, now), { status: "stale_snapshot", label: "오래된 스냅샷", staleDays: 5 });
  assert.equal(classifySnapshotStatus({ targetDate: "2026-07-19", dataAsOf: "2026-07-17T10:00:00+09:00", latestSourceCount: 5, configuredSources: 5 }, now).status, "collection_delayed");
  assert.equal(classifySnapshotStatus({ targetDate: "2026-07-19", dataAsOf: "2026-07-19T10:00:00+09:00", latestSourceCount: 5, configuredSources: 5 }, now).status, "normal");
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
  assert.equal(healthBody.collection.configuredSources, 22);
  assert.equal(healthBody.meta.clusteringVersion, "event-anchors-complete-link-v2");
  assert.equal(healthBody.meta.scoreVersion, "observed-agenda-v3");

  const sources = await handleApiRequest(new Request("https://example.test/api/sources"));
  const sourceBody = await sources.json();
  assert.equal(sourceBody.panelLabel, "22개 주요 중앙언론 온라인 뉴스 표본");
  assert.equal(sourceBody.sources.length, 22);
  assert.ok(sourceBody.sources.every((source) => !("domains" in source)));
  assert.ok(sourceBody.sources.every((source) => !("samplePosition" in source)));
  assert.deepEqual(Object.fromEntries(["general_daily", "business_media", "news_agency"].map((type) => [type, sourceBody.sources.filter((source) => source.sourceType === type).length])), {
    general_daily: 10,
    business_media: 9,
    news_agency: 3,
  });
  for (const broadcaster of ["KBS", "MBC", "SBS", "JTBC", "TV조선", "채널A", "MBN", "YTN", "연합뉴스TV"]) {
    assert.ok(!sourceBody.sources.some((source) => source.name === broadcaster));
  }
  assert.equal(sourceBody.sources.find((source) => source.name === "조선일보").mediaGroupId, sourceBody.sources.find((source) => source.name === "조선비즈").mediaGroupId);

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
  const runsUnauthorized = await handleApiRequest(new Request("https://example.test/api/analysis/runs?start=2026-07-08&end=2026-07-14", {
    headers: { authorization: "Bearer wrong", origin: "https://example.test" },
  }), { DB: {}, IMPORT_TOKEN: "correct" });
  assert.equal(runsUnauthorized.status, 401);

  const missing = await handleApiRequest(new Request("https://example.test/api/missing"));
  assert.equal(missing.status, 404);
  const missingBody = await missing.json();
  assert.equal(missingBody.error.code, "NOT_FOUND");
  assert.equal(typeof missingBody.requestId, "string");
});

test("keeps demo and live health response contracts identical", async () => {
  const statementFor = (sql) => {
    const statement = {
      bind() { return statement; },
      async first() {
        if (sql.includes("configured_sources")) return { configured_sources: 5, article_count: 0 };
        if (sql.includes("FROM collection_runs")) return null;
        if (sql.includes("FROM analysis_runs")) return null;
        throw new Error(`Unexpected SQL: ${sql}`);
      },
    };
    return statement;
  };
  const DB = { prepare: statementFor, batch: async () => [] };
  const demo = await (await handleApiRequest(new Request("https://example.test/api/health"))).json();
  const live = await (await handleApiRequest(new Request("https://example.test/api/health"), { DB })).json();
  assert.deepEqual(Object.keys(live).sort(), Object.keys(demo).sort());
  assert.deepEqual(Object.keys(live.collection).sort(), Object.keys(demo.collection).sort());
  assert.deepEqual(Object.keys(live.timestamps).sort(), Object.keys(demo.timestamps).sort());
  assert.deepEqual(Object.keys(live.meta).sort(), Object.keys(demo.meta).sort());
  assert.equal(demo.meta.runtimeMode, "demo");
  assert.equal(live.meta.runtimeMode, "live_metadata");
});

test("applies browser security headers to non-API responses", async () => {
  const response = withSecurityHeaders(new Response("ok", { headers: { "content-type": "text/plain" } }));
  assert.equal(await response.text(), "ok");
  assert.equal(response.headers.get("strict-transport-security"), "max-age=31536000; includeSubDomains");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.match(response.headers.get("content-security-policy"), /frame-ancestors 'none'/);
});

test("adds exact CSP hashes for every server-rendered inline script", async () => {
  const response = await withDocumentSecurityHeaders(new Response("<html><body><script>self.boot=true</script><script type=\"application/ld+json\">{}</script></body></html>", { headers: { "content-type": "text/html; charset=utf-8" } }));
  const html = await response.text();
  const policy = response.headers.get("content-security-policy");
  assert.equal(html.includes("nonce="), false);
  assert.equal((policy.match(/'sha256-[^']+'/g) ?? []).length, 2);
  assert.match(policy, /script-src 'self' 'sha256-/);
  assert.match(policy, /object-src 'none'/);
  assert.match(policy, /frame-ancestors 'none'/);
});

test("hides legacy scores and unsupported comparison claims in issue detail", async () => {
  const legacyIssue = {
    id: "legacy-issue", runId: "run-v1", targetDate: "2026-07-14", provider: "rules_local", modelVersion: "agenda-rules-v1", analyzedAt: Date.parse("2026-07-14T19:00:00+09:00"),
    issueDate: "2026-07-14", title: "legacy title", summary: "legacy summary", category: "정치", articleCount: 2, sourceCount: 2,
    agendaScore: 92, diversityScore: 40, placementScore: 25, volumeScore: 50, repetitionScore: 0, confidence: 92, placementObservedCount: 0, placementTotalCount: 2,
  };
  const article = { id: "article-1", source: "한겨레", title: "확인 가능한 제목", url: "https://www.hani.co.kr/arti/test.html", publishedAt: Date.parse("2026-07-14T10:00:00+09:00"), representative: 1, similarity: 1 };
  const DB = {
    prepare(sql) {
      return {
        bind() {
          if (sql.includes("FROM issues i")) return { first: async () => legacyIssue };
          if (sql.includes("FROM issue_articles ia") && sql.includes("ORDER BY ia.representative")) return { all: async () => ({ results: [article] }) };
          if (sql.includes("FROM frame_analyses")) return { all: async () => ({ results: [{ frame: "conflict", score: 100, confidence: 92, evidenceText: "placeholder" }] }) };
          if (sql.includes("FROM ai_reports")) return { first: async () => ({ summary: "legacy report" }) };
          if (sql.includes("GROUP BY s.id")) return { all: async () => ({ results: [{ source: "한겨레", articleCount: 1, placementWeight: 0 }] }) };
          throw new Error(`Unexpected SQL: ${sql}`);
        },
      };
    },
  };
  const response = await handleApiRequest(new Request("https://example.test/api/issues/legacy-issue"), { DB });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.issue.agendaScore, null);
  assert.equal(body.issue.placementScore, null);
  assert.equal(body.issue.scoreStatus, "legacy_reanalysis_required");
  assert.equal("confidence" in body.issue, false);
  assert.deepEqual(body.frames, []);
  assert.equal(body.report, null);
  assert.equal(body.comparison.status, "withheld_insufficient_evidence");
  assert.equal(body.comparison.recommendedPair, null);
  assert.deepEqual(body.comparison.commonFacts, []);
  assert.equal(body.comparison.availableHeadlineEvidence[0].articleId, "article-1");
  assert.equal(body.meta.snapshotId, "run-v1");
  assert.equal(body.meta.clusteringVersion, "legacy-v1-unverified");
  assert.equal(response.headers.has("etag"), true);
});

test("filters and paginates the complete article collection", async () => {
  const statements = [];
  const article = { id: "article-1", sourceId: "hani", source: "한겨레", title: "주거 정책 기사", url: "https://www.hani.co.kr/arti/politics/test.html", section: "정치_국회", publishedAt: Date.parse("2026-07-14T17:44:48+09:00"), collectedAt: Date.parse("2026-07-14T18:00:00+09:00"), homepagePlacement: null, homepageRank: null };
  const DB = {
    prepare(sql) {
      return {
        bind(...parameters) {
          statements.push({ sql, parameters });
          return sql.includes("SELECT COUNT(*) AS total") ? { first: async () => ({ total: 123 }) } : { all: async () => ({ results: [article] }) };
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
  assert.equal(typeof body.nextCursor, "string");
  assert.equal(body.meta.runtimeMode, "live_metadata");
  assert.equal(body.meta.schemaVersion, "agendaframe-public-v3");
  assert.deepEqual(body.articles, [article]);
  assert.equal(statements.length, 2);
  assert.match(statements[0].sql, /a\.source_id = \?/);
  assert.match(statements[0].sql, /a\.section LIKE \?/);
  assert.match(statements[0].sql, /a\.title LIKE \?/);
  assert.match(statements[0].sql, /a\.published_at >= \?/);
  assert.deepEqual(statements[1].parameters.slice(-2), [25, 50]);

  const invalidCursor = await handleApiRequest(new Request("https://example.test/api/articles?cursor=not-base64"), { DB });
  assert.equal(invalidCursor.status, 400);
  assert.equal((await invalidCursor.json()).error.code, "INVALID_REQUEST");
});

test("reports resumable per-day analysis status", async () => {
  const DB = {
    prepare(sql) {
      return {
        bind() {
          if (sql.includes("ROW_NUMBER() OVER")) return { all: async () => ({ results: [{ id: "run-14", targetDate: "2026-07-14", status: "success", analyzedArticleCount: 120, issueCount: 20 }] }) };
          if (sql.includes("date(published_at / 1000")) return { all: async () => ({ results: [{ targetDate: "2026-07-13", articleCount: 100 }, { targetDate: "2026-07-14", articleCount: 120 }] }) };
          throw new Error(`Unexpected SQL: ${sql}`);
        },
      };
    },
  };
  const response = await handleApiRequest(new Request("https://example.test/api/analysis/runs?start=2026-07-12&end=2026-07-14", {
    headers: { authorization: "Bearer correct", origin: "https://example.test" },
  }), { DB, IMPORT_TOKEN: "correct" });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.days.map((day) => [day.date, day.status, day.articleCount]), [
    ["2026-07-12", "empty", 0],
    ["2026-07-13", "pending", 100],
    ["2026-07-14", "success", 120],
  ]);
  assert.equal(body.maxBatchDays, 7);
  assert.equal(body.resumable, true);
});

test("rolls back only to an existing immutable successful snapshot", async () => {
  const statements = [];
  const DB = {
    prepare(sql) {
      return {
        bind(...parameters) {
          statements.push({ sql, parameters });
          if (sql.includes("WHERE id = ?") && sql.includes("SELECT id")) return { first: async () => ({ id: "run-new", targetDate: "2026-07-14", status: "success" }) };
          if (sql.includes("id != ?")) return { first: async () => ({ id: "run-old", targetDate: "2026-07-14", finishedAt: 1 }) };
          if (sql.includes("UPDATE analysis_runs")) return { run: async () => ({ success: true }) };
          throw new Error(`Unexpected SQL: ${sql}`);
        },
      };
    },
  };
  const response = await handleApiRequest(new Request("https://example.test/api/analysis/runs/run-new/rollback", {
    method: "POST",
    headers: { authorization: "Bearer correct", origin: "https://example.test" },
  }), { DB, IMPORT_TOKEN: "correct" });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { rolledBackRunId: "run-new", fallbackRunId: "run-old", targetDate: "2026-07-14" });
  assert.match(statements.at(-1).sql, /status = 'rolled_back'/);
});
