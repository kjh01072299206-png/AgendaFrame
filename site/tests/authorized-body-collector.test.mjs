import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { collectAuthorizedArticleBodies } from "../worker/authorized-body-collector.mjs";

const basePolicy = JSON.parse(readFileSync(new URL("../data/discovery-sources.json", import.meta.url), "utf8"));

function longBody(prefix) {
  return Array.from({ length: 8 }, (_, index) => `${prefix} ${index + 1}문단입니다. 국회와 정부, 시민단체의 설명과 사건의 배경 및 이후 절차를 구체적으로 설명합니다.`).join("\n");
}

function fakeEnvironment(articles) {
  const calls = [];
  const objects = new Map();
  const DB = {
    prepare(sql) {
      const state = { sql, values: [] };
      return {
        bind(...values) {
          state.values = values;
          return this;
        },
        async all() {
          calls.push({ operation: "all", ...state });
          return { results: articles };
        },
        async run() {
          calls.push({ operation: "run", ...state });
          return { success: true };
        },
      };
    },
  };
  const CONTENT = {
    async put(key, value, options) {
      objects.set(key, { value, options });
    },
    async delete(key) {
      objects.delete(key);
    },
  };
  return { DB, CONTENT, calls, objects };
}

function activePolicy() {
  const policy = structuredClone(basePolicy);
  policy.activationState = "active";
  policy.sources[0].endpoints[0].enabled = true;
  return policy;
}

test("stores only the extracted body in private R2 and fixes its usage expiry to service end", async () => {
  const article = {
    id: "article-1",
    sourceId: "khan",
    title: "국회, 새 법안 심사 일정 확정",
    canonicalUrl: "https://www.khan.co.kr/article/202608101200001",
  };
  const env = fakeEnvironment([article]);
  const body = longBody("공개 기사 본문");
  const html = `<html><head><script type="application/ld+json">${JSON.stringify({
    "@type": "NewsArticle",
    isAccessibleForFree: true,
    articleBody: body,
  })}</script></head><body><nav>메뉴와 광고</nav></body></html>`;
  const result = await collectAuthorizedArticleBodies(env, activePolicy(), {
    now: Date.parse("2026-08-10T15:00:00+09:00"),
    fetchImpl: async () => new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }),
    sleepImpl: async () => {},
  });
  assert.equal(result.status, "success");
  assert.equal(result.stored, 1);
  assert.equal(env.objects.size, 1);
  const storedObject = [...env.objects.values()][0];
  assert.equal(storedObject.value, body);
  assert.doesNotMatch(storedObject.value, /<html|메뉴와 광고/);
  const selection = env.calls.find((call) => call.operation === "all" && call.sql.includes("FROM articles AS a"));
  assert.ok(selection);
  assert.match(selection.sql, /a\.provider = \?/);
  assert.match(selection.sql, /a\.published_at >= \?/);
  assert.match(selection.sql, /a\.published_at <= \?/);
  assert.equal(selection.values[1], "authorized_crawl");
  const publishedStart = Date.parse("2026-08-10T00:00:00+09:00");
  const publishedEnd = Date.parse("2026-10-31T23:59:59.999+09:00");
  const publishedStartIndex = selection.values.indexOf(publishedStart);
  assert.ok(publishedStartIndex >= 0);
  assert.equal(selection.values[publishedStartIndex + 1], publishedEnd);
  const insert = env.calls.find((call) => call.operation === "run" && /INSERT INTO article_contents/.test(call.sql));
  assert.equal(insert.values[8], Date.parse("2026-10-31T23:59:59+09:00"));
  assert.match(insert.sql, /public_evidence_allowed, extractor_version/);
  assert.match(insert.sql, /1, 0/);
});

test("stops requesting the same source after a 429 response", async () => {
  const env = fakeEnvironment([
    { id: "article-1", sourceId: "khan", title: "첫 기사", canonicalUrl: "https://www.khan.co.kr/article/1" },
    { id: "article-2", sourceId: "khan", title: "둘째 기사", canonicalUrl: "https://www.khan.co.kr/article/2" },
  ]);
  let requests = 0;
  const result = await collectAuthorizedArticleBodies(env, activePolicy(), {
    now: Date.parse("2026-08-10T15:00:00+09:00"),
    fetchImpl: async () => {
      requests += 1;
      return new Response("rate limited", { status: 429 });
    },
    sleepImpl: async () => {},
  });
  assert.equal(requests, 1);
  assert.equal(result.failed, 1);
  assert.equal(result.results[1].status, "skipped");
  assert.equal(result.results[1].code, "SOURCE_STOPPED");
  assert.equal(env.objects.size, 0);
});

test("classifies deferred KBS sitemap records from article JSON-LD before storing", async () => {
  const article = {
    id: "kbs-1",
    sourceId: "kbs",
    title: "국회 일정 기사",
    canonicalUrl: "https://news.kbs.co.kr/news/view.do?ncd=8633235",
    section: "pending",
  };
  const env = fakeEnvironment([article]);
  const body = longBody("KBS 공개 기사 본문");
  const html = `<script type="application/ld+json">${JSON.stringify({
    "@type": "NewsArticle",
    articleSection: "정치",
    isAccessibleForFree: true,
    articleBody: body,
  })}</script>`;
  const result = await collectAuthorizedArticleBodies(env, activePolicy(), {
    now: Date.parse("2026-08-10T15:00:00+09:00"),
    fetchImpl: async () => new Response(html, { status: 200, headers: { "content-type": "text/html" } }),
    sleepImpl: async () => {},
  });
  assert.equal(result.stored, 1);
  const update = env.calls.find((call) => call.operation === "run" && /UPDATE articles SET section = \?/.test(call.sql));
  assert.deepEqual(update.values, ["politics", "kbs-1"]);
});

