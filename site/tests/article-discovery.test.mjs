import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  canonicalizeDiscoveredUrl,
  discoverArticlesFromDocument,
  resolveDiscoveryEndpointUrl,
  runDiscoveryCycle,
  validateDiscoveryPolicy,
} from "../worker/article-discovery.mjs";

const policy = JSON.parse(readFileSync(new URL("../data/discovery-sources.json", import.meta.url), "utf8"));

function source(id) {
  return policy.sources.find((entry) => entry.id === id);
}

function endpoint(sourceId, overrides = {}) {
  const selected = source(sourceId).endpoints[0];
  return { ...selected, enabled: true, ...overrides };
}

test("locks the academic collection scope to 10 dailies, 2 broadcasters, and the service window", () => {
  const summary = validateDiscoveryPolicy(policy);
  assert.deepEqual(summary, {
    sourceCount: 12,
    dailies: 10,
    broadcasters: 2,
    startDate: "2026-08-10",
    endDate: "2026-10-31",
  });
  assert.deepEqual(policy.sources.map((entry) => entry.name), [
    "경향신문", "국민일보", "동아일보", "문화일보", "서울신문",
    "세계일보", "조선일보", "중앙일보", "한겨레", "한국일보",
    "KBS", "SBS",
  ]);
  assert.equal(policy.outletWeight, "equal");
  assert.equal(policy.polling.intervalMinutes, 360);
  assert.equal(policy.polling.runsPerDay, 4);
  assert.deepEqual(policy.polling.scheduledHoursKst, [0, 6, 12, 18]);
  assert.equal(policy.polling.requestTimeoutMilliseconds, 15000);
  assert.equal(policy.polling.maxRecordsPerSourcePerRun, 120);
  assert.equal(policy.collectionWindow.rawContentDeleteAfter, "2026-10-31T23:59:59+09:00");
  assert.ok(policy.sources.every((entry) => entry.endpoints.every((item) => item.enabled === true)));
  assert.equal(policy.sources.filter((entry) => entry.endpointReview.status === "verified").length, 12);
  assert.equal(source("mbc"), undefined);
  assert.equal(policy.activationState, "active");
  assert.deepEqual(policy.activationBlockers, []);
});

test("canonicalizes only allowlisted HTTPS article URLs and removes tracking parameters", () => {
  const khan = source("khan");
  assert.equal(
    canonicalizeDiscoveredUrl("http://news.khan.co.kr/article/202608101200001?utm_source=test&b=2&a=1#top", khan),
    "https://news.khan.co.kr/article/202608101200001?a=1&b=2",
  );
  assert.throws(() => canonicalizeDiscoveredUrl("https://example.com/article/1", khan), /allowlist/);
  assert.throws(() => canonicalizeDiscoveredUrl("javascript:alert(1)", khan), /HTTPS/);
  const sbs = source("sbs");
  assert.equal(
    canonicalizeDiscoveredUrl("https://news.sbs.co.kr/news/endPage.do?news_id=N1001&cooper=RSSREADER&plink=RSSLINK", sbs),
    "https://news.sbs.co.kr/news/endPage.do?news_id=N1001",
  );
});

test("discovers RSS metadata, applies date and content exclusions, and never returns raw document text", () => {
  const khan = source("khan");
  const rssEndpoint = endpoint("khan", { id: "politics-rss", method: "rss", topic: "politics", url: "https://www.khan.co.kr/rss.xml" });
  const rss = `<?xml version="1.0" encoding="UTF-8"?>
    <rss><channel>
      <item>
        <title><![CDATA[국회, 새 법안 심사 일정 확정]]></title>
        <link>https://www.khan.co.kr/article/202608101200001?utm_medium=rss</link>
        <pubDate>Mon, 10 Aug 2026 03:00:00 GMT</pubDate>
        <description>이 문장은 발견 결과에 포함되면 안 되는 기사 요약이다.</description>
      </item>
      <item>
        <title>사설 | 국회의 책무</title>
        <link>https://www.khan.co.kr/opinion/editorial/article/202608101200002</link>
        <pubDate>Mon, 10 Aug 2026 04:00:00 GMT</pubDate>
      </item>
      <item>
        <title>수집 시작 전 기사</title>
        <link>https://www.khan.co.kr/article/202608091200003</link>
        <pubDate>Sun, 09 Aug 2026 03:00:00 GMT</pubDate>
      </item>
    </channel></rss>`;
  const records = discoverArticlesFromDocument({
    policy,
    source: khan,
    endpoint: rssEndpoint,
    document: rss,
    contentType: "application/rss+xml",
    discoveredAt: "2026-08-10T05:00:00.000Z",
  });
  assert.equal(records.length, 1);
  assert.deepEqual(records[0], {
    sourceId: "khan",
    sourceName: "경향신문",
    sourceType: "general_daily",
    title: "국회, 새 법안 심사 일정 확정",
    canonicalUrl: "https://www.khan.co.kr/article/202608101200001",
    publishedAt: "2026-08-10T03:00:00.000Z",
    discoveredAt: "2026-08-10T05:00:00.000Z",
    discoveryMethod: "rss",
    discoveryEndpointId: "politics-rss",
    topic: "politics",
  });
  assert.doesNotMatch(JSON.stringify(records), /기사 요약|description|document|body|html/i);
});

