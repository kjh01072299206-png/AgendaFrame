import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  AdminAuthorizationError,
  CheckpointConflictError,
  DURABLE_JOBS_SCHEMA,
  DURABLE_JOB_STATUSES,
  InvalidJobStateError,
  StaleLeaseError,
  calculateRetryDelay,
  createDurableJobsService,
  initializeDurableJobs,
} from "../worker/durable-jobs.mjs";

function clone(value) {
  return structuredClone(value);
}

function result(rows = [], changes = 0) {
  return { success: true, results: rows.map(clone), meta: { changes } };
}

class FakeD1Statement {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql;
    this.parameters = [];
  }

  bind(...parameters) {
    this.parameters = parameters;
    return this;
  }

  async first() {
    return (this.db.execute(this).results ?? [])[0] ?? null;
  }

  async all() {
    return this.db.execute(this);
  }

  async run() {
    return this.db.execute(this);
  }
}

class FakeD1 {
  constructor() {
    this.jobs = new Map();
    this.deadLetters = new Map();
    this.calls = [];
  }

  prepare(sql) {
    return new FakeD1Statement(this, sql);
  }

  async batch(statements) {
    const jobsBefore = clone([...this.jobs]);
    const deadLettersBefore = clone([...this.deadLetters]);
    try {
      return statements.map((statement) => this.execute(statement));
    } catch (error) {
      this.jobs = new Map(jobsBefore);
      this.deadLetters = new Map(deadLettersBefore);
      throw error;
    }
  }

  execute(statement) {
    const tag = /\/\* durable_jobs:([a-z_]+) \*\//.exec(statement.sql)?.[1];
    if (!tag) throw new Error("Unexpected untagged durable-jobs SQL.");
    const parameters = statement.parameters;
    this.calls.push({ tag, sql: statement.sql, parameters: clone(parameters) });

    switch (tag) {
      case "get": {
        const job = this.jobs.get(parameters[0]);
        return result(job ? [job] : []);
      }
      case "get_unique": {
        const [queue, jobType, uniqueKey] = parameters;
        const job = [...this.jobs.values()].find((candidate) => (
          candidate.queue === queue
          && candidate.jobType === jobType
          && candidate.uniqueKey === uniqueKey
        ));
        return result(job ? [job] : []);
      }
      case "enqueue":
        return this.enqueue(parameters);
      case "acquire":
        return this.acquire(parameters);
      case "lease_state": {
        const job = this.jobs.get(parameters[0]);
        if (!job) return result();
        return result([{
          id: job.id,
          status: job.status,
          attemptCount: job.attemptCount,
          maxAttempts: job.maxAttempts,
          leaseOwner: job.leaseOwner,
          leaseToken: job.leaseToken,
          leaseExpiresAt: job.leaseExpiresAt,
          checkpointVersion: job.checkpointVersion,
        }]);
      }
      case "heartbeat":
        return this.heartbeat(parameters);
      case "checkpoint":
        return this.checkpoint(parameters);
      case "complete":
        return this.complete(parameters);
      case "fail_retry":
        return this.failRetry(parameters);
      case "fail_terminal":
        return this.failTerminal(parameters);
      case "insert_dead_letter":
        return this.insertDeadLetter(parameters, false);
      case "expired_candidates":
        return this.expiredCandidates(parameters);
      case "recover_retry":
        return this.recoverRetry(parameters);
      case "recover_terminal":
        return this.recoverTerminal(parameters);
      case "insert_recovered_dead_letter":
        return this.insertDeadLetter(parameters, true);
      case "redrive_state": {
        const job = this.jobs.get(parameters[0]);
        return result(job ? [{ status: job.status, deadLetterId: job.deadLetterId }] : []);
      }
      case "redrive_prepare":
        return this.redrivePrepare(parameters);
      case "mark_dead_letter_redriven":
        return this.markDeadLetterRedriven(parameters);
      case "redrive_finalize":
        return this.redriveFinalize(parameters);
      case "cancel":
        return this.cancel(parameters);
      default:
        throw new Error(`Unexpected durable-jobs SQL tag: ${tag}`);
    }
  }

  enqueue(parameters) {
    const [
      id,
      queue,
      jobType,
      uniqueKey,
      payloadJson,
      priority,
      availableAt,
      maxAttempts,
      checkpointJson,
      createdAt,
      updatedAt,
    ] = parameters;
    const duplicate = [...this.jobs.values()].some((job) => (
      job.queue === queue && job.jobType === jobType && job.uniqueKey === uniqueKey
    ));
    if (duplicate) return result();
    const job = {
      id,
      queue,
      jobType,
      uniqueKey,
      payloadJson,
      status: "queued",
      priority,
      availableAt,
      attemptCount: 0,
      maxAttempts,
      leaseOwner: null,
      leaseToken: null,
      leaseExpiresAt: null,
      checkpointJson,
      checkpointVersion: 0,
      failureCode: null,
      deadLetterId: null,
      startedAt: null,
      completedAt: null,
      createdAt,
      updatedAt,
    };
    this.jobs.set(id, job);
    return result([job], 1);
  }