test("marks a deferred KBS article outside the four topics without storing its body", async () => {
  const article = {
    id: "kbs-culture",
    sourceId: "kbs",
    title: "문화 기사",
    canonicalUrl: "https://news.kbs.co.kr/news/view.do?ncd=8633000",
    section: "pending",
  };
  const env = fakeEnvironment([article]);
  const html = `<script type="application/ld+json">${JSON.stringify({
    "@type": "NewsArticle",
    articleSection: "문화",
    articleBody: longBody("범위 밖 기사 본문"),
  })}</script>`;
  const result = await collectAuthorizedArticleBodies(env, activePolicy(), {
    now: Date.parse("2026-08-10T15:00:00+09:00"),
    fetchImpl: async () => new Response(html, { status: 200, headers: { "content-type": "text/html" } }),
    sleepImpl: async () => {},
  });
  assert.equal(result.stored, 0);
  assert.equal(result.results[0].code, "TOPIC_OUT_OF_SCOPE");
  assert.equal(env.objects.size, 0);
  const update = env.calls.find((call) => call.operation === "run" && /section = 'excluded'/.test(call.sql));
  assert.deepEqual(update.values, ["kbs-culture"]);
});

test("is inert before approval and outside the fixed collection window", async () => {
  const env = fakeEnvironment([]);
  const reviewPolicy = structuredClone(basePolicy);
  reviewPolicy.activationState = "endpoint_review_required";
  for (const source of reviewPolicy.sources) {
    for (const endpoint of source.endpoints) endpoint.enabled = false;
  }
  let requests = 0;
  const fetchImpl = async () => {
    requests += 1;
    return new Response("", { status: 200 });
  };
  const reviewRequired = await collectAuthorizedArticleBodies(env, reviewPolicy, {
    now: Date.parse("2026-08-10T15:00:00+09:00"),
    fetchImpl,
  });
  const expired = await collectAuthorizedArticleBodies(env, activePolicy(), {
    now: Date.parse("2026-11-01T00:00:01+09:00"),
    fetchImpl,
  });
  assert.equal(reviewRequired.status, "endpoint_review_required");
  assert.equal(expired.status, "outside_collection_window");
  assert.equal(requests, 0);
  assert.equal(env.calls.length, 0);
});

test("aborts a body request at its deadline and records a timeout", async () => {
  const env = fakeEnvironment([
    { id: "article-timeout", sourceId: "khan", title: "시간 초과 기사", canonicalUrl: "https://www.khan.co.kr/article/timeout" },
  ]);
  const result = await collectAuthorizedArticleBodies(env, activePolicy(), {
    now: Date.parse("2026-08-10T15:00:00+09:00"),
    requestTimeoutMilliseconds: 5,
    fetchImpl: async (_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }),
    sleepImpl: async () => {},
  });
  assert.equal(result.status, "failed");
  assert.equal(result.results[0].code, "REQUEST_TIMEOUT");
  assert.equal(env.objects.size, 0);
  const retry = env.calls.find((call) => call.operation === "run" && /INSERT INTO article_collection_attempts/.test(call.sql));
  assert.ok(retry);
  assert.equal(retry.values[3], "REQUEST_TIMEOUT");
  assert.equal(retry.values.at(-1), 5);
});

test("does not start a body request after the overall run deadline", async () => {
  const env = fakeEnvironment([
    { id: "article-deadline", sourceId: "khan", title: "마감 기사", canonicalUrl: "https://www.khan.co.kr/article/deadline" },
  ]);
  let requests = 0;
  const result = await collectAuthorizedArticleBodies(env, activePolicy(), {
    now: Date.parse("2026-08-10T15:00:00+09:00"),
    deadlineTimestamp: 10,
    nowImpl: () => 10,
    fetchImpl: async () => { requests += 1; return new Response("", { status: 200 }); },
  });
  assert.equal(requests, 0);
  assert.equal(result.deadlineExceeded, true);
  assert.equal(result.results[0].code, "RUN_DEADLINE_EXCEEDED");
});

test("rechecks the service cutoff immediately before writing a fetched body", async () => {
  const article = {
    id: "article-cutoff",
    sourceId: "khan",
    title: "종료 직전 기사",
    canonicalUrl: "https://www.khan.co.kr/article/cutoff",
  };
  const env = fakeEnvironment([article]);
  const body = longBody("종료 직전 본문");
  const html = `<script type="application/ld+json">${JSON.stringify({
    "@type": "NewsArticle",
    articleBody: body,
  })}</script>`;
  const result = await collectAuthorizedArticleBodies(env, activePolicy(), {
    now: Date.parse("2026-10-31T23:59:58+09:00"),
    nowImpl: () => Date.parse("2026-10-31T23:59:59+09:00"),
    fetchImpl: async () => new Response(html, { status: 200, headers: { "content-type": "text/html" } }),
  });
  assert.equal(result.results[0].code, "COLLECTION_WINDOW_CLOSED");
  assert.equal(env.objects.size, 0);
  assert.equal(env.calls.some((call) => call.operation === "run" && /INSERT INTO article_contents/.test(call.sql)), false);
});
