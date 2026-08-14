import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  PUBLICATION_DESTINATION,
  compactCollectionRunResult,
  handleOperationsAdminRequest,
  listOpenDeadLetters,
  readOperationsStatus,
  runScheduledOperations,
} from "../worker/operations.mjs";
import {
  createDurableJobsService,
  initializeDurableJobs,
} from "../worker/durable-jobs.mjs";
import {
  createPublicationOutbox,
  initializePublicationOutbox,
} from "../worker/publication-outbox.mjs";

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

function sequenceIds(prefix) {
  let sequence = 0;
  return (kind) => `${prefix}-${String(kind).replaceAll(" ", "-")}-${++sequence}`;
}

async function createHarness(t, { runStatus = "success" } = {}) {
  const DB = new SqliteD1();
  t.after(() => DB.close());
  await initializeDurableJobs(DB);
  await initializePublicationOutbox(DB);
  DB.database.exec(`
    CREATE TABLE analysis_runs (id TEXT PRIMARY KEY, status TEXT NOT NULL);
    CREATE TABLE issues (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, issue_date TEXT NOT NULL);
    CREATE TABLE issue_frame_comparisons (issue_id TEXT PRIMARY KEY, schema_version TEXT NOT NULL);
  `);
  DB.database.prepare("INSERT INTO analysis_runs (id, status) VALUES (?, ?)").run("run-1", runStatus);
  DB.database.prepare("INSERT INTO issues (id, run_id, issue_date) VALUES (?, ?, ?)")
    .run("issue-1", "run-1", "2026-08-01");
  DB.database.prepare("INSERT INTO issue_frame_comparisons (issue_id, schema_version) VALUES (?, ?)")
    .run("issue-1", "issue-frame-comparison-v3");
  return { DB, env: { DB, IMPORT_TOKEN: "test-admin-token" } };
}

function publicationInput() {
  return {
    destination: PUBLICATION_DESTINATION,
    aggregateType: "issue",
    aggregateId: "issue-1",
    aggregateVersion: 1,
    eventType: "issue.published",
    idempotencyKey: "issue:issue-1:published:v1",
    payload: {
      schemaVersion: 1,
      issueId: "issue-1",
      runId: "run-1",
      targetDate: "2026-08-01",
      publicApiVersion: "agendaframe-public-v5",
      comparisonSchemaVersion: "issue-frame-comparison-v3",
    },
  };
}

test("scheduled maintenance checkpoints phases and records a local idempotent publication receipt", async (t) => {
  const { DB, env } = await createHarness(t);
  let now = 1_800_000_000_000;
  const outbox = createPublicationOutbox({
    db: DB,
    clock: () => now,
    idGenerator: sequenceIds("outbox"),
  });
  await outbox.enqueue(publicationInput());

  const result = await runScheduledOperations(env, {
    scheduledTime: now,
    workerId: "scheduled-worker-1",
    clock: () => now,
    idGenerator: sequenceIds("operations"),
  });

  assert.equal(result.processed, true);
  assert.equal(result.status, "succeeded");
  assert.deepEqual(result.summary.delivery, { claimed: 1, delivered: 1, retried: 0, terminal: 0 });
  const event = { ...DB.database.prepare("SELECT status, attempt_count FROM publication_outbox_events").get() };
  assert.deepEqual(event, { status: "delivered", attempt_count: 1 });
  assert.equal(DB.database.prepare("SELECT COUNT(*) AS count FROM publication_delivery_receipts").get().count, 1);
  const job = DB.database.prepare("SELECT status, checkpoint_version, checkpoint_json, lease_token FROM durable_jobs").get();
  assert.equal(job.status, "succeeded");
  assert.equal(job.checkpoint_version, 3);
  assert.equal(JSON.parse(job.checkpoint_json).phase, 3);
  assert.equal(job.lease_token, null);

  const status = await readOperationsStatus(env);
  assert.deepEqual(status.jobs, [{ status: "succeeded", count: 1 }]);
  assert.deepEqual(status.outbox, [{ status: "delivered", count: 1 }]);
  assert.equal(status.openDeadLetters, 0);
});

test("publication stays retryable until the analysis run is committed", async (t) => {
  const { DB, env } = await createHarness(t, { runStatus: "running" });
  let now = 1_800_000_000_000;
  const outbox = createPublicationOutbox({
    db: DB,
    clock: () => now,
    idGenerator: sequenceIds("outbox"),
    baseBackoffMs: 5_000,
    maxBackoffMs: 5_000,
  });
  await outbox.enqueue(publicationInput());

  const first = await runScheduledOperations(env, {
    scheduledTime: now,
    workerId: "scheduled-worker-not-ready",
    clock: () => now,
    idGenerator: sequenceIds("operations-a"),
  });
  assert.deepEqual(first.summary.delivery, { claimed: 1, delivered: 0, retried: 1, terminal: 0 });
  assert.deepEqual(
    { ...DB.database.prepare("SELECT status, last_error_code FROM publication_outbox_events").get() },
    { status: "pending", last_error_code: "AGGREGATE_NOT_READY" },
  );

  DB.database.prepare("UPDATE analysis_runs SET status = 'success' WHERE id = 'run-1'").run();
  now += 5_000;
  const second = await runScheduledOperations(env, {
    scheduledTime: now + 60_000,
    workerId: "scheduled-worker-ready",
    clock: () => now,
    idGenerator: sequenceIds("operations-b"),
  });
  assert.deepEqual(second.summary.delivery, { claimed: 1, delivered: 1, retried: 0, terminal: 0 });
  assert.equal(DB.database.prepare("SELECT status FROM publication_outbox_events").get().status, "delivered");
});