  acquire(parameters) {
    const [queue, dueAt, expiredAt, leaseOwner, leaseToken, leaseExpiresAt, startedAt, updatedAt] = parameters;
    const candidates = [...this.jobs.values()].filter((job) => (
      job.queue === queue
      && job.attemptCount < job.maxAttempts
      && (
        (["queued", "retry_wait"].includes(job.status) && job.availableAt <= dueAt)
        || (job.status === "running" && job.leaseExpiresAt <= expiredAt)
      )
    ));
    candidates.sort((left, right) => (
      right.priority - left.priority
      || (left.status === "running" ? left.leaseExpiresAt : left.availableAt)
        - (right.status === "running" ? right.leaseExpiresAt : right.availableAt)
      || left.createdAt - right.createdAt
      || left.id.localeCompare(right.id)
    ));
    const job = candidates[0];
    if (!job) return result();
    const wasExpiredLease = job.status === "running";
    Object.assign(job, {
      status: "running",
      attemptCount: job.attemptCount + 1,
      leaseOwner,
      leaseToken,
      leaseExpiresAt,
      failureCode: wasExpiredLease ? "LEASE_EXPIRED" : null,
      deadLetterId: null,
      startedAt: job.startedAt ?? startedAt,
      completedAt: null,
      updatedAt,
    });
    return result([job], 1);
  }

  heartbeat(parameters) {
    const [leaseExpiresAt, updatedAt, jobId, leaseOwner, leaseToken, activeAfter] = parameters;
    const job = this.jobs.get(jobId);
    if (!this.currentLease(job, leaseOwner, leaseToken, activeAfter)) return result();
    Object.assign(job, {
      leaseExpiresAt: Math.max(job.leaseExpiresAt, leaseExpiresAt),
      updatedAt: Math.max(job.updatedAt, updatedAt),
    });
    return result([job], 1);
  }

  checkpoint(parameters) {
    const [checkpointJson, updatedAt, jobId, leaseOwner, leaseToken, activeAfter, expectedVersion] = parameters;
    const job = this.jobs.get(jobId);
    if (!this.currentLease(job, leaseOwner, leaseToken, activeAfter) || job.checkpointVersion !== expectedVersion) {
      return result();
    }
    Object.assign(job, {
      checkpointJson,
      checkpointVersion: job.checkpointVersion + 1,
      updatedAt,
    });
    return result([job], 1);
  }

  complete(parameters) {
    const [completedAt, updatedAt, jobId, leaseOwner, leaseToken, activeAfter] = parameters;
    const job = this.jobs.get(jobId);
    if (!this.currentLease(job, leaseOwner, leaseToken, activeAfter)) return result();
    Object.assign(job, {
      status: "succeeded",
      leaseOwner: null,
      leaseToken: null,
      leaseExpiresAt: null,
      failureCode: null,
      deadLetterId: null,
      completedAt,
      updatedAt,
    });
    return result([job], 1);
  }

  failRetry(parameters) {
    const [retryAt, failureCode, updatedAt, jobId, leaseOwner, leaseToken, activeAfter, attemptCount] = parameters;
    const job = this.jobs.get(jobId);
    if (!this.currentLease(job, leaseOwner, leaseToken, activeAfter) || job.attemptCount !== attemptCount) {
      return result();
    }
    Object.assign(job, {
      status: "retry_wait",
      availableAt: retryAt,
      leaseOwner: null,
      leaseToken: null,
      leaseExpiresAt: null,
      failureCode,
      deadLetterId: null,
      completedAt: null,
      updatedAt,
    });
    return result([job], 1);
  }

  failTerminal(parameters) {
    const [
      failureCode,
      deadLetterId,
      completedAt,
      updatedAt,
      jobId,
      leaseOwner,
      leaseToken,
      activeAfter,
      attemptCount,
    ] = parameters;
    const job = this.jobs.get(jobId);
    if (!this.currentLease(job, leaseOwner, leaseToken, activeAfter) || job.attemptCount !== attemptCount) {
      return result();
    }
    Object.assign(job, {
      status: "dead_lettered",
      leaseOwner: null,
      leaseToken: null,
      leaseExpiresAt: null,
      failureCode,
      deadLetterId,
      completedAt,
      updatedAt,
    });
    return result([job], 1);
  }

