const DEFAULT_QUEUE = "default";
const DEFAULT_LEASE_MS = 30_000;
const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_RETRY_BASE_MS = 1_000;
const DEFAULT_RETRY_CAP_MS = 15 * 60_000;
const DEFAULT_JSON_LIMIT_BYTES = 1024 * 1024;
const MAX_LEASE_MS = 24 * 60 * 60_000;
const MAX_ATTEMPTS = 100;
const MAX_RECOVERY_BATCH = 50;

export const DURABLE_JOB_STATUSES = Object.freeze([
  "queued",
  "running",
  "retry_wait",
  "succeeded",
  "dead_lettered",
  "cancelled",
]);

export const DURABLE_JOBS_SCHEMA_STATEMENTS = Object.freeze([
  `CREATE TABLE IF NOT EXISTS durable_jobs (
    id TEXT PRIMARY KEY,
    queue TEXT NOT NULL,
    job_type TEXT NOT NULL,
    unique_key TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'retry_wait', 'succeeded', 'dead_lettered', 'cancelled')),
    priority INTEGER NOT NULL DEFAULT 0,
    available_at INTEGER NOT NULL,
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    max_attempts INTEGER NOT NULL CHECK (max_attempts > 0),
    lease_owner TEXT,
    lease_token TEXT,
    lease_expires_at INTEGER,
    checkpoint_json TEXT,
    checkpoint_version INTEGER NOT NULL DEFAULT 0 CHECK (checkpoint_version >= 0),
    failure_code TEXT,
    dead_letter_id TEXT,
    started_at INTEGER,
    completed_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE (queue, job_type, unique_key),
    CHECK (
      (status = 'running' AND lease_owner IS NOT NULL AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
      OR
      (status <> 'running' AND lease_owner IS NULL AND lease_token IS NULL AND lease_expires_at IS NULL)
    )
  )`,
  `CREATE INDEX IF NOT EXISTS durable_jobs_due_idx
    ON durable_jobs (queue, status, available_at, priority DESC)`,
  `CREATE INDEX IF NOT EXISTS durable_jobs_expired_lease_idx
    ON durable_jobs (status, lease_expires_at)
    WHERE status = 'running'`,
  `CREATE TABLE IF NOT EXISTS durable_job_dead_letters (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL REFERENCES durable_jobs(id) ON DELETE RESTRICT,
    queue TEXT NOT NULL,
    job_type TEXT NOT NULL,
    reason_code TEXT NOT NULL,
    attempt_count INTEGER NOT NULL,
    checkpoint_version INTEGER NOT NULL,
    dead_lettered_at INTEGER NOT NULL,
    redriven_at INTEGER,
    redriven_by TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS durable_job_dead_letters_job_idx
    ON durable_job_dead_letters (job_id, dead_lettered_at DESC)`,
  `CREATE INDEX IF NOT EXISTS durable_job_dead_letters_open_idx
    ON durable_job_dead_letters (dead_lettered_at)
    WHERE redriven_at IS NULL`,
]);

export const DURABLE_JOBS_SCHEMA = `${DURABLE_JOBS_SCHEMA_STATEMENTS.join(";\n")};`;

const JOB_COLUMNS = `
  id,
  queue,
  job_type AS jobType,
  unique_key AS uniqueKey,
  payload_json AS payloadJson,
  status,
  priority,
  available_at AS availableAt,
  attempt_count AS attemptCount,
  max_attempts AS maxAttempts,
  lease_owner AS leaseOwner,
  lease_token AS leaseToken,
  lease_expires_at AS leaseExpiresAt,
  checkpoint_json AS checkpointJson,
  checkpoint_version AS checkpointVersion,
  failure_code AS failureCode,
  dead_letter_id AS deadLetterId,
  started_at AS startedAt,
  completed_at AS completedAt,
  created_at AS createdAt,
  updated_at AS updatedAt
`;

const ACTIVE_LEASE_COLUMNS = `
  id,
  status,
  attempt_count AS attemptCount,
  max_attempts AS maxAttempts,
  lease_owner AS leaseOwner,
  lease_token AS leaseToken,
  lease_expires_at AS leaseExpiresAt,
  checkpoint_version AS checkpointVersion
`;

export class DurableJobsError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "DurableJobsError";
    this.code = code;
  }
}

export class JobNotFoundError extends DurableJobsError {
  constructor() {
    super("JOB_NOT_FOUND", "The durable job does not exist.");
    this.name = "JobNotFoundError";
  }
}

export class InvalidJobStateError extends DurableJobsError {
  constructor() {
    super("INVALID_JOB_STATE", "The durable job is not in a valid state for this transition.");
    this.name = "InvalidJobStateError";
  }
}

export class StaleLeaseError extends DurableJobsError {
  constructor() {
    super("STALE_LEASE", "The durable job lease is stale or is owned by another worker.");
    this.name = "StaleLeaseError";
  }
}

