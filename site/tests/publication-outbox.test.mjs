import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  PUBLICATION_OUTBOX_DEFAULTS,
  PUBLICATION_OUTBOX_SCHEMA_SQL,
  PublicationOutboxConflictError,
  StalePublicationClaimError,
  claimDuePublicationEvents,
  computePublicationBackoffMs,
  createPublicationOutbox,
  enqueuePublicationEvent,
  hashPublicationPayload,
  initializePublicationOutbox,
  markPublicationFailure,
  reconcilePublicationOutbox,
  recordPublicationDelivery,
  recoverExpiredPublicationClaims,
  serializePublicationPayload,
} from "../worker/publication-outbox.mjs";

class FakeD1PreparedStatement {
  constructor(owner, sql, parameters = []) {
    this.owner = owner;
    this.sql = sql;
    this.parameters = parameters;
  }

  bind(...parameters) {
    return new FakeD1PreparedStatement(this.owner, this.sql, parameters);
  }

  async run() {
    return this.owner.execute(this, "run");
  }

  async all() {
    return this.owner.execute(this, "all");
  }

  async first(columnName) {
    const row = (await this.all()).results[0] ?? null;
    if (row === null || columnName === undefined) return row;
    return row[columnName];
  }
}

class FakeD1Database {
  constructor() {
    this.database = new DatabaseSync(":memory:");
    this.database.exec("PRAGMA foreign_keys = ON");
    this.preparedSql = [];
  }

  prepare(sql) {
    this.preparedSql.push(sql);
    return new FakeD1PreparedStatement(this, sql);
  }

  execute(boundStatement, requestedMode = "auto") {
    const statement = this.database.prepare(boundStatement.sql);
    const returnsRows = requestedMode === "all"
      || /^\s*(?:SELECT|PRAGMA|WITH)\b/i.test(boundStatement.sql)
      || /\bRETURNING\b/i.test(boundStatement.sql);
    if (returnsRows) {
      const results = statement.all(...boundStatement.parameters);
      const changes = /^\s*(?:INSERT|UPDATE|DELETE)\b/i.test(boundStatement.sql)
        ? Number(this.database.prepare("SELECT changes() AS count").get().count)
        : 0;
      return { success: true, results, meta: { changes } };
    }
    const result = statement.run(...boundStatement.parameters);
    return {
      success: true,
      results: [],
      meta: {
        changes: Number(result.changes),
        last_row_id: Number(result.lastInsertRowid),
      },
    };
  }