  insertDeadLetter(parameters, recovered) {
    const [deadLetterId, failureCodeOrAt, deadLetteredAtOrJobId, jobIdOrDeadLetterId, expectedDeadLetterId] = parameters;
    const failureCode = recovered ? "LEASE_EXPIRED_MAX_ATTEMPTS" : failureCodeOrAt;
    const deadLetteredAt = recovered ? failureCodeOrAt : deadLetteredAtOrJobId;
    const jobId = recovered ? deadLetteredAtOrJobId : jobIdOrDeadLetterId;
    const marker = recovered ? jobIdOrDeadLetterId : expectedDeadLetterId;
    const job = this.jobs.get(jobId);
    if (!job || job.status !== "dead_lettered" || job.deadLetterId !== marker) return result();
    if (this.deadLetters.has(deadLetterId)) throw new Error("Duplicate dead-letter ID.");
    const deadLetter = {
      id: deadLetterId,
      jobId,
      queue: job.queue,
      jobType: job.jobType,
      reasonCode: failureCode,
      attemptCount: job.attemptCount,
      checkpointVersion: job.checkpointVersion,
      deadLetteredAt,
      redrivenAt: null,
      redrivenBy: null,
    };
    this.deadLetters.set(deadLetterId, deadLetter);
    return result([], 1);
  }

  expiredCandidates(parameters) {
    const [expiredAt, nullableQueue, queue, limit] = parameters;
    const jobs = [...this.jobs.values()]
      .filter((job) => (
        job.status === "running"
        && job.leaseExpiresAt <= expiredAt
        && (nullableQueue === null || job.queue === queue)
      ))
      .sort((left, right) => (
        left.leaseExpiresAt - right.leaseExpiresAt
        || left.createdAt - right.createdAt
        || left.id.localeCompare(right.id)
      ))
      .slice(0, limit)
      .map((job) => ({
        id: job.id,
        attemptCount: job.attemptCount,
        maxAttempts: job.maxAttempts,
        leaseToken: job.leaseToken,
        leaseExpiresAt: job.leaseExpiresAt,
      }));
    return result(jobs);
  }

  recoverRetry(parameters) {
    const [retryAt, updatedAt, jobId, leaseToken, leaseExpiresAt, expiredAt, attemptCount] = parameters;
    const job = this.jobs.get(jobId);
    if (!job || job.status !== "running" || job.leaseToken !== leaseToken
      || job.leaseExpiresAt !== leaseExpiresAt || job.leaseExpiresAt > expiredAt
      || job.attemptCount !== attemptCount) {
      return result();
    }
    Object.assign(job, {
      status: "retry_wait",
      availableAt: retryAt,
      leaseOwner: null,
      leaseToken: null,
      leaseExpiresAt: null,
      failureCode: "LEASE_EXPIRED",
      deadLetterId: null,
      completedAt: null,
      updatedAt,
    });
    return result([{ id: job.id }], 1);
  }

  recoverTerminal(parameters) {
    const [deadLetterId, completedAt, updatedAt, jobId, leaseToken, leaseExpiresAt, expiredAt, attemptCount] = parameters;
    const job = this.jobs.get(jobId);
    if (!job || job.status !== "running" || job.leaseToken !== leaseToken
      || job.leaseExpiresAt !== leaseExpiresAt || job.leaseExpiresAt > expiredAt
      || job.attemptCount !== attemptCount) {
      return result();
    }
    Object.assign(job, {
      status: "dead_lettered",
      leaseOwner: null,
      leaseToken: null,
      leaseExpiresAt: null,
      failureCode: "LEASE_EXPIRED_MAX_ATTEMPTS",
      deadLetterId,
      completedAt,
      updatedAt,
    });
    return result([{ id: job.id }], 1);
  }

  redrivePrepare(parameters) {
    const [availableAt, updatedAt, jobId, deadLetterId, openDeadLetterId, openJobId] = parameters;
    const job = this.jobs.get(jobId);
    const deadLetter = this.deadLetters.get(openDeadLetterId);
    if (!job || job.status !== "dead_lettered" || job.deadLetterId !== deadLetterId
      || !deadLetter || deadLetter.jobId !== openJobId || deadLetter.redrivenAt !== null) {
      return result();
    }
    Object.assign(job, {
      status: "queued",
      availableAt,
      attemptCount: 0,
      leaseOwner: null,
      leaseToken: null,
      leaseExpiresAt: null,
      failureCode: null,
      startedAt: null,
      completedAt: null,
      updatedAt,
    });
    return result([{ id: job.id }], 1);
  }

  markDeadLetterRedriven(parameters) {
    const [redrivenAt, redrivenBy, deadLetterId, jobId, preparedJobId, preparedDeadLetterId] = parameters;
    const deadLetter = this.deadLetters.get(deadLetterId);
    const job = this.jobs.get(preparedJobId);
    if (!deadLetter || deadLetter.jobId !== jobId || deadLetter.redrivenAt !== null
      || !job || job.status !== "queued" || job.deadLetterId !== preparedDeadLetterId) {
      return result();
    }
    Object.assign(deadLetter, { redrivenAt, redrivenBy });
    return result([], 1);
  }

