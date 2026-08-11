import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { handleAnalyze } from "../worker/runtime.mjs";
import { analyzeStoredArticleBodies, runStoredAnalysisForDates } from "../worker/stored-body-analysis.mjs";

const basePolicy = JSON.parse(readFileSync(new URL("../data/discovery-sources.json", import.meta.url), "utf8"));

function activePolicy() {
  const policy = structuredClone(basePolicy);
  policy.activationState = "active";
  for (const source of policy.sources) source.endpoints[0].enabled = true;
  return policy;
}

function articleBody() {
  return Array.from({ length: 12 }, (_, index) =>
    `정책 분석 ${index + 1}문단입니다. 정부는 제도 개선 대책을 발표했고 국회는 책임과 법적 절차를 논의했습니다. 시민단체는 안전 문제와 권리 보장을 요구했습니다.`).join("\n");
}

function environment(rows) {
  const calls = [];
  return {
    calls,
    DB: {
      prepare(sql) {
        const state = { sql, values: [] };
        return {
          bind(...values) {
            state.values = values;
            return this;
          },
          async all() {
            calls.push({ operation: "all", ...state });
            return { results: rows };
          },
          async run() {
            calls.push({ operation: "run", ...state });
            return { success: true };
          },
        };
      },
    },
    CONTENT: {
      async get() {
        return { async text() { return articleBody(); } };
      },
    },
  };
}

test("turns a private stored body into a body-free structured frame profile", async () => {
  const env = environment([{
    articleId: "article-1",
    title: "정부, 안전 대책과 법 개정안 발표",
    publishedAt: Date.parse("2026-08-10T09:00:00+09:00"),
    contentId: "content-1",
    objectKey: "article-content/article-1/hash.txt",
    bodyHash: "a".repeat(64),
    bodyCharacters: articleBody().length,
  }]);
  const result = await analyzeStoredArticleBodies(env, activePolicy(), {
    now: Date.parse("2026-08-10T15:00:00+09:00"),
  });
  assert.equal(result.analyzed, 1);
  assert.deepEqual(result.dates, ["2026-08-10"]);
  const insert = env.calls.find((call) => call.operation === "run" && /INSERT INTO article_frame_profiles/.test(call.sql));
  assert.ok(insert);
  const serializedProfile = insert.values[4];
  assert.doesNotMatch(serializedProfile, /정책 분석 1문단|"bodyText"\s*:|"raw_body"\s*:|"sentence_text"\s*:/);
  assert.match(serializedProfile, /agendaframe\.article-frame-profile\.v1/);
});

test("does not read R2 before the 12-source policy is activated", async () => {
  const env = environment([]);
  const reviewPolicy = structuredClone(basePolicy);
  reviewPolicy.activationState = "endpoint_review_required";
  for (const source of reviewPolicy.sources) {
    for (const endpoint of source.endpoints) endpoint.enabled = false;
  }
  let reads = 0;
  env.CONTENT.get = async () => {
    reads += 1;
    return null;
  };
  const result = await analyzeStoredArticleBodies(env, reviewPolicy, { now: 1 });
  assert.equal(result.status, "endpoint_review_required");
  assert.equal(reads, 0);
  assert.equal(env.calls.length, 0);
});

test("scopes stored analysis to authorized crawl articles while leaving general analysis unscoped", async () => {
  const policy = activePolicy();
  const token = "scope-test-token";
  const scopedEnv = environment([]);
  const scopedResult = await runStoredAnalysisForDates(scopedEnv, policy, ["2026-08-10"]);
  assert.deepEqual(scopedResult, [{
    date: "2026-08-10",
    status: "failed",
    httpStatus: 400,
    runId: null,
    issueCount: 0,
    error: "ANALYSIS_REQUEST_FAILED",
  }]);

  const scopedArticleQuery = scopedEnv.calls.find((call) => call.operation === "all" && call.sql.includes("FROM articles a"));
  assert.ok(scopedArticleQuery);
  assert.match(scopedArticleQuery.sql, /a\.provider = \?/);
  assert.match(scopedArticleQuery.sql, /a\.source_id IN \(/);
  const sourcePlaceholderCount = scopedArticleQuery.sql.match(/a\.source_id IN \(([^)]+)\)/)?.[1].match(/\?/g)?.length;
  assert.equal(sourcePlaceholderCount, policy.sources.length);
  assert.equal(scopedArticleQuery.values[2], "authorized_crawl");
  assert.deepEqual(scopedArticleQuery.values.slice(3), policy.sources.map((source) => source.id));

  const generalEnv = environment([]);
  generalEnv.IMPORT_TOKEN = token;
  const generalResponse = await handleAnalyze(new Request("https://agendaframe.internal/api/analyze", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ date: "2026-08-10" }),
  }), generalEnv, {
    includeStoredContents: false,
    includeDerivedSignals: false,
  });
  assert.equal(generalResponse.status, 400);
  const generalArticleQuery = generalEnv.calls.find((call) => call.operation === "all" && call.sql.includes("FROM articles a"));
  assert.ok(generalArticleQuery);
  assert.doesNotMatch(generalArticleQuery.sql, /a\.provider = \?/);
  assert.doesNotMatch(generalArticleQuery.sql, /a\.source_id IN/);
  assert.deepEqual(generalArticleQuery.values, [
    Date.parse("2026-08-10T00:00:00+09:00"),
    Date.parse("2026-08-11T00:00:00+09:00"),
  ]);
});