export class CheckpointConflictError extends DurableJobsError {
  constructor() {
    super("CHECKPOINT_VERSION_CONFLICT", "The durable job checkpoint version has changed.");
    this.name = "CheckpointConflictError";
  }
}

export class AdminAuthorizationError extends DurableJobsError {
  constructor() {
    super("ADMIN_FORBIDDEN", "Administrative authorization is required for this durable job operation.");
    this.name = "AdminAuthorizationError";
  }
}

function defaultIdGenerator() {
  if (!globalThis.crypto?.randomUUID) {
    throw new DurableJobsError("ID_GENERATOR_UNAVAILABLE", "A durable job ID generator is required.");
  }
  return globalThis.crypto.randomUUID();
}

function assertDb(db) {
  if (!db || typeof db.prepare !== "function") {
    throw new TypeError("A D1-compatible database is required.");
  }
}

function requiredString(value, name, maximumLength) {
  if (typeof value !== "string" || value.trim() === "" || value.length > maximumLength) {
    throw new TypeError(`${name} must be a non-empty string no longer than ${maximumLength} characters.`);
  }
  return value;
}

function optionalReasonCode(value, fallback = "JOB_FAILED") {
  const code = value === undefined ? fallback : value;
  if (typeof code !== "string" || !/^[A-Z][A-Z0-9_]{0,127}$/.test(code)) {
    throw new TypeError("failureCode must be an uppercase reason code.");
  }
  return code;
}

function integer(value, name, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}

function safeTimestampAdd(timestamp, duration, name) {
  const result = timestamp + duration;
  if (!Number.isSafeInteger(result)) {
    throw new TypeError(`${name} exceeds the supported timestamp range.`);
  }
  return result;
}

function jsonByteLength(value) {
  return new TextEncoder().encode(value).byteLength;
}

function serializeJson(value, name, maximumBytes) {
  let serialized;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new TypeError(`${name} must be JSON-serializable.`);
  }
  if (serialized === undefined) throw new TypeError(`${name} must be JSON-serializable.`);
  if (jsonByteLength(serialized) > maximumBytes) {
    throw new TypeError(`${name} exceeds the ${maximumBytes}-byte limit.`);
  }
  return serialized;
}

function parseStoredJson(value) {
  if (value === null || value === undefined) return null;
  try {
    return JSON.parse(value);
  } catch {
    throw new DurableJobsError("CORRUPT_JOB_DATA", "Stored durable job JSON is invalid.");
  }
}

function decodeJob(row, { includeLeaseToken = false } = {}) {
  if (!row) return null;
  return {
    id: row.id,
    queue: row.queue,
    jobType: row.jobType,
    uniqueKey: row.uniqueKey,
    payload: parseStoredJson(row.payloadJson),
    status: row.status,
    priority: Number(row.priority),
    availableAt: Number(row.availableAt),
    attemptCount: Number(row.attemptCount),
    maxAttempts: Number(row.maxAttempts),
    leaseOwner: row.leaseOwner ?? null,
    leaseToken: includeLeaseToken ? (row.leaseToken ?? null) : null,
    leaseExpiresAt: row.leaseExpiresAt === null || row.leaseExpiresAt === undefined ? null : Number(row.leaseExpiresAt),
    checkpoint: parseStoredJson(row.checkpointJson),
    checkpointVersion: Number(row.checkpointVersion),
    failureCode: row.failureCode ?? null,
    deadLetterId: row.deadLetterId ?? null,
    startedAt: row.startedAt === null || row.startedAt === undefined ? null : Number(row.startedAt),
    completedAt: row.completedAt === null || row.completedAt === undefined ? null : Number(row.completedAt),
    createdAt: Number(row.createdAt),
    updatedAt: Number(row.updatedAt),
  };
}

function resultChanges(result) {
  if (result?.meta && Number.isFinite(Number(result.meta.changes))) return Number(result.meta.changes);
  if (Number.isFinite(Number(result?.changes))) return Number(result.changes);
  if (Array.isArray(result?.results)) return result.results.length;
  return null;
}

function firstResultRow(result) {
  return Array.isArray(result?.results) && result.results.length > 0 ? result.results[0] : null;
}

function normalizeClock(clock) {
  if (clock === undefined) return Date.now;
  if (typeof clock === "function") return clock;
  if (clock && typeof clock.now === "function") return () => clock.now();
  throw new TypeError("clock must be a function or an object with now().");
}

export function calculateRetryDelay(attemptCount, options = {}) {
  const attempt = integer(attemptCount, "attemptCount", 1, MAX_ATTEMPTS);
  const baseDelayMs = integer(
    options.baseDelayMs ?? DEFAULT_RETRY_BASE_MS,
    "baseDelayMs",
    0,
    Number.MAX_SAFE_INTEGER,
  );
  const maxDelayMs = integer(
    options.maxDelayMs ?? DEFAULT_RETRY_CAP_MS,
    "maxDelayMs",
    0,
    Number.MAX_SAFE_INTEGER,
  );
  if (baseDelayMs > maxDelayMs) throw new TypeError("baseDelayMs cannot exceed maxDelayMs.");
  if (baseDelayMs === 0) return 0;
  const exponent = attempt - 1;
  if (exponent >= 53 || baseDelayMs > maxDelayMs / (2 ** exponent)) return maxDelayMs;
  return Math.min(maxDelayMs, baseDelayMs * (2 ** exponent));
}