  redriveFinalize(parameters) {
    const [jobId, deadLetterId, auditId, auditJobId, redrivenAt, redrivenBy] = parameters;
    const job = this.jobs.get(jobId);
    const deadLetter = this.deadLetters.get(auditId);
    if (!job || job.status !== "queued" || job.deadLetterId !== deadLetterId
      || !deadLetter || deadLetter.jobId !== auditJobId
      || deadLetter.redrivenAt !== redrivenAt || deadLetter.redrivenBy !== redrivenBy) {
      return result();
    }
    job.deadLetterId = null;
    return result([job], 1);
  }

  cancel(parameters) {
    const [completedAt, updatedAt, jobId, leaseOwner, leaseToken, activeAfter] = parameters;
    const job = this.jobs.get(jobId);
    const cancellable = job && (
      ["queued", "retry_wait"].includes(job.status)
      || this.currentLease(job, leaseOwner, leaseToken, activeAfter)
    );
    if (!cancellable) return result();
    Object.assign(job, {
      status: "cancelled",
      leaseOwner: null,
      leaseToken: null,
      leaseExpiresAt: null,
      failureCode: "CANCELLED",
      completedAt,
      updatedAt,
    });
    return result([job], 1);
  }

  currentLease(job, leaseOwner, leaseToken, activeAfter) {
    return Boolean(
      job
      && job.status === "running"
      && job.leaseOwner === leaseOwner
      && job.leaseToken === leaseToken
      && job.leaseExpiresAt > activeAfter,
    );
  }
}

class SqliteD1Statement {
  constructor(statement) {
    this.statement = statement;
    this.parameters = [];
  }

  bind(...parameters) {
    this.parameters = parameters;
    return this;
  }

  async first() {
    return this.statement.get(...this.parameters) ?? null;
  }

  async all() {
    return { results: this.statement.all(...this.parameters) };
  }

  async run() {
    const execution = this.statement.run(...this.parameters);
    return { success: true, results: [], meta: { changes: Number(execution.changes) } };
  }

  runInBatch() {
    if (this.statement.columns().length > 0) {
      const rows = this.statement.all(...this.parameters);
      return { success: true, results: rows, meta: { changes: rows.length } };
    }
    const execution = this.statement.run(...this.parameters);
    return { success: true, results: [], meta: { changes: Number(execution.changes) } };
  }
}

class SqliteD1 {
  constructor() {
    this.database = new DatabaseSync(":memory:");
  }

  prepare(sql) {
    return new SqliteD1Statement(this.database.prepare(sql));
  }

  async exec(sql) {
    this.database.exec(sql);
  }

