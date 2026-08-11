import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  RAW_CONTENT_DELETE_AFTER,
  drainExpiredArticleContent,
  purgeExpiredArticleContent,
  runScheduledAgendaFrame,
} from "../worker/content-retention.mjs";

function fakeEnvironment(selected, failKeys = new Set()) {
  const deletedKeys = [];
  const updates = [];
  const queries = [];
  const DB = {
    prepare(sql) {
      const statement = {
        sql,
        values: [],
        bind(...values) {
          statement.values = values;
          return statement;
        },
        async all() {
          queries.push({ sql, values: statement.values });
          return { results: selected };
        },
        async run() {
          updates.push({ sql, values: statement.values });
          return { success: true };
        },
      };
      return statement;
    },
  };
  const CONTENT = {
    async delete(key) {
      if (failKeys.has(key)) throw new Error("simulated R2 failure");
      deletedKeys.push(key);
    },
  };
  return { DB, CONTENT, deletedKeys, updates, queries };
}

test("before service shutdown, purges only rows selected by their explicit expiry", async () => {
  const env = fakeEnvironment([
    { id: "content-1", articleId: "article-1", objectKey: "article-content/article-1/hash.txt", usageExpiresAt: Date.parse("2026-08-20T00:00:00Z") },
  ]);
  const now = Date.parse("2026-08-21T00:00:00Z");
  const result = await purgeExpiredArticleContent(env, { now });
  assert.equal(result.hardShutdownReached, false);
  assert.equal(env.queries[0].values[0], 0);
  assert.deepEqual(env.deletedKeys, ["article-content/article-1/hash.txt"]);
  assert.equal(result.deleted, 1);
  assert.match(env.updates[0].sql, /status = 'expired'/);
  assert.match(env.updates[0].sql, /analysis_allowed = 0/);
});

test("after October 31, selects every active raw body even when usage expiry is missing", async () => {
  const env = fakeEnvironment([
    { id: "content-2", articleId: "article-2", objectKey: "article-content/article-2/hash.txt", usageExpiresAt: null },
  ]);
  const result = await purgeExpiredArticleContent(env, { now: RAW_CONTENT_DELETE_AFTER + 1 });
  assert.equal(result.hardShutdownReached, true);
  assert.equal(env.queries[0].values[0], 1);
  assert.equal(result.deleted, 1);
});

test("does not mark metadata expired when the R2 object deletion fails", async () => {
  const key = "article-content/article-3/hash.txt";
  const env = fakeEnvironment([
    { id: "content-3", articleId: "article-3", objectKey: key, usageExpiresAt: 1 },
  ], new Set([key]));
  const result = await purgeExpiredArticleContent(env, { now: Date.parse("2026-08-21T00:00:00Z") });
  assert.equal(result.deleted, 0);
  assert.equal(result.failed, 1);
  assert.deepEqual(result.failures, [{ contentId: "content-3", code: "DELETE_FAILED" }]);
  assert.equal(env.updates.length, 0);
});

test("requires both D1 and deletable R2 bindings", async () => {
  await assert.rejects(() => purgeExpiredArticleContent({}, { now: 1 }), /D1-compatible/);
  await assert.rejects(() => purgeExpiredArticleContent({ DB: { prepare() {} } }, { now: 1 }), /R2 CONTENT/);
});

test("drains multiple deletion batches instead of leaving the shutdown backlog after 100 rows", async () => {
  const batches = [
    Array.from({ length: 2 }, (_, index) => ({
      id: `content-${index + 1}`,
      articleId: `article-${index + 1}`,
      objectKey: `article-content/article-${index + 1}/hash.txt`,
      usageExpiresAt: null,
    })),
    [],
  ];
  const deletedKeys = [];
  const DB = {
    prepare() {
      const statement = {
        values: [],
        bind(...values) { statement.values = values; return statement; },
        async all() { return { results: batches.shift() ?? [] }; },
        async run() { return { success: true }; },
      };
      return statement;
    },
  };
  const CONTENT = { async delete(key) { deletedKeys.push(key); } };
  const result = await drainExpiredArticleContent({ DB, CONTENT }, {
    now: RAW_CONTENT_DELETE_AFTER + 1,
    limit: 2,
  });
  assert.equal(result.batches, 2);
  assert.equal(result.deleted, 2);
  assert.equal(result.drained, true);
  assert.equal(deletedKeys.length, 2);
});

class SqliteD1Statement {
  constructor(database, sql, parameters = []) {
    this.database = database;
    this.sql = sql;
    this.parameters = parameters;
  }

  bind(...parameters) {
    return new SqliteD1Statement(this.database, this.sql, parameters);
  }

  async first(columnName) {
    const row = this.database.prepare(this.sql).get(...this.parameters) ?? null;
    return row && columnName ? row[columnName] : row;
  }

  async all() {
    return { success: true, results: this.database.prepare(this.sql).all(...this.parameters) };
  }

  async run() {
    const execution = this.database.prepare(this.sql).run(...this.parameters);
    return { success: true, results: [], meta: { changes: Number(execution.changes) } };
  }

  executeInBatch() {
    const statement = this.database.prepare(this.sql);
    if (statement.columns().length > 0) {
      const rows = statement.all(...this.parameters);
      return { success: true, results: rows, meta: { changes: rows.length } };
    }
    const execution = statement.run(...this.parameters);
    return { success: true, results: [], meta: { changes: Number(execution.changes) } };
  }
}

