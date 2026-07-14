import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workerUrl = new URL(`../dist/server/index.js?test=${Date.now()}`, import.meta.url);
const { default: worker, validateImportRows, canonicalizeArticleUrl } = await import(workerUrl.href);

test("serves the complete AgendaFrame MVP", async () => {
  const response = await worker.fetch(new Request("https://example.test/"));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html/);
  const html = await response.text();
  assert.match(html, /AgendaFrame \| 오늘의 의제·프레임 분석/);
  assert.match(html, /오늘, 언론은/);
  assert.match(html, /분석 데모/);
  assert.match(html, /id="agenda-list"/);
  assert.match(html, /id="issue-detail"/);
  assert.match(html, /id="live-feed"/);
  assert.match(html, /id="live-filter-form"/);
  assert.match(html, /id="live-article-list"/);
  assert.match(html, /id="live-load-more"/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton|Your site is taking shape/);
});

test("serves interactive application assets", async () => {
  const [scriptResponse, styleResponse, adminResponse, adminScriptResponse, excelReaderResponse, excelReaderLicenseResponse, templateResponse] = await Promise.all([
    worker.fetch(new Request("https://example.test/app.js")),
    worker.fetch(new Request("https://example.test/styles.css")),
    worker.fetch(new Request("https://example.test/admin")),
    worker.fetch(new Request("https://example.test/admin.js")),
    worker.fetch(new Request("https://example.test/vendor/read-excel-file.min.js")),
    worker.fetch(new Request("https://example.test/vendor/read-excel-file.LICENSE.txt")),
    worker.fetch(new Request("https://example.test/templates/agendaframe-import.csv")),
  ]);
  assert.equal(scriptResponse.status, 200);
  assert.equal(styleResponse.status, 200);
  assert.equal(adminResponse.status, 200);
  assert.equal(adminScriptResponse.status, 200);
  assert.equal(excelReaderResponse.status, 200);
  assert.equal(excelReaderLicenseResponse.status, 200);
  assert.equal(templateResponse.status, 200);
  const [script, styles, admin, adminScript, excelReader, excelReaderLicense, template] = await Promise.all([scriptResponse.text(), styleResponse.text(), adminResponse.text(), adminScriptResponse.text(), excelReaderResponse.text(), excelReaderLicenseResponse.text(), templateResponse.text()]);
  assert.match(script, /const issues = \[/);
  assert.match(script, /renderAll\(\)/);
  assert.match(script, /data-copy-report/);
  assert.match(script, /refreshCollectionStatus/);
  assert.match(script, /refreshLiveArticles/);
  assert.match(script, /new URLSearchParams/);
  assert.match(script, /liveFilterParameters/);
  assert.match(script, /원문 기사 보기/);
  assert.match(styles, /\.workspace/);
  assert.match(styles, /\.source-panel/);
  assert.match(styles, /\.live-article-grid/);
  assert.match(styles, /prefers-reduced-motion/);
  assert.match(admin, /id="import-form"/);
  assert.match(admin, /BigKinds Excel \/ CSV/);
  assert.match(admin, /최대 20,000행/);
  assert.match(adminScript, /Bearer \$\{token\}/);
  assert.match(adminScript, /window\.readXlsxFile/);
  assert.match(adminScript, /IMPORT_BATCH_SIZE = 500/);
  assert.match(adminScript, /publishedAtFromNewsId/);
  assert.match(adminScript, /뉴스식별자/);
  assert.match(adminScript, /본문 열은 폐기/);
  assert.match(excelReader, /readXlsxFile/);
  assert.match(excelReaderLicense, /MIT License/);
  assert.match(template, /^source,title,url,published_at/);
});

test("reports BigKinds-import health and rejects unknown paths", async () => {
  const health = await worker.fetch(new Request("https://example.test/api/health"));
  const healthBody = await health.json();
  assert.equal(healthBody.status, "ok");
  assert.equal(healthBody.mode, "demo");
  assert.equal(healthBody.collection.method, "bigkinds_export");
  assert.equal(healthBody.collection.directCrawling, false);
  assert.equal(healthBody.collection.configuredSources, 5);

  const articles = await worker.fetch(new Request("https://example.test/api/articles?limit=100"));
  const articlesBody = await articles.json();
  assert.deepEqual(articlesBody, { articles: [], total: 0 });

  const sources = await worker.fetch(new Request("https://example.test/api/sources"));
  const sourceBody = await sources.json();
  assert.equal(sourceBody.sources.length, 5);
  assert.deepEqual(
    sourceBody.sources.reduce((counts, source) => ({ ...counts, [source.samplePosition]: (counts[source.samplePosition] ?? 0) + 1 }), {}),
    { progressive: 2, center: 1, conservative: 2 },
  );

  const missing = await worker.fetch(new Request("https://example.test/unknown"));
  assert.equal(missing.status, 404);
});

test("filters and paginates the complete article collection", async () => {
  const statements = [];
  const article = {
    id: "article-1",
    sourceId: "hani",
    source: "한겨레",
    title: "주거 정책 기사",
    url: "https://www.hani.co.kr/arti/politics/test.html",
    section: "정치_국회",
    publishedAt: Date.parse("2026-07-14T17:44:48+09:00"),
    collectedAt: Date.parse("2026-07-14T18:00:00+09:00"),
    homepagePlacement: null,
    homepageRank: null,
  };
  const DB = {
    prepare(sql) {
      return {
        bind(...parameters) {
          statements.push({ sql, parameters });
          return sql.includes("COUNT(*)")
            ? { first: async () => ({ total: 123 }) }
            : { all: async () => ({ results: [article] }) };
        },
      };
    },
  };

  const response = await worker.fetch(new Request("https://example.test/api/articles?limit=25&offset=50&source=한겨레&section=정치&q=주거&date=2026-07-14"), { DB });
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

test("validates metadata-only imports and canonicalizes duplicate URLs", () => {
  const [row] = validateImportRows([{
    source: "한겨레",
    title: "검증용 기사 제목",
    url: "https://www.hani.co.kr/arti/politics/test.html?utm_source=test#headline",
    published_at: "2026-07-14T09:30:00+09:00",
    collected_at: "2026-07-14T10:00:00+09:00",
    section: "정치",
    homepage_placement: "TOP",
    homepage_rank: "1",
  }]);
  assert.equal(row.source.id, "hani");
  assert.equal(row.canonicalUrl, "https://www.hani.co.kr/arti/politics/test.html");
  assert.equal(row.homepagePlacement, "top");
  assert.equal(row.homepageRank, 1);
  assert.equal(canonicalizeArticleUrl("https://example.com/a?utm_medium=x&b=2"), "https://example.com/a?b=2");

  assert.throws(() => validateImportRows([{
    source: "한겨레",
    title: "다른 도메인",
    url: "https://example.com/article",
    published_at: "2026-07-14T09:30:00+09:00",
  }]), /공식 도메인/);
  assert.throws(() => validateImportRows([{
    source: "한겨레",
    title: "본문 포함",
    url: "https://www.hani.co.kr/arti/test.html",
    published_at: "2026-07-14T09:30:00+09:00",
    content: "저장하면 안 되는 기사 본문",
  }]), /기사 본문/);
});

test("protects the import endpoint with storage and a secret token", async () => {
  const unavailable = await worker.fetch(new Request("https://example.test/api/import", { method: "POST" }));
  assert.equal(unavailable.status, 503);

  const unauthorized = await worker.fetch(new Request("https://example.test/api/import", {
    method: "POST",
    headers: { authorization: "Bearer wrong", "content-type": "application/json", origin: "https://example.test" },
    body: JSON.stringify({ rows: [] }),
  }), { DB: {}, IMPORT_TOKEN: "correct" });
  assert.equal(unauthorized.status, 401);
});

test("packages Sites hosting metadata", async () => {
  const hosting = JSON.parse(await readFile(new URL("../dist/.openai/hosting.json", import.meta.url), "utf8"));
  assert.equal(hosting.d1, "DB");
  assert.equal(hosting.r2, null);
});