export async function initializeDurableJobs(db) {
  assertDb(db);
  if (typeof db.exec === "function") {
    await db.exec(DURABLE_JOBS_SCHEMA);
    return;
  }
  if (typeof db.batch !== "function") {
    throw new TypeError("The D1-compatible database must support exec() or batch() for schema initialization.");
  }
  await db.batch(DURABLE_JOBS_SCHEMA_STATEMENTS.map((sql) => db.prepare(sql)));
}

export class DurableJobsService {
  constructor(db, options = {}) {
    assertDb(db);
    this.db = db;
    this.clock = normalizeClock(options.clock);
    this.idGenerator = options.idGenerator ?? defaultIdGenerator;
    this.leaseTokenGenerator = options.leaseTokenGenerator ?? defaultIdGenerator;
    this.authorizeAdmin = options.authorizeAdmin ?? null;
    if (typeof this.idGenerator !== "function" || typeof this.leaseTokenGenerator !== "function") {
      throw new TypeError("ID generators must be functions.");
    }
    if (this.authorizeAdmin !== null && typeof this.authorizeAdmin !== "function") {
      throw new TypeError("authorizeAdmin must be a function when provided.");
    }
    this.defaultLeaseMs = integer(options.defaultLeaseMs ?? DEFAULT_LEASE_MS, "defaultLeaseMs", 1, MAX_LEASE_MS);
    this.defaultMaxAttempts = integer(options.defaultMaxAttempts ?? DEFAULT_MAX_ATTEMPTS, "defaultMaxAttempts", 1, MAX_ATTEMPTS);
    this.retryBaseDelayMs = integer(options.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_MS, "retryBaseDelayMs", 0, Number.MAX_SAFE_INTEGER);
    this.retryMaxDelayMs = integer(options.retryMaxDelayMs ?? DEFAULT_RETRY_CAP_MS, "retryMaxDelayMs", 0, Number.MAX_SAFE_INTEGER);
    if (this.retryBaseDelayMs > this.retryMaxDelayMs) {
      throw new TypeError("retryBaseDelayMs cannot exceed retryMaxDelayMs.");
    }
    this.maxPayloadBytes = integer(options.maxPayloadBytes ?? DEFAULT_JSON_LIMIT_BYTES, "maxPayloadBytes", 1, Number.MAX_SAFE_INTEGER);
    this.maxCheckpointBytes = integer(options.maxCheckpointBytes ?? DEFAULT_JSON_LIMIT_BYTES, "maxCheckpointBytes", 1, Number.MAX_SAFE_INTEGER);
  }

  now() {
    const value = Number(this.clock());
    return integer(value, "clock value", 0, Number.MAX_SAFE_INTEGER);
  }

  async requireAdmin(action, input) {
    if (!this.authorizeAdmin) throw new AdminAuthorizationError();
    let authorized = false;
    try {
      authorized = await this.authorizeAdmin({
        action,
        adminActor: input.adminActor,
        authorization: input.authorization,
        jobId: input.jobId,
      });
    } catch {
      authorized = false;
    }
    if (authorized !== true) throw new AdminAuthorizationError();
  }

  generateId(kind, generator = this.idGenerator) {
    return requiredString(generator(kind), `${kind} ID`, 512);
  }

  async getJob(jobId) {
    const id = requiredString(jobId, "jobId", 512);
    const row = await this.db.prepare(`/* durable_jobs:get */
      SELECT ${JOB_COLUMNS}
      FROM durable_jobs
      WHERE id = ?
    `).bind(id).first();
    return decodeJob(row);
  }

