import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { persistDiscoveryCycle } from "../worker/discovery-store.mjs";

const policy = JSON.parse(readFileSync(new URL("../data/discovery-sources.json", import.meta.url), "utf8"));

function fakeDatabase(existing = []) {
  const calls = [];
  function statement(sql) {
    const state = { sql, values: [] };
    return {
      sql,
      bind(...values) {
        state.values = values;
        return this;
      },
      async all() {
        calls.push({ operation: "all", ...state });
        return { results: existing.map((canonicalUrl) => ({ canonicalUrl })) };
      },
      async run() {
        calls.push({ operation: "run", ...state });
        return { success: true };
      },
      _state: state,
    };
  }
  return {
    calls,
    prepare: statement,
    async batch(statements) {
      calls.push({ operation: "batch", statements: statements.map((entry) => ({ sql: entry._state.sql, values: entry._state.values })) });
      return statements.map(() => ({ success: true }));
    },
  };
}

function sampleCycle() {
  return {
    status: "success",
    discoveredAt: "2026-08-13T06:00:00.000Z",
    records: [
      {
        sourceId: "khan",
        sourceName: "경향신문",
        sourceType: "general_daily",
        title: "국회, 새 법안 심사 일정 확정",
         canonicalUrl: "https://www.khan.co.kr/article/202608131200001",
         publishedAt: "2026-08-13T03:00:00.000Z",
         discoveredAt: "2026-08-13T06:00:00.000Z",
        discoveryMethod: "rss",
        discoveryEndpointId: "politics-rss",
        topic: "politics",
      },
    ],
    sources: policy.sources.map((source) => ({
      sourceId: source.id,
      status: source.id === "khan" ? "success" : "skipped_endpoint_review_required",
      discovered: source.id === "khan" ? 1 : 0,
    })),
  };
}

test("persists discovery metadata without storing document or article body text", async () => {
  const db = fakeDatabase();
  const result = await persistDiscoveryCycle(db, policy, sampleCycle(), { runId: "discovery-run-1" });
  assert.deepEqual(result, { runId: "discovery-run-1", status: "success", received: 1, inserted: 1, duplicates: 0 });
  const serialized = JSON.stringify(db.calls);
  assert.match(serialized, /INSERT INTO media_sources/);
  assert.match(serialized, /INSERT INTO collection_runs/);
  assert.match(serialized, /INSERT INTO articles/);
  assert.match(serialized, /INSERT INTO collection_source_results/);
  assert.doesNotMatch(serialized, /article_contents|article_body_signals|body_text|raw_html/i);
});

test("reports an existing canonical URL as a duplicate and keeps the insert idempotent", async () => {
  const url = "https://www.khan.co.kr/article/202608131200001";
  const db = fakeDatabase([url]);
  const result = await persistDiscoveryCycle(db, policy, sampleCycle(), { runId: "discovery-run-2" });
  assert.equal(result.inserted, 0);
  assert.equal(result.duplicates, 1);
  const articleBatch = db.calls.find((call) => call.operation === "batch" && call.statements.some((entry) => /INSERT INTO articles/.test(entry.sql)));
  assert.match(articleBatch.statements[0].sql, /ON CONFLICT\(canonical_url\) DO UPDATE/);
});

test("rejects records from outside the approved 12-source policy", async () => {
  const db = fakeDatabase();
  const cycle = sampleCycle();
  cycle.records[0].sourceId = "unknown";
  await assert.rejects(() => persistDiscoveryCycle(db, policy, cycle), /Unknown discovery source/);
});

test("rejects out-of-window publication dates before any discovery metadata is persisted", async () => {
  for (const [publishedAt, date] of [
    ["2026-08-09T14:59:59.000Z", "2026-08-09"],
    ["2026-10-31T15:00:00.000Z", "2026-11-01"],
  ]) {
    const db = fakeDatabase();
    const cycle = sampleCycle();
    cycle.records[0].publishedAt = publishedAt;

    await assert.rejects(
      () => persistDiscoveryCycle(db, policy, cycle),
      new RegExp(`outside the collection window: ${date}`),
    );
    assert.deepEqual(db.calls, []);
  }
});

test("uses the KST discovery date for undated candidates at the persistence boundary", async () => {
  const db = fakeDatabase();
  const cycle = sampleCycle();
  cycle.records[0].publishedAt = null;
  cycle.records[0].discoveredAt = "2026-08-09T14:59:59.000Z";

  await assert.rejects(
    () => persistDiscoveryCycle(db, policy, cycle),
    /outside the collection window: 2026-08-09/,
  );
  assert.deepEqual(db.calls, []);
});
