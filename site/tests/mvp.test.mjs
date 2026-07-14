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
  assert.match(html, /시연용 합성 데이터/);
  assert.match(html, /id="agenda-list"/);
  assert.match(html, /id="issue-detail"/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton|Your site is taking shape/);
});

test("serves interactive application assets", async () => {
  const [scriptResponse, styleResponse, adminResponse, adminScriptResponse, templateResponse] = await Promise.all([
    worker.fetch(new Request("https://example.test/app.js")),
    worker.fetch(new Request("https://example.test/styles.css")),
    worker.fetch(new Request("https://example.test/admin")),
    worker.fetch(new Request("https://example.test/admin.js")),
    worker.fetch(new Request("https://example.test/templates/agendaframe-import.csv")),
  ]);
  assert.equal(scriptResponse.status, 200);
  assert.equal(styleResponse.status, 200);
  assert.equal(adminResponse.status, 200);
  assert.equal(adminScriptResponse.status, 200);
  assert.equal(templateResponse.status, 200);
  const [script, styles, admin, adminScript, template] = await Promise.all([scriptResponse.text(), styleResponse.text(), adminResponse.text(), adminScriptResponse.text(), templateResponse.text()]);
  assert.match(script, /const issues = \[/);
  assert.match(script, /renderAll\(\)/);
  assert.match(script, /data-copy-report/);
  assert.match(script, /refreshCollectionStatus/);
  assert.match(styles, /\.workspace/);
  assert.match(styles, /\.source-panel/);
  assert.match(styles, /prefers-reduced-motion/);
  assert.match(admin, /id="import-form"/);
  assert.match(admin, /기사 본문 저장 없이/);
  assert.match(adminScript, /Bearer \$\{token\}/);
  assert.match(template, /^source,title,url,published_at/);
});

test("reports manual-import health and rejects unknown paths", async () => {
  const health = await worker.fetch(new Request("https://example.test/api/health"));
  const healthBody = await health.json();
  assert.equal(healthBody.status, "ok");
  assert.equal(healthBody.mode, "demo");
  assert.equal(healthBody.collection.method, "manual_csv");
  assert.equal(healthBody.collection.directCrawling, false);
  assert.equal(healthBody.collection.configuredSources, 5);

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