test("caps a large source feed per run and keeps the newest records", async () => {
  const boundedPolicy = structuredClone(policy);
  boundedPolicy.polling.maxRecordsPerSourcePerRun = 2;
  boundedPolicy.sources = boundedPolicy.sources.map((entry) => ({
    ...entry,
    endpoints: entry.endpoints.slice(0, 1),
  }));
  const largeRss = `<?xml version="1.0"?><rss><channel>
    <item><title>첫 기사</title><link>https://www.khan.co.kr/article/202608100000001</link><pubDate>Mon, 10 Aug 2026 01:00:00 GMT</pubDate></item>
    <item><title>둘째 기사</title><link>https://www.khan.co.kr/article/202608100000002</link><pubDate>Mon, 10 Aug 2026 02:00:00 GMT</pubDate></item>
    <item><title>셋째 기사</title><link>https://www.khan.co.kr/article/202608100000003</link><pubDate>Mon, 10 Aug 2026 03:00:00 GMT</pubDate></item>
  </channel></rss>`;
  const result = await runDiscoveryCycle(boundedPolicy, {
    now: Date.parse("2026-08-10T05:00:00.000Z"),
    beforeRequest: async () => {},
    fetchImpl: async (url) => new Response(String(url).includes("khan.co.kr") ? largeRss : "<rss><channel></channel></rss>", {
      status: 200,
      headers: { "content-type": "application/rss+xml" },
    }),
  });
  const khan = result.sources.find((entry) => entry.sourceId === "khan");
  assert.equal(khan.discovered, 2);
  assert.equal(khan.truncated, true);
  assert.ok(khan.diagnostics.some((entry) => entry.code === "RECORD_LIMIT_REACHED"));
  assert.deepEqual(result.records.map((entry) => entry.title), ["셋째 기사", "둘째 기사"]);
});

test("discovers homepage links, rejects cross-domain and excluded sections, and deduplicates canonical URLs", () => {
  const hani = source("hani");
  const homepage = endpoint("hani");
  const html = `
    <a href="/arti/politics/assembly/1200001.html?utm_source=home" title="여야, 본회의 일정 합의">첫 링크</a>
    <a href="https://www.hani.co.kr/arti/politics/assembly/1200001.html">여야, 본회의 일정 합의와 쟁점</a>
    <a href="https://evil.example/arti/politics/1200002.html">외부 링크</a>
    <a href="/arti/opinion/column/1200003.html">칼럼 | 오늘의 정치</a>
    <a href="/arti/sports/baseball/1200004.html">프로야구 경기 결과</a>`;
  const records = discoverArticlesFromDocument({
    policy,
    source: hani,
    endpoint: homepage,
    document: html,
    contentType: "text/html; charset=utf-8",
    discoveredAt: "2026-08-10T06:00:00.000Z",
  });
  assert.equal(records.length, 1);
  assert.equal(records[0].title, "여야, 본회의 일정 합의와 쟁점");
  assert.equal(records[0].canonicalUrl, "https://www.hani.co.kr/arti/politics/assembly/1200001.html");
  assert.equal(records[0].topic, "politics");
});

test("does not collect a mixed-homepage link when its approved topic cannot be established", () => {
  const khan = source("khan");
  const records = discoverArticlesFromDocument({
    policy,
    source: khan,
    endpoint: endpoint("khan"),
    document: '<a href="/article/202608101200009">분류 경로가 없는 일반 링크</a>',
    contentType: "text/html",
    discoveredAt: "2026-08-10T06:00:00.000Z",
  });
  assert.deepEqual(records, []);
});

test("does not label a cross-navigation article as the section endpoint topic", () => {
  const seoul = source("seoul");
  const records = discoverArticlesFromDocument({
    policy,
    source: seoul,
    endpoint: endpoint("seoul", { topic: "politics" }),
    document: `
      <a href="/news/life/health-news/2026/08/10/20260810500233">생활 기사</a>
      <a href="/news/society/accident/2026/08/10/20260810500234">사회 기사</a>
      <a href="/news/politics/assembly/2026/08/10/20260810500235">정치 기사</a>`,
    contentType: "text/html",
    discoveredAt: "2026-08-10T06:00:00.000Z",
  });
  assert.deepEqual(records.map((record) => record.canonicalUrl), [
    "https://www.seoul.co.kr/news/politics/assembly/2026/08/10/20260810500235",
  ]);
});