  async enqueueUniqueJob(input) {
    if (!input || typeof input !== "object") throw new TypeError("enqueue input is required.");
    const now = this.now();
    const id = input.id === undefined
      ? this.generateId("job")
      : requiredString(input.id, "id", 512);
    const queue = requiredString(input.queue ?? DEFAULT_QUEUE, "queue", 128);
    const jobType = requiredString(input.jobType, "jobType", 128);
    const uniqueKey = requiredString(input.uniqueKey, "uniqueKey", 512);
    const payloadJson = serializeJson(input.payload, "payload", this.maxPayloadBytes);
    const priority = integer(input.priority ?? 0, "priority", -1_000_000, 1_000_000);
    const availableAt = integer(input.availableAt ?? now, "availableAt", 0, Number.MAX_SAFE_INTEGER);
    const maxAttempts = integer(input.maxAttempts ?? this.defaultMaxAttempts, "maxAttempts", 1, MAX_ATTEMPTS);
    const checkpointJson = input.checkpoint === undefined
      ? null
      : serializeJson(input.checkpoint, "checkpoint", this.maxCheckpointBytes);

    const inserted = await this.db.prepare(`/* durable_jobs:enqueue */
      INSERT INTO durable_jobs (
        id, queue, job_type, unique_key, payload_json, status, priority,
        available_at, attempt_count, max_attempts, lease_owner, lease_token,
        lease_expires_at, checkpoint_json, checkpoint_version, failure_code,
        dead_letter_id, started_at, completed_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'queued', ?, ?, 0, ?, NULL, NULL, NULL, ?, 0, NULL, NULL, NULL, NULL, ?, ?)
      ON CONFLICT (queue, job_type, unique_key) DO NOTHING
      RETURNING ${JOB_COLUMNS}
    `).bind(
      id,
      queue,
      jobType,
      uniqueKey,
      payloadJson,
      priority,
      availableAt,
      maxAttempts,
      checkpointJson,
      now,
      now,
    ).first();

    if (inserted) return { enqueued: true, job: decodeJob(inserted) };

    const existing = await this.db.prepare(`/* durable_jobs:get_unique */
      SELECT ${JOB_COLUMNS}
      FROM durable_jobs
      WHERE queue = ? AND job_type = ? AND unique_key = ?
    `).bind(queue, jobType, uniqueKey).first();
    if (!existing) {
      throw new DurableJobsError("ENQUEUE_CONFLICT_UNRESOLVED", "The unique durable job could not be resolved.");
    }
    return { enqueued: false, job: decodeJob(existing) };
  }

  async acquireDueJob(input) {
    if (!input || typeof input !== "object") throw new TypeError("acquire input is required.");
    const now = this.now();
    const queue = requiredString(input.queue ?? DEFAULT_QUEUE, "queue", 128);
    const leaseOwner = requiredString(input.leaseOwner, "leaseOwner", 256);
    const leaseMs = integer(input.leaseMs ?? this.defaultLeaseMs, "leaseMs", 1, MAX_LEASE_MS);
    const leaseToken = this.generateId("lease token", this.leaseTokenGenerator);
    const leaseExpiresAt = safeTimestampAdd(now, leaseMs, "lease expiry");

    const row = await this.db.prepare(`/* durable_jobs:acquire */
      WITH candidate AS (
        SELECT id
        FROM durable_jobs
        WHERE queue = ?
          AND attempt_count < max_attempts
          AND (
            (status IN ('queued', 'retry_wait') AND available_at <= ?)
            OR
            (status = 'running' AND lease_expires_at <= ?)
          )
        ORDER BY
          priority DESC,
          CASE WHEN status = 'running' THEN lease_expires_at ELSE available_at END ASC,
          created_at ASC,
          id ASC
        LIMIT 1
      )
      UPDATE durable_jobs
      SET
        status = 'running',
        attempt_count = attempt_count + 1,
        lease_owner = ?,
        lease_token = ?,
        lease_expires_at = ?,
        failure_code = CASE WHEN status = 'running' THEN 'LEASE_EXPIRED' ELSE NULL END,
        dead_letter_id = NULL,
        started_at = COALESCE(started_at, ?),
        completed_at = NULL,
        updated_at = ?
      WHERE id = (SELECT id FROM candidate)
      RETURNING ${JOB_COLUMNS}
    `).bind(
      queue,
      now,
      now,
      leaseOwner,
      leaseToken,
      leaseExpiresAt,
      now,
      now,
    ).first();

    return decodeJob(row, { includeLeaseToken: true });
  }

  async readLeaseState(jobId) {
    return this.db.prepare(`/* durable_jobs:lease_state */
      SELECT ${ACTIVE_LEASE_COLUMNS}
      FROM durable_jobs
      WHERE id = ?
    `).bind(jobId).first();
  }

  leaseIsCurrent(row, leaseOwner, leaseToken, now) {
    return Boolean(
      row
      && row.status === "running"
      && row.leaseOwner === leaseOwner
      && row.leaseToken === leaseToken
      && Number(row.leaseExpiresAt) > now,
    );
  }

  async rejectLeaseConflict(jobId, leaseOwner, leaseToken, now, expectedCheckpointVersion) {
    const state = await this.readLeaseState(jobId);
    if (!state) throw new JobNotFoundError();
    if (!this.leaseIsCurrent(state, leaseOwner, leaseToken, now)) throw new StaleLeaseError();
    if (expectedCheckpointVersion !== undefined && Number(state.checkpointVersion) !== expectedCheckpointVersion) {
      throw new CheckpointConflictError();
    }
    throw new InvalidJobStateError();
  }

