import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workerUrl = new URL(`../dist/server/index.js?test=${Date.now()}`, import.meta.url);
const { default: worker } = await import(workerUrl.href);

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
  const [scriptResponse, styleResponse] = await Promise.all([
    worker.fetch(new Request("https://example.test/app.js")),
    worker.fetch(new Request("https://example.test/styles.css")),
  ]);
  assert.equal(scriptResponse.status, 200);
  assert.equal(styleResponse.status, 200);
  const [script, styles] = await Promise.all([scriptResponse.text(), styleResponse.text()]);
  assert.match(script, /const issues = \[/);
  assert.match(script, /renderAll\(\)/);
  assert.match(script, /data-copy-report/);
  assert.match(styles, /\.workspace/);
  assert.match(styles, /prefers-reduced-motion/);
});

test("reports demo health and rejects unknown paths", async () => {
  const health = await worker.fetch(new Request("https://example.test/api/health"));
  assert.deepEqual(await health.json(), { status: "ok", mode: "demo", dataAsOf: "2026-07-13T18:00:00+09:00" });
  const missing = await worker.fetch(new Request("https://example.test/unknown"));
  assert.equal(missing.status, 404);
});

test("packages Sites hosting metadata", async () => {
  const hosting = JSON.parse(await readFile(new URL("../dist/.openai/hosting.json", import.meta.url), "utf8"));
  assert.equal(hosting.d1, null);
  assert.equal(hosting.r2, null);
});