test("keeps the KBS discovery endpoint on the robots-advertised sitemap", () => {
  const kbs = source("kbs");
  const kbsEndpoint = endpoint("kbs");
  const resolved = resolveDiscoveryEndpointUrl({
    policy,
    source: kbs,
    endpoint: kbsEndpoint,
    discoveredAt: "2026-08-10T05:00:00.000Z",
  });
  assert.equal(resolved, "https://news.kbs.co.kr/sitemap/recentNewsList.xml");
});

test("discovers KBS sitemap metadata with topic classification deferred to the article page", () => {
  const kbs = source("kbs");
  const kbsEndpoint = endpoint("kbs");
  const document = `<?xml version="1.0" encoding="UTF-8"?>
    <urlset xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">
      <url>
        <loc>https://news.kbs.co.kr/news/view.do?ncd=8633235</loc>
        <lastmod>2026-08-10T20:31:50+09:00</lastmod>
        <news:news>
          <news:publication_date>2026-08-10T20:31:50+09:00</news:publication_date>
          <news:title><![CDATA[국회, 오늘 본회의 일정 확정]]></news:title>
        </news:news>
      </url>
    </urlset>`;
  const records = discoverArticlesFromDocument({
    policy,
    source: kbs,
    endpoint: kbsEndpoint,
    document,
    contentType: "application/xml;charset=UTF-8",
    discoveredAt: "2026-08-10T12:00:00.000Z",
  });
  assert.equal(records.length, 1);
  assert.equal(records[0].canonicalUrl, "https://news.kbs.co.kr/news/view.do?ncd=8633235");
  assert.equal(records[0].publishedAt, "2026-08-10T11:31:50.000Z");
  assert.equal(records[0].topic, "pending");
  assert.doesNotMatch(JSON.stringify(records), /urlset|news:publication/);
});

test("rechecks at most the configured three KST publication dates", () => {
  const khan = source("khan");
  const rssEndpoint = endpoint("khan", { method: "rss", topic: "society", url: "https://www.khan.co.kr/rss.xml" });
  const rss = `<rss><channel>
    <item><title>사흘 범위 안 기사</title><link>https://www.khan.co.kr/article/20260812001</link><pubDate>Wed, 12 Aug 2026 02:00:00 GMT</pubDate></item>
    <item><title>나흘 전 기사</title><link>https://www.khan.co.kr/article/20260811001</link><pubDate>Tue, 11 Aug 2026 02:00:00 GMT</pubDate></item>
  </channel></rss>`;
  const records = discoverArticlesFromDocument({
    policy,
    source: khan,
    endpoint: rssEndpoint,
    document: rss,
    contentType: "application/rss+xml",
    discoveredAt: "2026-08-14T03:00:00.000Z",
  });
  assert.deepEqual(records.map((record) => record.title), ["사흘 범위 안 기사"]);
});

test("a review-required policy remains inert until endpoints are enabled", async () => {
  const reviewPolicy = structuredClone(policy);
  reviewPolicy.activationState = "endpoint_review_required";
  for (const entry of reviewPolicy.sources) {
    for (const item of entry.endpoints) item.enabled = false;
  }
  let calls = 0;
  const result = await runDiscoveryCycle(reviewPolicy, {
    now: "2026-08-10T06:00:00.000Z",
    fetchImpl: async () => {
      calls += 1;
      throw new Error("must not be called");
    },
  });
  assert.equal(calls, 0);
  assert.equal(result.records.length, 0);
  assert.ok(result.sources.every((entry) => entry.status === "skipped_endpoint_review_required"));
});

test("an enabled endpoint stops the whole source immediately on 403 or 429", async () => {
  const livePolicy = structuredClone(policy);
  livePolicy.activationState = "endpoint_review_required";
  for (const entry of livePolicy.sources) {
    for (const item of entry.endpoints) item.enabled = false;
  }
  livePolicy.sources.find((entry) => entry.id === "khan").endpoints = [
    endpoint("khan", { id: "first", enabled: true }),
    endpoint("khan", { id: "second", enabled: true, url: "https://www.khan.co.kr/news" }),
  ];
  let calls = 0;
  const result = await runDiscoveryCycle(livePolicy, {
    now: "2026-08-10T06:00:00.000Z",
    fetchImpl: async () => {
      calls += 1;
      return new Response("blocked", { status: 429 });
    },
    sleepImpl: async () => {},
  });
  const khanResult = result.sources.find((entry) => entry.sourceId === "khan");
  assert.equal(calls, 1);
  assert.equal(khanResult.status, "stopped_access_restriction");
  assert.equal(khanResult.endpointsRequested, 1);
  assert.deepEqual(khanResult.diagnostics, [{ endpointId: "first", status: 429, code: "SOURCE_STOPPED" }]);
});