  leaseInput(input, operation) {
    if (!input || typeof input !== "object") throw new TypeError(`${operation} input is required.`);
    return {
      jobId: requiredString(input.jobId, "jobId", 512),
      leaseOwner: requiredString(input.leaseOwner, "leaseOwner", 256),
      leaseToken: requiredString(input.leaseToken, "leaseToken", 512),
    };
  }

  async renewLease(input) {
    const { jobId, leaseOwner, leaseToken } = this.leaseInput(input, "heartbeat");
    const now = this.now();
    const leaseMs = integer(input.leaseMs ?? this.defaultLeaseMs, "leaseMs", 1, MAX_LEASE_MS);
    const leaseExpiresAt = safeTimestampAdd(now, leaseMs, "lease expiry");
    const row = await this.db.prepare(`/* durable_jobs:heartbeat */
      UPDATE durable_jobs
      SET lease_expires_at = MAX(lease_expires_at, ?), updated_at = MAX(updated_at, ?)
      WHERE id = ?
        AND status = 'running'
        AND lease_owner = ?
        AND lease_token = ?
        AND lease_expires_at > ?
      RETURNING ${JOB_COLUMNS}
    `).bind(
      leaseExpiresAt,
      now,
      jobId,
      leaseOwner,
      leaseToken,
      now,
    ).first();
    if (!row) await this.rejectLeaseConflict(jobId, leaseOwner, leaseToken, now);
    return decodeJob(row, { includeLeaseToken: true });
  }

  async compareAndSetCheckpoint(input) {
    const { jobId, leaseOwner, leaseToken } = this.leaseInput(input, "checkpoint");
    const now = this.now();
    const expectedVersion = integer(input.expectedVersion, "expectedVersion", 0, Number.MAX_SAFE_INTEGER - 1);
    const checkpointJson = serializeJson(input.checkpoint, "checkpoint", this.maxCheckpointBytes);
    const row = await this.db.prepare(`/* durable_jobs:checkpoint */
      UPDATE durable_jobs
      SET checkpoint_json = ?, checkpoint_version = checkpoint_version + 1, updated_at = ?
      WHERE id = ?
        AND status = 'running'
        AND lease_owner = ?
        AND lease_token = ?
        AND lease_expires_at > ?
        AND checkpoint_version = ?
      RETURNING ${JOB_COLUMNS}
    `).bind(
      checkpointJson,
      now,
      jobId,
      leaseOwner,
      leaseToken,
      now,
      expectedVersion,
    ).first();
    if (!row) {
      await this.rejectLeaseConflict(jobId, leaseOwner, leaseToken, now, expectedVersion);
    }
    return decodeJob(row, { includeLeaseToken: true });
  }

  async completeJob(input) {
    const { jobId, leaseOwner, leaseToken } = this.leaseInput(input, "completion");
    const now = this.now();
    const row = await this.db.prepare(`/* durable_jobs:complete */
      UPDATE durable_jobs
      SET
        status = 'succeeded',
        lease_owner = NULL,
        lease_token = NULL,
        lease_expires_at = NULL,
        failure_code = NULL,
        dead_letter_id = NULL,
        completed_at = ?,
        updated_at = ?
      WHERE id = ?
        AND status = 'running'
        AND lease_owner = ?
        AND lease_token = ?
        AND lease_expires_at > ?
      RETURNING ${JOB_COLUMNS}
    `).bind(
      now,
      now,
      jobId,
      leaseOwner,
      leaseToken,
      now,
    ).first();
    if (!row) await this.rejectLeaseConflict(jobId, leaseOwner, leaseToken, now);
    return decodeJob(row);
  }