  async batch(statements) {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const results = statements.map((statement) => statement.runInBatch());
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

function createHarness(options = {}) {
  let currentTime = options.now ?? 1_000;
  let sequence = 0;
  const db = new FakeD1();
  const deterministicId = (kind) => `${kind.replaceAll(" ", "-")}-${++sequence}`;
  const service = createDurableJobsService(db, {
    clock: () => currentTime,
    idGenerator: deterministicId,
    leaseTokenGenerator: deterministicId,
    authorizeAdmin: options.authorizeAdmin ?? (() => true),
    retryBaseDelayMs: options.retryBaseDelayMs ?? 100,
    retryMaxDelayMs: options.retryMaxDelayMs ?? 250,
    defaultLeaseMs: options.defaultLeaseMs ?? 100,
  });
  return {
    db,
    service,
    now: () => currentTime,
    setNow(value) {
      currentTime = value;
    },
    advance(milliseconds) {
      currentTime += milliseconds;
    },
  };
}

async function enqueue(service, overrides = {}) {
  return service.enqueueUniqueJob({
    queue: "analysis",
    jobType: "build_issue_frame",
    uniqueKey: overrides.uniqueKey ?? "issue-1",
    payload: { issueId: overrides.uniqueKey ?? "issue-1", marker: "fixture-payload" },
    ...overrides,
  });
}

test("exports the complete lifecycle and idempotently enqueues a parameterized unique job", async () => {
  assert.deepEqual(DURABLE_JOB_STATUSES, [
    "queued",
    "running",
    "retry_wait",
    "succeeded",
    "dead_lettered",
    "cancelled",
  ]);
  assert.match(DURABLE_JOBS_SCHEMA, /UNIQUE \(queue, job_type, unique_key\)/);
  assert.match(DURABLE_JOBS_SCHEMA, /durable_job_dead_letters/);

  const { db, service } = createHarness();
  const first = await enqueue(service, { checkpoint: { cursor: 2 } });
  const duplicate = await enqueue(service, {
    payload: { issueId: "replacement-must-not-win" },
    checkpoint: { cursor: 99 },
  });

  assert.equal(first.enqueued, true);
  assert.equal(duplicate.enqueued, false);
  assert.equal(duplicate.job.id, first.job.id);
  assert.deepEqual(duplicate.job.payload, first.job.payload);
  assert.deepEqual(duplicate.job.checkpoint, { cursor: 2 });
  assert.equal(db.jobs.size, 1);

  const insert = db.calls.find((call) => call.tag === "enqueue");
  assert.ok(insert.sql.includes("VALUES (?, ?, ?, ?, ?"));
  assert.equal(insert.sql.includes("fixture-payload"), false);
  assert.ok(insert.parameters.some((value) => String(value).includes("fixture-payload")));

  const customIdDb = new FakeD1();
  const customIdService = createDurableJobsService(customIdDb, {
    clock: () => 1_000,
    idGenerator: () => "predictable-job-id",
  });
  await enqueue(customIdService);
  const secureLease = await customIdService.acquireDueJob({ queue: "analysis", leaseOwner: "secure-worker" });
  assert.notEqual(secureLease.leaseToken, "predictable-job-id");
  assert.match(secureLease.leaseToken, /^[0-9a-f-]{36}$/);
});

test("atomically excludes active leases, takes expired leases, and rejects stale owners", async () => {
  const harness = createHarness({ now: 10_000 });
  const { service } = harness;
  const { job: queued } = await enqueue(service);
  const first = await service.acquireDueJob({ queue: "analysis", leaseOwner: "worker-a", leaseMs: 100 });
  assert.equal(first.id, queued.id);
  assert.equal(first.attemptCount, 1);
  const duplicateWhileRunning = await enqueue(service);
  assert.equal(duplicateWhileRunning.enqueued, false);
  assert.equal(duplicateWhileRunning.job.leaseToken, null);
  assert.equal((await service.getJob(first.id)).leaseToken, null);

  const excluded = await service.acquireDueJob({ queue: "analysis", leaseOwner: "worker-b", leaseMs: 100 });
  assert.equal(excluded, null);

  harness.setNow(10_100);
  const replacement = await service.acquireDueJob({ queue: "analysis", leaseOwner: "worker-b", leaseMs: 100 });
  assert.equal(replacement.id, queued.id);
  assert.equal(replacement.attemptCount, 2);
  assert.notEqual(replacement.leaseToken, first.leaseToken);
  assert.equal(replacement.failureCode, "LEASE_EXPIRED");

  await assert.rejects(
    service.renewLease({
      jobId: first.id,
      leaseOwner: first.leaseOwner,
      leaseToken: first.leaseToken,
    }),
    StaleLeaseError,
  );
  await assert.rejects(
    service.completeJob({
      jobId: first.id,
      leaseOwner: first.leaseOwner,
      leaseToken: first.leaseToken,
    }),
    StaleLeaseError,
  );

  const completed = await service.completeJob({
    jobId: replacement.id,
    leaseOwner: replacement.leaseOwner,
    leaseToken: replacement.leaseToken,
  });
  assert.equal(completed.status, "succeeded");
  assert.equal(completed.leaseToken, null);
  assert.equal(await service.acquireDueJob({ queue: "analysis", leaseOwner: "worker-c" }), null);
});

test("heartbeat renewal never shortens a current lease", async () => {
  const harness = createHarness({ now: 12_000 });
  const { service } = harness;
  await enqueue(service);
  const lease = await service.acquireDueJob({ queue: "analysis", leaseOwner: "heartbeat-worker", leaseMs: 500 });
  harness.advance(100);
  const extended = await service.renewLease({
    jobId: lease.id,
    leaseOwner: lease.leaseOwner,
    leaseToken: lease.leaseToken,
    leaseMs: 1_000,
  });
  assert.equal(extended.leaseExpiresAt, 13_100);
  assert.equal(extended.leaseToken, lease.leaseToken);

  harness.advance(100);
  const shorterRequest = await service.renewLease({
    jobId: lease.id,
    leaseOwner: lease.leaseOwner,
    leaseToken: lease.leaseToken,
    leaseMs: 100,
  });
  assert.equal(shorterRequest.leaseExpiresAt, 13_100);
});

test("updates checkpoints with compare-and-set semantics and preserves the winning version", async () => {
  const { service } = createHarness();
  await enqueue(service);
  const lease = await service.acquireDueJob({ queue: "analysis", leaseOwner: "checkpoint-worker" });
  const updated = await service.compareAndSetCheckpoint({
    jobId: lease.id,
    leaseOwner: lease.leaseOwner,
    leaseToken: lease.leaseToken,
    expectedVersion: 0,
    checkpoint: { articleOffset: 40, evidenceIds: ["evidence-1"] },
  });
  assert.equal(updated.checkpointVersion, 1);
  assert.deepEqual(updated.checkpoint, { articleOffset: 40, evidenceIds: ["evidence-1"] });

  await assert.rejects(
    service.compareAndSetCheckpoint({
      jobId: lease.id,
      leaseOwner: lease.leaseOwner,
      leaseToken: lease.leaseToken,
      expectedVersion: 0,
      checkpoint: { articleOffset: 80 },
    }),
    CheckpointConflictError,
  );
  const stored = await service.getJob(lease.id);
  assert.equal(stored.checkpointVersion, 1);
  assert.deepEqual(stored.checkpoint, updated.checkpoint);
});

test("uses deterministic capped exponential retry timing and keeps checkpoints across attempts", async () => {
  const harness = createHarness({ now: 2_000, retryBaseDelayMs: 100, retryMaxDelayMs: 250 });
  const { service } = harness;
  await enqueue(service, { maxAttempts: 4 });
  let lease = await service.acquireDueJob({ queue: "analysis", leaseOwner: "retry-worker" });
  lease = await service.compareAndSetCheckpoint({
    jobId: lease.id,
    leaseOwner: lease.leaseOwner,
    leaseToken: lease.leaseToken,
    expectedVersion: 0,
    checkpoint: { nextBatch: 3 },
  });

  const firstFailure = await service.failJob({
    jobId: lease.id,
    leaseOwner: lease.leaseOwner,
    leaseToken: lease.leaseToken,
    failureCode: "TEMPORARY_PROVIDER_ERROR",
  });
  assert.deepEqual(
    { delay: firstFailure.retryDelayMs, retryAt: firstFailure.retryAt },
    { delay: 100, retryAt: 2_100 },
  );
  harness.setNow(2_099);
  assert.equal(await service.acquireDueJob({ queue: "analysis", leaseOwner: "early-worker" }), null);

  harness.setNow(2_100);
  lease = await service.acquireDueJob({ queue: "analysis", leaseOwner: "retry-worker" });
  assert.equal(lease.attemptCount, 2);
  assert.deepEqual(lease.checkpoint, { nextBatch: 3 });
  const secondFailure = await service.failJob({
    jobId: lease.id,
    leaseOwner: lease.leaseOwner,
    leaseToken: lease.leaseToken,
  });
  assert.deepEqual(
    { delay: secondFailure.retryDelayMs, retryAt: secondFailure.retryAt },
    { delay: 200, retryAt: 2_300 },
  );

  harness.setNow(2_300);
  lease = await service.acquireDueJob({ queue: "analysis", leaseOwner: "retry-worker" });
  const thirdFailure = await service.failJob({
    jobId: lease.id,
    leaseOwner: lease.leaseOwner,
    leaseToken: lease.leaseToken,
  });
  assert.deepEqual(
    { delay: thirdFailure.retryDelayMs, retryAt: thirdFailure.retryAt },
    { delay: 250, retryAt: 2_550 },
  );
  assert.equal(calculateRetryDelay(20, { baseDelayMs: 100, maxDelayMs: 250 }), 250);

  harness.setNow(2_550);
  lease = await service.acquireDueJob({ queue: "analysis", leaseOwner: "retry-worker" });
  const succeeded = await service.completeJob({
    jobId: lease.id,
    leaseOwner: lease.leaseOwner,
    leaseToken: lease.leaseToken,
  });
  assert.equal(succeeded.status, "succeeded");
  assert.equal(succeeded.checkpointVersion, 1);
  assert.deepEqual(succeeded.checkpoint, { nextBatch: 3 });
});

test("atomically dead-letters a terminal failure without copying payload data", async () => {
  const harness = createHarness({ now: 3_000, retryBaseDelayMs: 10, retryMaxDelayMs: 10 });
  const { db, service } = harness;
  await enqueue(service, { maxAttempts: 2 });
  let lease = await service.acquireDueJob({ queue: "analysis", leaseOwner: "terminal-worker" });
  lease = await service.compareAndSetCheckpoint({
    jobId: lease.id,
    leaseOwner: lease.leaseOwner,
    leaseToken: lease.leaseToken,
    expectedVersion: 0,
    checkpoint: { completedSources: ["source-a"] },
  });
  const retry = await service.failJob({
    jobId: lease.id,
    leaseOwner: lease.leaseOwner,
    leaseToken: lease.leaseToken,
    failureCode: "RETRYABLE_FAILURE",
  });
  harness.setNow(retry.retryAt);
  lease = await service.acquireDueJob({ queue: "analysis", leaseOwner: "terminal-worker" });
  const terminal = await service.failJob({
    jobId: lease.id,
    leaseOwner: lease.leaseOwner,
    leaseToken: lease.leaseToken,
    failureCode: "VALIDATION_EXHAUSTED",
  });

  assert.equal(terminal.deadLettered, true);
  assert.equal(terminal.job.status, "dead_lettered");
  assert.equal(terminal.job.checkpointVersion, 1);
  assert.deepEqual(terminal.job.checkpoint, { completedSources: ["source-a"] });
  assert.equal(db.deadLetters.size, 1);
  const deadLetter = db.deadLetters.get(terminal.deadLetterId);
  assert.deepEqual(
    {
      jobId: deadLetter.jobId,
      reasonCode: deadLetter.reasonCode,
      attemptCount: deadLetter.attemptCount,
      checkpointVersion: deadLetter.checkpointVersion,
    },
    {
      jobId: lease.id,
      reasonCode: "VALIDATION_EXHAUSTED",
      attemptCount: 2,
      checkpointVersion: 1,
    },
  );
  assert.equal("payload" in deadLetter, false);
  assert.equal("payloadJson" in deadLetter, false);
  await assert.rejects(
    service.completeJob({
      jobId: lease.id,
      leaseOwner: lease.leaseOwner,
      leaseToken: lease.leaseToken,
    }),
    StaleLeaseError,
  );
});

test("recovers expired leases to retry wait or terminal dead letter deterministically", async () => {
  const harness = createHarness({ now: 4_000, retryBaseDelayMs: 100, retryMaxDelayMs: 250 });
  const { db, service } = harness;
  await enqueue(service, { queue: "recoverable", uniqueKey: "recoverable", maxAttempts: 3 });
  await enqueue(service, { queue: "terminal", uniqueKey: "terminal", maxAttempts: 1 });
  let recoverable = await service.acquireDueJob({ queue: "recoverable", leaseOwner: "worker-r", leaseMs: 50 });
  recoverable = await service.compareAndSetCheckpoint({
    jobId: recoverable.id,
    leaseOwner: recoverable.leaseOwner,
    leaseToken: recoverable.leaseToken,
    expectedVersion: 0,
    checkpoint: { page: 7 },
  });
  const terminal = await service.acquireDueJob({ queue: "terminal", leaseOwner: "worker-t", leaseMs: 50 });

  harness.setNow(4_050);
  const recovery = await service.recoverExpiredLeases({ limit: 10 });
  assert.deepEqual(
    { recovered: recovery.recovered, retryWait: recovery.retryWait, deadLettered: recovery.deadLettered },
    { recovered: 2, retryWait: 1, deadLettered: 1 },
  );
  const recoveredJob = await service.getJob(recoverable.id);
  assert.equal(recoveredJob.status, "retry_wait");
  assert.equal(recoveredJob.availableAt, 4_150);
  assert.equal(recoveredJob.checkpointVersion, 1);
  assert.deepEqual(recoveredJob.checkpoint, { page: 7 });
  const terminalJob = await service.getJob(terminal.id);
  assert.equal(terminalJob.status, "dead_lettered");
  assert.equal(terminalJob.failureCode, "LEASE_EXPIRED_MAX_ATTEMPTS");
  assert.equal(db.deadLetters.size, 1);
  assert.deepEqual(await service.recoverExpiredLeases({ limit: 10 }), {
    recovered: 0,
    retryWait: 0,
    deadLettered: 0,
    jobs: [],
  });

  harness.setNow(4_150);
  const nextLease = await service.acquireDueJob({ queue: "recoverable", leaseOwner: "worker-r2" });
  assert.equal(nextLease.attemptCount, 2);
  assert.deepEqual(nextLease.checkpoint, { page: 7 });
});

test("admin redrive resets execution state while preserving checkpoint and DLQ audit history", async () => {
  const harness = createHarness({ now: 5_000 });
  const { db, service } = harness;
  await enqueue(service, { queue: "redrive", uniqueKey: "redrive", maxAttempts: 1 });
  let lease = await service.acquireDueJob({ queue: "redrive", leaseOwner: "redrive-worker" });
  lease = await service.compareAndSetCheckpoint({
    jobId: lease.id,
    leaseOwner: lease.leaseOwner,
    leaseToken: lease.leaseToken,
    expectedVersion: 0,
    checkpoint: { resumeFrom: "cluster-4" },
  });
  const terminal = await service.failJob({
    jobId: lease.id,
    leaseOwner: lease.leaseOwner,
    leaseToken: lease.leaseToken,
    failureCode: "MANUAL_REVIEW_REQUIRED",
  });
  const deniedService = createDurableJobsService(db, {
    clock: harness.now,
    authorizeAdmin: () => false,
  });
  await assert.rejects(
    deniedService.adminRedrive({ jobId: lease.id, adminActor: "unauthorized-operator" }),
    AdminAuthorizationError,
  );
  assert.equal((await service.getJob(lease.id)).status, "dead_lettered");

  harness.advance(1_000);
  const redriven = await service.adminRedrive({
    jobId: lease.id,
    adminActor: "operator-test",
  });
  assert.equal(redriven.deadLetterId, terminal.deadLetterId);
  assert.equal(redriven.job.status, "queued");
  assert.equal(redriven.job.attemptCount, 0);
  assert.equal(redriven.job.checkpointVersion, 1);
  assert.deepEqual(redriven.job.checkpoint, { resumeFrom: "cluster-4" });
  const audit = db.deadLetters.get(terminal.deadLetterId);
  assert.equal(audit.redrivenAt, 6_000);
  assert.equal(audit.redrivenBy, "operator-test");

  const acquired = await service.acquireDueJob({ queue: "redrive", leaseOwner: "redrive-worker-2" });
  assert.equal(acquired.attemptCount, 1);
  assert.equal(acquired.checkpointVersion, 1);
  await assert.rejects(
    service.adminRedrive({ jobId: lease.id, adminActor: "operator-test" }),
    InvalidJobStateError,
  );

  await enqueue(service, { queue: "corrupt-redrive", uniqueKey: "corrupt-redrive", maxAttempts: 1 });
  const corruptLease = await service.acquireDueJob({
    queue: "corrupt-redrive",
    leaseOwner: "corrupt-redrive-worker",
  });
  const corruptTerminal = await service.failJob({
    jobId: corruptLease.id,
    leaseOwner: corruptLease.leaseOwner,
    leaseToken: corruptLease.leaseToken,
    failureCode: "AUDIT_STATE_TEST",
  });
  db.deadLetters.get(corruptTerminal.deadLetterId).redrivenAt = harness.now() - 1;
  await assert.rejects(
    service.adminRedrive({ jobId: corruptLease.id, adminActor: "operator-test" }),
    InvalidJobStateError,
  );
  const stillTerminal = await service.getJob(corruptLease.id);
  assert.equal(stillTerminal.status, "dead_lettered");
  assert.equal(stillTerminal.deadLetterId, corruptTerminal.deadLetterId);
});

test("executes the production schema and transition SQL against in-memory SQLite", async () => {
  const db = new SqliteD1();
  try {
    await initializeDurableJobs(db);
    let now = 7_000;
    let sequence = 0;
    const deterministicId = (kind) => `${kind.replaceAll(" ", "-")}-sqlite-${++sequence}`;
    const service = createDurableJobsService(db, {
      clock: () => now,
      idGenerator: deterministicId,
      leaseTokenGenerator: deterministicId,
      authorizeAdmin: ({ adminActor }) => adminActor === "sqlite-operator",
      retryBaseDelayMs: 100,
      retryMaxDelayMs: 250,
      defaultLeaseMs: 100,
    });

    const { job } = await enqueue(service, {
      queue: "sqlite-terminal",
      uniqueKey: "sqlite-terminal",
      maxAttempts: 1,
    });
    let lease = await service.acquireDueJob({ queue: "sqlite-terminal", leaseOwner: "sqlite-worker" });
    lease = await service.renewLease({
      jobId: lease.id,
      leaseOwner: lease.leaseOwner,
      leaseToken: lease.leaseToken,
      leaseMs: 200,
    });
    lease = await service.compareAndSetCheckpoint({
      jobId: lease.id,
      leaseOwner: lease.leaseOwner,
      leaseToken: lease.leaseToken,
      expectedVersion: 0,
      checkpoint: { sqliteCursor: 3 },
    });
    const terminal = await service.failJob({
      jobId: lease.id,
      leaseOwner: lease.leaseOwner,
      leaseToken: lease.leaseToken,
      failureCode: "SQLITE_TERMINAL",
    });
    assert.equal(terminal.job.status, "dead_lettered");

    now += 1;
    const redriven = await service.adminRedrive({
      jobId: job.id,
      adminActor: "sqlite-operator",
    });
    assert.equal(redriven.job.status, "queued");
    assert.equal(redriven.job.checkpointVersion, 1);
    assert.deepEqual(redriven.job.checkpoint, { sqliteCursor: 3 });

    await enqueue(service, {
      queue: "sqlite-recovery",
      uniqueKey: "sqlite-recovery",
      maxAttempts: 3,
    });
    await service.acquireDueJob({ queue: "sqlite-recovery", leaseOwner: "sqlite-recovery-worker", leaseMs: 10 });
    now += 10;
    const recovery = await service.recoverExpiredLeases({ queue: "sqlite-recovery" });
    assert.deepEqual(
      { recovered: recovery.recovered, retryWait: recovery.retryWait, deadLettered: recovery.deadLettered },
      { recovered: 1, retryWait: 1, deadLettered: 0 },
    );
    assert.equal(
      db.database.prepare("SELECT COUNT(*) AS count FROM durable_job_dead_letters").get().count,
      1,
    );
  } finally {
    db.close();
  }
});