import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  acquireCollectionRunLease,
  releaseCollectionRunLease,
} from "../worker/collection-run-lease.mjs";
import { runScheduledAgendaFrame } from "../worker/content-retention.mjs";

class Statement {
  constructor(database, sql, parameters = []) {
    this.database = database;
    this.sql = sql;
    this.parameters = parameters;
  }

  bind(...parameters) {
    return new Statement(this.database, this.sql, parameters);
  }

  async first() {
    return this.database.prepare(this.sql).get(...this.parameters) ?? null;
  }

  async run() {
    const result = this.database.prepare(this.sql).run(...this.parameters);
    return { success: true, meta: { changes: Number(result.changes) } };
  }
}

function harness(t) {
  const database = new DatabaseSync(":memory:");
  const migration = readFileSync(new URL("../drizzle/0011_collection_execution_lock.sql", import.meta.url), "utf8");
  database.exec(migration);
  t.after(() => database.close());
  return { prepare: (sql) => new Statement(database, sql) };
}

test("allows one collection owner and rejects an overlapping cron or manual run", async (t) => {
  const db = harness(t);
  const first = await acquireCollectionRunLease(db, {
    now: 10_000,
    leaseMs: 20_000,
    owner: "cron-a",
    token: "lease-a",
  });
  const overlap = await acquireCollectionRunLease(db, {
    now: 10_001,
    leaseMs: 20_000,
    owner: "manual-b",
    token: "lease-b",
  });
  assert.equal(first.owner, "cron-a");
  assert.equal(first.leaseExpiresAt, 30_000);
  assert.equal(overlap, null);
});

test("an expired lease can be replaced and a stale owner cannot release it", async (t) => {
  const db = harness(t);
  const first = await acquireCollectionRunLease(db, {
    now: 10_000,
    leaseMs: 1_000,
    owner: "worker-a",
    token: "lease-a",
  });
  const replacement = await acquireCollectionRunLease(db, {
    now: 11_000,
    leaseMs: 1_000,
    owner: "worker-b",
    token: "lease-b",
  });
  assert.equal(replacement.owner, "worker-b");
  assert.equal(await releaseCollectionRunLease(db, first), false);
  assert.equal(await releaseCollectionRunLease(db, replacement), true);
  const afterRelease = await acquireCollectionRunLease(db, {
    now: 11_001,
    leaseMs: 1_000,
    owner: "worker-c",
    token: "lease-c",
  });
  assert.equal(afterRelease.owner, "worker-c");
});

test("the scheduled workflow exits before retention or publisher work when another run owns the lease", async (t) => {
  const db = harness(t);
  await acquireCollectionRunLease(db, {
    now: 10_000,
    leaseMs: 20_000,
    owner: "active-worker",
    token: "active-lease",
  });
  let contentCalls = 0;
  const result = await runScheduledAgendaFrame({
    DB: db,
    CONTENT: { async delete() { contentCalls += 1; } },
  }, {
    scheduledTime: 10_001,
    clockNow: 10_001,
    workerId: "overlapping-worker",
    leaseToken: "overlapping-lease",
  });
  assert.equal(result.status, "skipped_overlap");
  assert.equal(result.lease.acquired, false);
  assert.equal(contentCalls, 0);
});

test("migration journal includes every checked-in migration through the collection lock", () => {
  const journal = JSON.parse(readFileSync(new URL("../drizzle/meta/_journal.json", import.meta.url), "utf8"));
  const expectedTags = [
    "0000_numerous_quasar",
    "0001_easy_dexter_bennett",
    "0002_colorful_master_mold",
    "0003_complex_mikhail_rasputin",
    "0004_colossal_kylun",
    "0005_structured_frame_profiles",
    "0006_analysis_query_indexes",
    "0007_durable_operations",
    "0008_community_guardrails",
    "0009_community_service",
    "0010_reaction_rate_limit",
    "0011_collection_execution_lock",
    "0012_article_collection_attempts",
  ];
  assert.deepEqual(journal.entries.map((entry) => entry.tag), expectedTags);
  assert.deepEqual(journal.entries.map((entry) => entry.idx), expectedTags.map((_tag, index) => index));
  for (const entry of journal.entries) {
    const sql = readFileSync(new URL(`../drizzle/${entry.tag}.sql`, import.meta.url), "utf8");
    assert.ok(sql.trim(), `${entry.tag} must have a non-empty SQL migration`);
  }
});