  async failJob(input) {
    const { jobId, leaseOwner, leaseToken } = this.leaseInput(input, "failure");
    const failureCode = optionalReasonCode(input.failureCode);
    const now = this.now();
    const state = await this.readLeaseState(jobId);
    if (!state) throw new JobNotFoundError();
    if (!this.leaseIsCurrent(state, leaseOwner, leaseToken, now)) throw new StaleLeaseError();

    const attemptCount = Number(state.attemptCount);
    const maxAttempts = Number(state.maxAttempts);
    if (attemptCount >= maxAttempts) {
      if (typeof this.db.batch !== "function") {
        throw new TypeError("The D1-compatible database must support batch() for dead-letter transitions.");
      }
      const deadLetterId = this.generateId("dead letter");
      const results = await this.db.batch([
        this.db.prepare(`/* durable_jobs:fail_terminal */
          UPDATE durable_jobs
          SET
            status = 'dead_lettered',
            lease_owner = NULL,
            lease_token = NULL,
            lease_expires_at = NULL,
            failure_code = ?,
            dead_letter_id = ?,
            completed_at = ?,
            updated_at = ?
          WHERE id = ?
            AND status = 'running'
            AND lease_owner = ?
            AND lease_token = ?
            AND lease_expires_at > ?
            AND attempt_count = ?
          RETURNING ${JOB_COLUMNS}
        `).bind(
          failureCode,
          deadLetterId,
          now,
          now,
          jobId,
          leaseOwner,
          leaseToken,
          now,
          attemptCount,
        ),
        this.db.prepare(`/* durable_jobs:insert_dead_letter */
          INSERT INTO durable_job_dead_letters (
            id, job_id, queue, job_type, reason_code, attempt_count,
            checkpoint_version, dead_lettered_at, redriven_at, redriven_by
          )
          SELECT ?, id, queue, job_type, ?, attempt_count,
            checkpoint_version, ?, NULL, NULL
          FROM durable_jobs
          WHERE id = ? AND status = 'dead_lettered' AND dead_letter_id = ?
        `).bind(deadLetterId, failureCode, now, jobId, deadLetterId),
      ]);
      const updatedRow = firstResultRow(results?.[0]);
      if (resultChanges(results?.[0]) === 0 || !updatedRow) {
        await this.rejectLeaseConflict(jobId, leaseOwner, leaseToken, now);
      }
      if (resultChanges(results?.[1]) === 0) {
        throw new DurableJobsError("DEAD_LETTER_WRITE_FAILED", "The dead-letter record was not inserted.");
      }
      return {
        deadLettered: true,
        deadLetterId,
        retryAt: null,
        retryDelayMs: null,
        job: decodeJob(updatedRow),
      };
    }

    const retryDelayMs = calculateRetryDelay(attemptCount, {
      baseDelayMs: this.retryBaseDelayMs,
      maxDelayMs: this.retryMaxDelayMs,
    });
    const retryAt = safeTimestampAdd(now, retryDelayMs, "retry time");
    const row = await this.db.prepare(`/* durable_jobs:fail_retry */
      UPDATE durable_jobs
      SET
        status = 'retry_wait',
        available_at = ?,
        lease_owner = NULL,
        lease_token = NULL,
        lease_expires_at = NULL,
        failure_code = ?,
        dead_letter_id = NULL,
        completed_at = NULL,
        updated_at = ?
      WHERE id = ?
        AND status = 'running'
        AND lease_owner = ?
        AND lease_token = ?
        AND lease_expires_at > ?
        AND attempt_count = ?
      RETURNING ${JOB_COLUMNS}
    `).bind(
      retryAt,
      failureCode,
      now,
      jobId,
      leaseOwner,
      leaseToken,
      now,
      attemptCount,
    ).first();
    if (!row) await this.rejectLeaseConflict(jobId, leaseOwner, leaseToken, now);
    return {
      deadLettered: false,
      deadLetterId: null,
      retryAt,
      retryDelayMs,
      job: decodeJob(row),
    };
  }