class SqliteD1 {
  constructor() {
    this.database = new DatabaseSync(":memory:");
    this.database.exec("PRAGMA foreign_keys = ON");
  }

  prepare(sql) {
    return new SqliteD1Statement(this.database, sql);
  }

  async exec(sql) {
    this.database.exec(sql);
  }

  async batch(statements) {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const results = statements.map((statement) => statement.executeInBatch());
      this.database.exec("COMMIT");
      return results;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  close() {
    this.database.close();
  }
}

const COLLECTION_MIGRATIONS = [
  "0000_numerous_quasar.sql",
  "0001_easy_dexter_bennett.sql",
  "0003_complex_mikhail_rasputin.sql",
  "0004_colossal_kylun.sql",
  "0005_structured_frame_profiles.sql",
  "0007_durable_operations.sql",
  "0011_collection_execution_lock.sql",
  "0012_article_collection_attempts.sql",
];

function migratedDatabase(t) {
  const database = new SqliteD1();
  t.after(() => database.close());
  for (const file of COLLECTION_MIGRATIONS) {
    const migration = readFileSync(new URL(`../drizzle/${file}`, import.meta.url), "utf8");
    database.database.exec(migration.replaceAll("--> statement-breakpoint", ""));
  }
  return database;
}

const discoveryPolicy = JSON.parse(readFileSync(new URL("../data/discovery-sources.json", import.meta.url), "utf8"));

function discoveryRss() {
  return `<?xml version="1.0" encoding="UTF-8"?>
    <rss><channel>
      <item>
        <title>국회, 새 법안 심사 일정 확정</title>
        <link>https://www.khan.co.kr/article/202608101200001</link>
        <pubDate>Mon, 10 Aug 2026 03:00:00 GMT</pubDate>
        <description>발견 결과에 포함되면 안 되는 요약이다.</description>
      </item>
    </channel></rss>`;
}

function articleHtml() {
  const body = Array.from({ length: 12 }, (_, index) =>
    `정책 분석 ${index + 1}문단입니다. 정부는 제도 개선 대책을 발표했고 국회는 책임과 법적 절차를 논의했습니다. 시민단체는 안전 문제와 권리 보장을 요구했습니다.`).join("\n");
  return `<!doctype html><html><head><title>국회, 새 법안 심사 일정 확정</title></head>
    <body><div itemprop="articleBody">${body}</div></body></html>`;
}

function fakeContent() {
  const objects = new Map();
  return {
    objects,
    async put(key, value) {
      objects.set(key, String(value));
    },
    async get(key) {
      const value = objects.get(key);
      return value === undefined ? null : { async text() { return value; } };
    },
    async delete(key) {
      objects.delete(key);
    },
  };
}

test("a scheduled run completes aggregate analysis without an internal admin token", async (t) => {
  const DB = migratedDatabase(t);
  const CONTENT = fakeContent();
  const rss = discoveryRss();
  const html = articleHtml();
  const requests = [];
  const fetchImpl = async (url) => {
    const target = String(url);
    requests.push(target);
    if (target.includes("/rss/rssdata/politic_news.xml")) {
      return new Response(rss, { status: 200, headers: { "content-type": "application/rss+xml" } });
    }
    if (target.includes("/article/202608101200001")) {
      return new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
    }
    return new Response("<rss><channel></channel></rss>", {
      status: 200,
      headers: { "content-type": "application/rss+xml" },
    });
  };
  const scheduledTime = Date.parse("2026-08-09T15:00:00.000Z");

  const result = await runScheduledAgendaFrame({
    DB,
    CONTENT,
  }, {
    scheduledTime,
    clockNow: scheduledTime,
    discoveryPolicy,
    discoveryFetchImpl: fetchImpl,
    sleepImpl: async () => {},
    workerId: "regression-test-worker",
  });

  assert.equal(result.status, "completed");
  assert.equal(result.lease.acquired, true);
  assert.equal(result.discovery.status, "success");
  assert.equal(result.discoveryPersistence.inserted, 1);
  assert.equal(result.bodyCollection.stored, 1);
  assert.equal(result.profileAnalysis.analyzed, 1);
  assert.equal(result.workBudget.discovery.endpointCount, 12);
  assert.equal(result.workBudget.bodyLimit, 5);
  assert.equal(result.workBudget.profileLimit, 5);
  assert.equal(result.workBudget.aggregateDateLimit, 1);
  assert.equal(result.aggregateAnalysis.length, 1);
  assert.equal(result.aggregateAnalysis[0].date, "2026-08-10");
  assert.equal(result.aggregateAnalysis[0].status, "analyzed");
  assert.equal(result.aggregateAnalysis[0].httpStatus, 201);
  assert.equal(result.aggregateAnalysis[0].issueCount, 1);
  assert.ok(result.aggregateAnalysis[0].runId);
  assert.deepEqual(result.stageErrors, []);
  assert.equal(result.operations.processed, true);
  assert.equal(requests.length, discoveryPolicy.sources.length + 1);
  assert.equal(CONTENT.objects.size, 1);
});

test("runStoredAnalysisForDates reports a missing database per date instead of throwing", async () => {
  const { runStoredAnalysisForDates } = await import("../worker/stored-body-analysis.mjs");
  const failures = await runStoredAnalysisForDates({}, discoveryPolicy, ["2026-08-10"]);
  assert.deepEqual(failures, [{
    date: "2026-08-10",
    status: "failed",
    httpStatus: 503,
    runId: null,
    issueCount: 0,
    error: "ANALYSIS_REQUEST_FAILED",
  }]);
});