test("keeps the minimum delay between different sources as well as within one source", async () => {
  const livePolicy = structuredClone(policy);
  livePolicy.activationState = "endpoint_review_required";
  for (const entry of livePolicy.sources) {
    for (const item of entry.endpoints) item.enabled = false;
  }
  livePolicy.sources.find((entry) => entry.id === "khan").endpoints[0].enabled = true;
  livePolicy.sources.find((entry) => entry.id === "kmib").endpoints[0].enabled = true;
  const sleeps = [];
  let calls = 0;
  const result = await runDiscoveryCycle(livePolicy, {
    now: "2026-08-10T06:00:00.000Z",
    fetchImpl: async () => {
      calls += 1;
      return new Response("<rss><channel></channel></rss>", {
        status: 200,
        headers: { "content-type": "application/rss+xml" },
      });
    },
    sleepImpl: async (milliseconds) => sleeps.push(milliseconds),
  });
  assert.equal(result.status, "success");
  assert.equal(calls, 2);
  assert.deepEqual(sleeps, [3000]);
});

test("keeps the minimum delay before following an approved redirect", async () => {
  const livePolicy = structuredClone(policy);
  livePolicy.activationState = "endpoint_review_required";
  for (const source of livePolicy.sources) {
    for (const endpoint of source.endpoints) endpoint.enabled = false;
  }
  livePolicy.sources[0].endpoints[0].enabled = true;
  const sleeps = [];
  let calls = 0;
  const result = await runDiscoveryCycle(livePolicy, {
    now: "2026-08-10T06:00:00.000Z",
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) {
        return new Response("", {
          status: 302,
          headers: { location: "https://www.khan.co.kr/rss/rssdata/total_news.xml" },
        });
      }
      return new Response("<rss><channel></channel></rss>", {
        status: 200,
        headers: { "content-type": "application/rss+xml" },
      });
    },
    sleepImpl: async (milliseconds) => sleeps.push(milliseconds),
  });
  assert.equal(result.status, "success");
  assert.equal(calls, 2);
  assert.deepEqual(sleeps, [3000]);
});

test("does not issue requests outside the fixed collection window", async () => {
  const livePolicy = structuredClone(policy);
  livePolicy.sources[0].endpoints[0].enabled = true;
  let calls = 0;
  const result = await runDiscoveryCycle(livePolicy, {
    now: "2026-11-01T00:00:00+09:00",
    fetchImpl: async () => {
      calls += 1;
      return new Response("", { status: 200 });
    },
  });
  assert.equal(calls, 0);
  assert.equal(result.status, "outside_collection_window");
});

test("aborts a discovery request at its deadline and records a timeout", async () => {
  const livePolicy = structuredClone(policy);
  livePolicy.activationState = "endpoint_review_required";
  for (const source of livePolicy.sources) {
    for (const endpoint of source.endpoints) endpoint.enabled = false;
  }
  livePolicy.sources[0].endpoints[0].enabled = true;
  const result = await runDiscoveryCycle(livePolicy, {
    now: "2026-08-10T06:00:00.000Z",
    requestTimeoutMilliseconds: 5,
    fetchImpl: async (_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }),
  });
  assert.equal(result.status, "partial");
  assert.equal(result.sources[0].diagnostics[0].code, "REQUEST_TIMEOUT");
});

test("stops before the next publisher request when the run deadline is reached", async () => {
  const livePolicy = structuredClone(policy);
  livePolicy.activationState = "endpoint_review_required";
  for (const source of livePolicy.sources) {
    for (const endpoint of source.endpoints) endpoint.enabled = false;
  }
  livePolicy.sources[0].endpoints[0].enabled = true;
  let calls = 0;
  const result = await runDiscoveryCycle(livePolicy, {
    now: "2026-08-10T06:00:00.000Z",
    deadlineTimestamp: 10,
    nowImpl: () => 10,
    fetchImpl: async () => { calls += 1; return new Response("", { status: 200 }); },
  });
  assert.equal(calls, 0);
  assert.equal(result.deadlineExceeded, true);
  assert.equal(result.sources[0].diagnostics[0].code, "RUN_DEADLINE_EXCEEDED");
});