  async recoverExpiredLeases(input = {}) {
    if (!input || typeof input !== "object") throw new TypeError("recovery input must be an object.");
    if (typeof this.db.batch !== "function") {
      throw new TypeError("The D1-compatible database must support batch() for lease recovery.");
    }
    const now = this.now();
    const queue = input.queue === undefined ? null : requiredString(input.queue, "queue", 128);
    const limit = integer(input.limit ?? MAX_RECOVERY_BATCH, "limit", 1, MAX_RECOVERY_BATCH);
    const candidates = await this.db.prepare(`/* durable_jobs:expired_candidates */
      SELECT
        id,
        attempt_count AS attemptCount,
        max_attempts AS maxAttempts,
        lease_token AS leaseToken,
        lease_expires_at AS leaseExpiresAt
      FROM durable_jobs
      WHERE status = 'running'
        AND lease_expires_at <= ?
        AND (? IS NULL OR queue = ?)
      ORDER BY lease_expires_at ASC, created_at ASC, id ASC
      LIMIT ?
    `).bind(now, queue, queue, limit).all();
    const rows = Array.isArray(candidates?.results) ? candidates.results : [];
    if (rows.length === 0) return { recovered: 0, retryWait: 0, deadLettered: 0, jobs: [] };

    const statements = [];
    const actions = [];
    for (const row of rows) {
      const jobId = requiredString(row.id, "stored job ID", 512);
      const attemptCount = integer(Number(row.attemptCount), "stored attemptCount", 1, MAX_ATTEMPTS);
      const maxAttempts = integer(Number(row.maxAttempts), "stored maxAttempts", 1, MAX_ATTEMPTS);
      const leaseToken = requiredString(row.leaseToken, "stored leaseToken", 512);
      const leaseExpiresAt = integer(Number(row.leaseExpiresAt), "stored leaseExpiresAt", 0, Number.MAX_SAFE_INTEGER);
      if (attemptCount >= maxAttempts) {
        const deadLetterId = this.generateId("dead letter");
        statements.push(this.db.prepare(`/* durable_jobs:recover_terminal */
          UPDATE durable_jobs
          SET
            status = 'dead_lettered',
            lease_owner = NULL,
            lease_token = NULL,
            lease_expires_at = NULL,
            failure_code = 'LEASE_EXPIRED_MAX_ATTEMPTS',
            dead_letter_id = ?,
            completed_at = ?,
            updated_at = ?
          WHERE id = ?
            AND status = 'running'
            AND lease_token = ?
            AND lease_expires_at = ?
            AND lease_expires_at <= ?
            AND attempt_count = ?
          RETURNING id
        `).bind(
          deadLetterId,
          now,
          now,
          jobId,
          leaseToken,
          leaseExpiresAt,
          now,
          attemptCount,
        ));
        statements.push(this.db.prepare(`/* durable_jobs:insert_recovered_dead_letter */
          INSERT INTO durable_job_dead_letters (
            id, job_id, queue, job_type, reason_code, attempt_count,
            checkpoint_version, dead_lettered_at, redriven_at, redriven_by
          )
          SELECT ?, id, queue, job_type, 'LEASE_EXPIRED_MAX_ATTEMPTS', attempt_count,
            checkpoint_version, ?, NULL, NULL
          FROM durable_jobs
          WHERE id = ? AND status = 'dead_lettered' AND dead_letter_id = ?
        `).bind(deadLetterId, now, jobId, deadLetterId));
        actions.push({ jobId, status: "dead_lettered", deadLetterId, statementCount: 2 });
      } else {
        const retryDelayMs = calculateRetryDelay(attemptCount, {
          baseDelayMs: this.retryBaseDelayMs,
          maxDelayMs: this.retryMaxDelayMs,
        });
        const retryAt = safeTimestampAdd(now, retryDelayMs, "retry time");
        statements.push(this.db.prepare(`/* durable_jobs:recover_retry */
          UPDATE durable_jobs
          SET
            status = 'retry_wait',
            available_at = ?,
            lease_owner = NULL,
            lease_token = NULL,
            lease_expires_at = NULL,
            failure_code = 'LEASE_EXPIRED',
            dead_letter_id = NULL,
            completed_at = NULL,
            updated_at = ?
          WHERE id = ?
            AND status = 'running'
            AND lease_token = ?
            AND lease_expires_at = ?
            AND lease_expires_at <= ?
            AND attempt_count = ?
          RETURNING id
        `).bind(
          retryAt,
          now,
          jobId,
          leaseToken,
          leaseExpiresAt,
          now,
          attemptCount,
        ));
        actions.push({ jobId, status: "retry_wait", retryAt, retryDelayMs, statementCount: 1 });
      }
    }

    const results = await this.db.batch(statements);
    const recoveredJobs = [];
    let resultIndex = 0;
    for (const action of actions) {
      const updateResult = results?.[resultIndex];
      resultIndex += 1;
      const changed = resultChanges(updateResult);
      if (changed !== 0 && (changed !== null || firstResultRow(updateResult))) {
        recoveredJobs.push({
          jobId: action.jobId,
          status: action.status,
          ...(action.status === "retry_wait"
            ? { retryAt: action.retryAt, retryDelayMs: action.retryDelayMs }
            : { deadLetterId: action.deadLetterId }),
        });
      }
      if (action.statementCount === 2) {
        const insertResult = results?.[resultIndex];
        resultIndex += 1;
        if (changed !== 0 && resultChanges(insertResult) === 0) {
          throw new DurableJobsError("DEAD_LETTER_WRITE_FAILED", "The recovered dead-letter record was not inserted.");
        }
      }
    }

    const retryWait = recoveredJobs.filter((job) => job.status === "retry_wait").length;
    const deadLettered = recoveredJobs.length - retryWait;
    return { recovered: recoveredJobs.length, retryWait, deadLettered, jobs: recoveredJobs };
  }