  async batch(statements) {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const results = statements.map((statement) => this.execute(statement));
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

async function createHarness(t, overrides = {}) {
  const db = new FakeD1Database();
  t.after(() => db.close());
  let currentTime = 1_800_000_000_000;
  const service = createPublicationOutbox({
    db,
    clock: () => currentTime,
    idGenerator: sequenceIds("test"),
    baseBackoffMs: 100,
    maxBackoffMs: 400,
    maxAttempts: 3,
    defaultLeaseMs: 50,
    ...overrides,
  });
  await service.initialize();
  return {
    db,
    service,
    now: () => currentTime,
    advance: (milliseconds) => {
      currentTime += milliseconds;
      return currentTime;
    },
  };
}

function eventInput(overrides = {}) {
  return {
    destination: "public-site",
    aggregateType: "issue",
    aggregateId: "issue-1",
    aggregateVersion: 1,
    eventType: "issue.published",
    payload: { issueId: "issue-1", summary: "private-token-like-value-is-data" },
    idempotencyKey: "publication:issue-1:v1",
    ...overrides,
  };
}

async function countRows(db, tableName) {
  const allowedTables = new Set(["publication_outbox_events", "publication_delivery_receipts"]);
  assert.ok(allowedTables.has(tableName));
  return Number((await db.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).first()).count);
}

test("exports a deterministic, explicit publication outbox surface", () => {
  assert.equal(typeof createPublicationOutbox, "function");
  assert.equal(typeof initializePublicationOutbox, "function");
  assert.equal(typeof enqueuePublicationEvent, "function");
  assert.equal(typeof claimDuePublicationEvents, "function");
  assert.equal(typeof recordPublicationDelivery, "function");
  assert.equal(typeof markPublicationFailure, "function");
  assert.equal(typeof recoverExpiredPublicationClaims, "function");
  assert.equal(typeof reconcilePublicationOutbox, "function");
  assert.equal(PUBLICATION_OUTBOX_SCHEMA_SQL.length, 5);
  assert.equal(PUBLICATION_OUTBOX_DEFAULTS.maxAttempts, 8);
  assert.equal(serializePublicationPayload({ z: 1, a: [true, null] }), '{"a":[true,null],"z":1}');
  assert.throws(() => serializePublicationPayload(new Array(1)), /sparse arrays/);
  assert.equal(computePublicationBackoffMs(1, { baseBackoffMs: 100, maxBackoffMs: 400 }), 100);
  assert.equal(computePublicationBackoffMs(2, { baseBackoffMs: 100, maxBackoffMs: 400 }), 200);
  assert.equal(computePublicationBackoffMs(20, { baseBackoffMs: 100, maxBackoffMs: 400 }), 400);
});

test("duplicate enqueue returns the immutable event and rejects conflicting reuse", async (t) => {
  const { db, service } = await createHarness(t);
  const input = eventInput({ idempotencyKey: "publication:'quoted':v1" });
  const payloadHash = await hashPublicationPayload(input.payload);

  const first = await service.enqueue({ ...input, payloadHash });
  const duplicate = await service.enqueue({
    ...input,
    payload: { summary: "private-token-like-value-is-data", issueId: "issue-1" },
    payloadHash,
  });

  assert.equal(first.inserted, true);
  assert.equal(duplicate.inserted, false);
  assert.equal(duplicate.event.id, first.event.id);
  assert.equal(duplicate.event.payloadHash, payloadHash);
  assert.equal(duplicate.event.payload, '{"issueId":"issue-1","summary":"private-token-like-value-is-data"}');
  assert.equal(await countRows(db, "publication_outbox_events"), 1);
  assert.ok(db.preparedSql.every((sql) => !sql.includes("private-token-like-value-is-data")));
  assert.ok(db.preparedSql.every((sql) => !sql.includes("publication:'quoted':v1")));

  await assert.rejects(
    service.enqueue(eventInput({
      aggregateId: "issue-other",
      idempotencyKey: input.idempotencyKey,
      payload: { issueId: "issue-other" },
    })),
    PublicationOutboxConflictError,
  );
  assert.equal(await countRows(db, "publication_outbox_events"), 1);
});

test("records one idempotent receipt and atomically marks the event delivered", async (t) => {
  const { db, service } = await createHarness(t);
  const { event } = await service.enqueue(eventInput());
  const claim = await service.claimDue({ destination: "public-site", workerId: "worker-a" });
  assert.equal(claim.events.length, 1);
  assert.equal(claim.events[0].attemptCount, 1);

  const delivery = {
    eventId: event.id,
    workerId: "worker-a",
    claimToken: claim.claimToken,
    destinationReceiptId: "destination-message-1",
  };
  const first = await service.recordDelivery(delivery);
  const duplicate = await service.recordDelivery(delivery);

  assert.equal(first.recorded, true);
  assert.equal(first.event.status, "delivered");
  assert.equal(duplicate.recorded, false);
  assert.equal(duplicate.receipt.id, first.receipt.id);
  assert.equal(duplicate.receipt.destinationReceiptId, "destination-message-1");
  assert.equal(await countRows(db, "publication_delivery_receipts"), 1);
  assert.equal((await service.claimDue({ destination: "public-site", workerId: "worker-b" })).events.length, 0);
});

test("rejects a stale worker after an expired event is recovered and reclaimed", async (t) => {
  const { db, service, advance } = await createHarness(t);
  const { event } = await service.enqueue(eventInput());
  const staleClaim = await service.claimDue({ destination: "public-site", workerId: "worker-stale", leaseMs: 25 });
  advance(25);
  await service.recoverExpiredClaims({ destination: "public-site" });
  const currentClaim = await service.claimDue({ destination: "public-site", workerId: "worker-current", leaseMs: 25 });

  await assert.rejects(service.recordDelivery({
    eventId: event.id,
    workerId: "worker-stale",
    claimToken: staleClaim.claimToken,
  }), StalePublicationClaimError);

  const row = await db.prepare(`
    SELECT status, claimed_by, claim_token
    FROM publication_outbox_events
    WHERE id = ?
  `).bind(event.id).first();
  assert.equal(row.status, "claimed");
  assert.equal(row.claimed_by, "worker-current");
  assert.equal(row.claim_token, currentClaim.claimToken);
  assert.equal(await countRows(db, "publication_delivery_receipts"), 0);

  await service.recordDelivery({
    eventId: event.id,
    workerId: "worker-current",
    claimToken: currentClaim.claimToken,
  });
  await assert.rejects(service.recordDelivery({
    eventId: event.id,
    workerId: "worker-stale",
    claimToken: staleClaim.claimToken,
  }), StalePublicationClaimError);
  assert.equal(await countRows(db, "publication_delivery_receipts"), 1);
});

test("schedules retryable failures with capped deterministic backoff", async (t) => {
  const { service, advance, now } = await createHarness(t);
  const { event } = await service.enqueue(eventInput());
  const claim = await service.claimDue({ destination: "public-site", workerId: "worker-a" });

  const failure = await service.markFailure({
    eventId: event.id,
    workerId: "worker-a",
    claimToken: claim.claimToken,
    retryable: true,
    errorCode: "DESTINATION_503",
  });
  assert.equal(failure.terminal, false);
  assert.equal(failure.backoffMs, 100);
  assert.equal(failure.nextAttemptAt, now() + 100);
  assert.equal(failure.event.status, "pending");
  assert.equal(failure.event.lastErrorCode, "DESTINATION_503");
  assert.equal((await service.claimDue({ destination: "public-site", workerId: "worker-early" })).events.length, 0);
  advance(99);
  assert.equal((await service.claimDue({ destination: "public-site", workerId: "worker-early" })).events.length, 0);
  advance(1);
  const retry = await service.claimDue({ destination: "public-site", workerId: "worker-retry" });
  assert.equal(retry.events.length, 1);
  assert.equal(retry.events[0].attemptCount, 2);
});

test("marks non-retryable failures terminal and never claims them again", async (t) => {
  const { service, advance } = await createHarness(t);
  const { event } = await service.enqueue(eventInput());
  const claim = await service.claimDue({ destination: "public-site", workerId: "worker-a" });

  const failure = await service.markFailure({
    eventId: event.id,
    workerId: "worker-a",
    claimToken: claim.claimToken,
    retryable: false,
    errorCode: "DESTINATION_REJECTED",
  });
  assert.equal(failure.terminal, true);
  assert.equal(failure.retryScheduled, false);
  assert.equal(failure.backoffMs, null);
  assert.equal(failure.nextAttemptAt, null);
  assert.equal(failure.event.status, "terminal");
  advance(10_000);
  assert.equal((await service.claimDue({ destination: "public-site", workerId: "worker-b" })).events.length, 0);
});

test("recovers an expired claim into an immediately due pending event", async (t) => {
  const { db, service, advance, now } = await createHarness(t);
  const { event } = await service.enqueue(eventInput());
  await service.claimDue({ destination: "public-site", workerId: "worker-a", leaseMs: 25 });
  advance(25);

  const recovery = await service.recoverExpiredClaims({ destination: "public-site" });
  assert.equal(recovery.recoveredCount, 1);
  assert.equal(recovery.terminalCount, 0);
  assert.equal(recovery.events[0].status, "pending");
  assert.equal(recovery.events[0].availableAt, now());
  assert.equal(recovery.events[0].claimToken, null);
  assert.equal(recovery.events[0].claimedBy, null);
  assert.equal(recovery.events[0].leaseExpiresAt, null);

  const row = await db.prepare("SELECT attempt_count, last_error_code FROM publication_outbox_events WHERE id = ?")
    .bind(event.id)
    .first();
  assert.equal(Number(row.attempt_count), 1);
  assert.equal(row.last_error_code, "LEASE_EXPIRED");
  assert.equal((await service.claimDue({ destination: "public-site", workerId: "worker-b" })).events.length, 1);
});

test("reconciliation repairs both receipt-authoritative and delivered-authoritative state without resend", async (t) => {
  const { db, service, now } = await createHarness(t);
  const acknowledged = await service.enqueue(eventInput({ aggregateId: "issue-ack", idempotencyKey: "publication:ack:v1" }));
  const delivered = await service.enqueue(eventInput({ aggregateId: "issue-delivered", idempotencyKey: "publication:delivered:v1" }));

  await db.prepare(`
    INSERT INTO publication_delivery_receipts (
      id, event_id, destination, idempotency_key, payload_hash,
      claim_token, claimed_by, destination_receipt_id, delivered_at, created_at, source
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'delivery')
  `).bind(
    "manual-receipt-ack",
    acknowledged.event.id,
    acknowledged.event.destination,
    acknowledged.event.idempotencyKey,
    acknowledged.event.payloadHash,
    "historical-claim-token",
    "historical-worker",
    "destination-ack",
    now() - 10,
    now() - 10,
  ).run();
  await db.prepare(`
    UPDATE publication_outbox_events
    SET status = 'delivered', delivered_at = ?, updated_at = ?
    WHERE id = ?
  `).bind(now() - 5, now() - 5, delivered.event.id).run();

  const preReconciliationClaim = await service.claimDue({ destination: "public-site", workerId: "worker-must-not-resend" });
  assert.equal(preReconciliationClaim.events.length, 0);

  const reconciliation = await service.reconcile({ destination: "public-site" });
  assert.deepEqual(reconciliation, {
    receiptsCreated: 1,
    eventsMarkedDelivered: 1,
    conflicts: [],
  });
  assert.equal(await countRows(db, "publication_delivery_receipts"), 2);

  const states = (await db.prepare(`
    SELECT id, status, delivered_at, claim_token
    FROM publication_outbox_events
    ORDER BY id
  `).all()).results;
  assert.equal(states.length, 2);
  assert.ok(states.every((row) => row.status === "delivered"));
  assert.ok(states.every((row) => row.delivered_at !== null));
  assert.ok(states.every((row) => row.claim_token === null));
  assert.equal((await service.claimDue({ destination: "public-site", workerId: "worker-after-repair" })).events.length, 0);

  const secondPass = await service.reconcile({ destination: "public-site" });
  assert.deepEqual(secondPass, {
    receiptsCreated: 0,
    eventsMarkedDelivered: 0,
    conflicts: [],
  });
});


test("fails closed when a receipt identity drifts from its acknowledged event", async (t) => {
  const { db, service, now } = await createHarness(t);
  const { event } = await service.enqueue(eventInput());
  await db.prepare(`
    INSERT INTO publication_delivery_receipts (
      id, event_id, destination, idempotency_key, payload_hash,
      claim_token, claimed_by, destination_receipt_id, delivered_at, created_at, source
    ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, 'delivery')
  `).bind(
    "drifted-receipt",
    event.id,
    "drifted-destination",
    event.idempotencyKey,
    event.payloadHash,
    "historical-claim",
    "historical-worker",
    now() - 1,
    now() - 1,
  ).run();

  const claim = await service.claimDue({ destination: "public-site", workerId: "worker-must-not-resend" });
  assert.equal(claim.events.length, 0);
  const reconciliation = await service.reconcile({ destination: "public-site" });
  assert.equal(reconciliation.receiptsCreated, 0);
  assert.equal(reconciliation.eventsMarkedDelivered, 0);
  assert.deepEqual(reconciliation.conflicts, [{
    eventId: event.id,
    receiptId: "drifted-receipt",
    reason: "RECEIPT_EVENT_MISMATCH",
  }]);
  assert.equal((await db.prepare("SELECT status FROM publication_outbox_events WHERE id = ?").bind(event.id).first()).status, "pending");
});