test("admin operations endpoints fail closed and expose DLQ metadata without payloads", async (t) => {
  const { DB, env } = await createHarness(t);
  let now = 10_000;
  const jobs = createDurableJobsService(DB, {
    clock: () => now,
    idGenerator: sequenceIds("job"),
    leaseTokenGenerator: sequenceIds("lease"),
    retryBaseDelayMs: 0,
    retryMaxDelayMs: 0,
  });
  const { job } = await jobs.enqueueUniqueJob({
    queue: "analysis",
    jobType: "fixture",
    uniqueKey: "fixture-1",
    payload: { secretLikeData: "must-not-be-listed" },
    maxAttempts: 1,
  });
  const lease = await jobs.acquireDueJob({ queue: "analysis", leaseOwner: "fixture-worker" });
  await jobs.failJob({
    jobId: lease.id,
    leaseOwner: lease.leaseOwner,
    leaseToken: lease.leaseToken,
    failureCode: "FIXTURE_FAILURE",
  });

  const unauthorized = await handleOperationsAdminRequest(
    new Request("https://example.test/api/admin/jobs/dead-letters", {
      headers: { authorization: "Bearer wrong" },
    }),
    env,
  );
  assert.equal(unauthorized.status, 401);
  const unauthorizedCollection = await handleOperationsAdminRequest(
    new Request("https://example.test/api/admin/collection/status", {
      headers: { authorization: "Bearer wrong" },
    }),
    env,
  );
  assert.equal(unauthorizedCollection.status, 401);

  const headers = {
    authorization: "Bearer test-admin-token",
    origin: "https://example.test",
    "sec-fetch-site": "same-origin",
  };
  const listed = await handleOperationsAdminRequest(
    new Request("https://example.test/api/admin/jobs/dead-letters", { headers }),
    env,
  );
  assert.equal(listed.status, 200);
  const listedBody = await listed.json();
  assert.equal(listedBody.deadLetters.length, 1);
  assert.equal(listedBody.deadLetters[0].jobId, job.id);
  assert.equal(JSON.stringify(listedBody).includes("must-not-be-listed"), false);
  assert.equal("payload" in listedBody.deadLetters[0], false);
  assert.deepEqual(await listOpenDeadLetters(env), listedBody.deadLetters);

  now += 1;
  const redriven = await handleOperationsAdminRequest(
    new Request(`https://example.test/api/admin/jobs/${encodeURIComponent(job.id)}/redrive`, {
      method: "POST",
      headers,
    }),
    env,
  );
  assert.equal(redriven.status, 200);
  assert.equal(DB.database.prepare("SELECT status FROM durable_jobs WHERE id = ?").get(job.id).status, "queued");
  assert.equal((await listOpenDeadLetters(env)).length, 0);
});

test("additive migration creates durable jobs and publication outbox constraints", async () => {
  const migration = await readFile(new URL("../drizzle/0007_durable_operations.sql", import.meta.url), "utf8");
  const database = new DatabaseSync(":memory:");
  try {
    database.exec(migration.replaceAll("--> statement-breakpoint", ""));
    const tables = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all()
      .map((row) => row.name);
    assert.ok(tables.includes("durable_jobs"));
    assert.ok(tables.includes("durable_job_dead_letters"));
    assert.ok(tables.includes("publication_outbox_events"));
    assert.ok(tables.includes("publication_delivery_receipts"));
    assert.throws(() => database.prepare(`
      INSERT INTO durable_jobs (
        id, queue, job_type, unique_key, payload_json, status, priority,
        available_at, attempt_count, max_attempts, created_at, updated_at
      ) VALUES ('invalid', 'q', 't', 'k', '{}', 'running', 0, 0, 0, 1, 0, 0)
    `).run(), /CHECK constraint failed/);
  } finally {
    database.close();
  }
});

test("collection admin responses summarize records instead of returning article payloads", () => {
  const compact = compactCollectionRunResult({
    status: "completed_with_errors",
    scheduledTime: 123,
    lease: { acquired: true },
    discovery: {
      status: "success",
      records: [{ title: "must not be returned", body: "must not be returned" }],
      sources: [{ sourceId: "daily", status: "success", discovered: 1, diagnostics: [{ code: "OK" }] }],
    },
    bodyCollection: { status: "success", selected: 1, stored: 1, failed: 0, results: [{ body: "private" }] },
    profileAnalysis: { status: "success", selected: 1, analyzed: 1, failed: 0, dates: ["2026-08-13"], results: [{ profile: "private" }] },
    aggregateAnalysis: [{ date: "2026-08-13", status: "failed", error: "ANALYSIS_RUNTIME_FAILED" }],
    stageErrors: [{ stage: "aggregate_analysis", code: "ANALYSIS_RUNTIME_FAILED", date: "2026-08-13" }],
  });

  assert.equal(compact.discovery.discovered, 1);
  assert.deepEqual(compact.discovery.sources, [{ sourceId: "daily", status: "success", discovered: 1, truncated: false }]);
  assert.equal(compact.bodyCollection.stored, 1);
  assert.equal(compact.profileAnalysis.analyzed, 1);
  assert.equal(JSON.stringify(compact).includes("must not be returned"), false);
  assert.equal(JSON.stringify(compact).includes("private"), false);
});