  async adminRedrive(input) {
    if (!input || typeof input !== "object") throw new TypeError("redrive input is required.");
    if (typeof this.db.batch !== "function") {
      throw new TypeError("The D1-compatible database must support batch() for redrive.");
    }
    const jobId = requiredString(input.jobId, "jobId", 512);
    const adminActor = requiredString(input.adminActor, "adminActor", 256);
    await this.requireAdmin("redrive", { ...input, jobId, adminActor });
    const now = this.now();
    const availableAt = integer(input.availableAt ?? now, "availableAt", 0, Number.MAX_SAFE_INTEGER);
    const state = await this.db.prepare(`/* durable_jobs:redrive_state */
      SELECT status, dead_letter_id AS deadLetterId
      FROM durable_jobs
      WHERE id = ?
    `).bind(jobId).first();
    if (!state) throw new JobNotFoundError();
    if (state.status !== "dead_lettered" || !state.deadLetterId) throw new InvalidJobStateError();

    const results = await this.db.batch([
      this.db.prepare(`/* durable_jobs:redrive_prepare */
        UPDATE durable_jobs
        SET
          status = 'queued',
          available_at = ?,
          attempt_count = 0,
          lease_owner = NULL,
          lease_token = NULL,
          lease_expires_at = NULL,
          failure_code = NULL,
          started_at = NULL,
          completed_at = NULL,
          updated_at = ?
        WHERE id = ? AND status = 'dead_lettered' AND dead_letter_id = ?
          AND EXISTS (
            SELECT 1
            FROM durable_job_dead_letters
            WHERE id = ? AND job_id = ? AND redriven_at IS NULL
          )
        RETURNING id
      `).bind(
        availableAt,
        now,
        jobId,
        state.deadLetterId,
        state.deadLetterId,
        jobId,
      ),
      this.db.prepare(`/* durable_jobs:mark_dead_letter_redriven */
        UPDATE durable_job_dead_letters
        SET redriven_at = ?, redriven_by = ?
        WHERE id = ? AND job_id = ? AND redriven_at IS NULL
          AND EXISTS (
            SELECT 1
            FROM durable_jobs
            WHERE id = ? AND status = 'queued' AND dead_letter_id = ?
          )
      `).bind(
        now,
        adminActor,
        state.deadLetterId,
        jobId,
        jobId,
        state.deadLetterId,
      ),
      this.db.prepare(`/* durable_jobs:redrive_finalize */
        UPDATE durable_jobs
        SET dead_letter_id = NULL
        WHERE id = ? AND status = 'queued' AND dead_letter_id = ?
          AND EXISTS (
            SELECT 1
            FROM durable_job_dead_letters
            WHERE id = ? AND job_id = ? AND redriven_at = ? AND redriven_by = ?
          )
        RETURNING ${JOB_COLUMNS}
      `).bind(
        jobId,
        state.deadLetterId,
        state.deadLetterId,
        jobId,
        now,
        adminActor,
      ),
    ]);
    const row = firstResultRow(results?.[2]);
    if (
      resultChanges(results?.[0]) === 0
      || resultChanges(results?.[1]) === 0
      || resultChanges(results?.[2]) === 0
      || !row
    ) {
      throw new InvalidJobStateError();
    }
    return { deadLetterId: state.deadLetterId, job: decodeJob(row) };
  }

  async cancelJob(input) {
    if (!input || typeof input !== "object") throw new TypeError("cancellation input is required.");
    const jobId = requiredString(input.jobId, "jobId", 512);
    const leaseOwner = input.leaseOwner === undefined ? null : requiredString(input.leaseOwner, "leaseOwner", 256);
    const leaseToken = input.leaseToken === undefined ? null : requiredString(input.leaseToken, "leaseToken", 512);
    if ((leaseOwner === null) !== (leaseToken === null)) {
      throw new TypeError("leaseOwner and leaseToken must be provided together.");
    }
    if (leaseOwner === null) {
      const adminActor = requiredString(input.adminActor, "adminActor", 256);
      await this.requireAdmin("cancel", { ...input, jobId, adminActor });
    }
    const now = this.now();
    const row = await this.db.prepare(`/* durable_jobs:cancel */
      UPDATE durable_jobs
      SET
        status = 'cancelled',
        lease_owner = NULL,
        lease_token = NULL,
        lease_expires_at = NULL,
        failure_code = 'CANCELLED',
        completed_at = ?,
        updated_at = ?
      WHERE id = ?
        AND (
          status IN ('queued', 'retry_wait')
          OR (
            status = 'running'
            AND lease_owner = ?
            AND lease_token = ?
            AND lease_expires_at > ?
          )
        )
      RETURNING ${JOB_COLUMNS}
    `).bind(now, now, jobId, leaseOwner, leaseToken, now).first();
    if (row) return decodeJob(row);

    const state = await this.readLeaseState(jobId);
    if (!state) throw new JobNotFoundError();
    if (state.status === "running") throw new StaleLeaseError();
    throw new InvalidJobStateError();
  }
}

export function createDurableJobsService(db, options = {}) {
  return new DurableJobsService(db, options);
}

export async function enqueueUniqueJob(db, input, options = {}) {
  return createDurableJobsService(db, options).enqueueUniqueJob(input);
}

export async function acquireDueJob(db, input, options = {}) {
  return createDurableJobsService(db, options).acquireDueJob(input);
}

export async function renewJobLease(db, input, options = {}) {
  return createDurableJobsService(db, options).renewLease(input);
}

export async function compareAndSetCheckpoint(db, input, options = {}) {
  return createDurableJobsService(db, options).compareAndSetCheckpoint(input);
}

export async function completeDurableJob(db, input, options = {}) {
  return createDurableJobsService(db, options).completeJob(input);
}

export async function failDurableJob(db, input, options = {}) {
  return createDurableJobsService(db, options).failJob(input);
}

export async function recoverExpiredJobLeases(db, input = {}, options = {}) {
  return createDurableJobsService(db, options).recoverExpiredLeases(input);
}

export async function adminRedriveJob(db, input, options = {}) {
  return createDurableJobsService(db, options).adminRedrive(input);
}

export async function cancelDurableJob(db, input, options = {}) {
  return createDurableJobsService(db, options).cancelJob(input);
}
