const EVENT_TABLE = "publication_outbox_events";
const RECEIPT_TABLE = "publication_delivery_receipts";

const EVENT_COLUMNS = `
  id,
  destination,
  aggregate_type,
  aggregate_id,
  aggregate_version,
  event_type,
  payload,
  payload_hash,
  idempotency_key,
  status,
  attempt_count,
  available_at,
  claim_token,
  claimed_by,
  lease_expires_at,
  last_error_code,
  last_error_at,
  delivered_at,
  created_at,
  updated_at
`;

const EVENT_METADATA_COLUMNS = `
  id,
  destination,
  aggregate_type,
  aggregate_id,
  aggregate_version,
  event_type,
  payload_hash,
  idempotency_key,
  status,
  attempt_count,
  available_at,
  claim_token,
  claimed_by,
  lease_expires_at,
  last_error_code,
  last_error_at,
  delivered_at,
  created_at,
  updated_at
`;

export const PUBLICATION_OUTBOX_DEFAULTS = Object.freeze({
  baseBackoffMs: 1_000,
  maxBackoffMs: 15 * 60_000,
  maxAttempts: 8,
  defaultLeaseMs: 30_000,
  defaultClaimLimit: 25,
  defaultRecoveryLimit: 100,
  // Two inspection statements and one repair statement leave headroom in a 50-query invocation budget.
  defaultReconcileLimit: 40,
  maxPayloadBytes: 1024 * 1024,
});

export const PUBLICATION_OUTBOX_SCHEMA_SQL = Object.freeze([
  `
    CREATE TABLE IF NOT EXISTS ${EVENT_TABLE} (
      id TEXT PRIMARY KEY NOT NULL,
      destination TEXT NOT NULL,
      aggregate_type TEXT NOT NULL,
      aggregate_id TEXT NOT NULL,
      aggregate_version INTEGER NOT NULL CHECK (aggregate_version >= 1),
      event_type TEXT NOT NULL,
      payload TEXT NOT NULL,
      payload_hash TEXT NOT NULL
        CHECK (length(payload_hash) = 64 AND payload_hash NOT GLOB '*[^0-9a-f]*'),
      idempotency_key TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'claimed', 'delivered', 'terminal')),
      attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
      available_at INTEGER NOT NULL,
      claim_token TEXT,
      claimed_by TEXT,
      lease_expires_at INTEGER,
      last_error_code TEXT,
      last_error_at INTEGER,
      delivered_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      CONSTRAINT publication_outbox_destination_idempotency_uq
        UNIQUE (destination, idempotency_key),
      CONSTRAINT publication_outbox_aggregate_version_uq
        UNIQUE (destination, aggregate_type, aggregate_id, aggregate_version),
      CHECK (
        (status = 'claimed' AND claim_token IS NOT NULL AND claimed_by IS NOT NULL AND lease_expires_at IS NOT NULL)
        OR
        (status != 'claimed' AND claim_token IS NULL AND claimed_by IS NULL AND lease_expires_at IS NULL)
      ),
      CHECK (
        (status = 'delivered' AND delivered_at IS NOT NULL)
        OR
        (status != 'delivered' AND delivered_at IS NULL)
      )
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS ${RECEIPT_TABLE} (
      id TEXT PRIMARY KEY NOT NULL,
      event_id TEXT NOT NULL REFERENCES ${EVENT_TABLE}(id) ON DELETE RESTRICT,
      destination TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      payload_hash TEXT NOT NULL
        CHECK (length(payload_hash) = 64 AND payload_hash NOT GLOB '*[^0-9a-f]*'),
      claim_token TEXT,
      claimed_by TEXT,
      destination_receipt_id TEXT,
      delivered_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      source TEXT NOT NULL CHECK (source IN ('delivery', 'reconciled')),
      CONSTRAINT publication_receipts_destination_idempotency_uq
        UNIQUE (destination, idempotency_key),
      CONSTRAINT publication_receipts_event_uq UNIQUE (event_id),
      CHECK (
        source = 'reconciled'
        OR (claim_token IS NOT NULL AND claimed_by IS NOT NULL)
      )
    )
  `,
  `
    CREATE INDEX IF NOT EXISTS publication_outbox_due_idx
    ON ${EVENT_TABLE} (destination, status, available_at, created_at, id)
  `,
  `
    CREATE INDEX IF NOT EXISTS publication_outbox_lease_idx
    ON ${EVENT_TABLE} (status, lease_expires_at)
  `,
  `
    CREATE INDEX IF NOT EXISTS publication_receipts_event_idx
    ON ${RECEIPT_TABLE} (event_id)
  `,
]);

export class PublicationOutboxError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "PublicationOutboxError";
    this.code = code;
  }
}

export class PublicationOutboxConflictError extends PublicationOutboxError {
  constructor(message = "The publication event conflicts with an existing immutable event.") {
    super("OUTBOX_CONFLICT", message);
    this.name = "PublicationOutboxConflictError";
  }
}

export class StalePublicationClaimError extends PublicationOutboxError {
  constructor() {
    super("STALE_CLAIM", "The publication claim is missing, expired, or owned by another worker.");
    this.name = "StalePublicationClaimError";
  }
}

function invalidArgument(label, detail) {
  return new PublicationOutboxError("INVALID_ARGUMENT", `${label} ${detail}.`);
}

function requireDatabase(db) {
  if (!db || typeof db.prepare !== "function" || typeof db.batch !== "function") {
    throw invalidArgument("db", "must implement the D1 prepare and batch APIs");
  }
  return db;
}

function requiredText(value, label, maximumLength = 256) {
  if (typeof value !== "string") throw invalidArgument(label, "must be a string");
  const normalized = value.trim();
  if (!normalized) throw invalidArgument(label, "must not be empty");
  if (normalized.length > maximumLength) throw invalidArgument(label, `must be at most ${maximumLength} characters`);
  return normalized;
}

function optionalText(value, label, maximumLength = 512) {
  if (value === undefined || value === null) return null;
  return requiredText(value, label, maximumLength);
}

function safeInteger(value, label, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw invalidArgument(label, `must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

function safeTimestamp(value, label) {
  return safeInteger(value, label, 0, Number.MAX_SAFE_INTEGER);
}

function safeAdd(left, right, label) {
  const result = left + right;
  if (!Number.isSafeInteger(result)) throw invalidArgument(label, "exceeds the supported timestamp range");
  return result;
}

function readClock(clock = Date.now) {
  if (typeof clock !== "function") throw invalidArgument("clock", "must be a function");
  const value = clock();
  const milliseconds = value instanceof Date ? value.getTime() : value;
  return safeTimestamp(milliseconds, "clock result");
}

function defaultIdGenerator() {
  if (typeof globalThis.crypto?.randomUUID !== "function") {
    throw new PublicationOutboxError("ID_GENERATOR_UNAVAILABLE", "A publication outbox ID generator is required.");
  }
  return globalThis.crypto.randomUUID();
}

function generateId(idGenerator = defaultIdGenerator, kind) {
  if (typeof idGenerator !== "function") throw invalidArgument("idGenerator", "must be a function");
  return requiredText(idGenerator(kind), `${kind} ID`, 200);
}

function normalizeConfiguration(options = {}) {
  const defaults = PUBLICATION_OUTBOX_DEFAULTS;
  return {
    baseBackoffMs: safeInteger(options.baseBackoffMs ?? defaults.baseBackoffMs, "baseBackoffMs", 0, 24 * 60 * 60_000),
    maxBackoffMs: safeInteger(options.maxBackoffMs ?? defaults.maxBackoffMs, "maxBackoffMs", 0, 30 * 24 * 60 * 60_000),
    maxAttempts: safeInteger(options.maxAttempts ?? defaults.maxAttempts, "maxAttempts", 1, 1_000),
    defaultLeaseMs: safeInteger(options.defaultLeaseMs ?? defaults.defaultLeaseMs, "defaultLeaseMs", 1, 24 * 60 * 60_000),
    defaultClaimLimit: safeInteger(options.defaultClaimLimit ?? defaults.defaultClaimLimit, "defaultClaimLimit", 1, 100),
    defaultRecoveryLimit: safeInteger(options.defaultRecoveryLimit ?? defaults.defaultRecoveryLimit, "defaultRecoveryLimit", 1, 500),
    defaultReconcileLimit: safeInteger(options.defaultReconcileLimit ?? defaults.defaultReconcileLimit, "defaultReconcileLimit", 1, 40),
    maxPayloadBytes: safeInteger(options.maxPayloadBytes ?? defaults.maxPayloadBytes, "maxPayloadBytes", 1, 10 * 1024 * 1024),
  };
}

function canonicalJson(value, ancestors) {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw invalidArgument("payload", "must contain only finite JSON numbers");
    return JSON.stringify(value);
  }
  if (typeof value !== "object") throw invalidArgument("payload", "must contain only JSON-compatible values");
  if (ancestors.has(value)) throw invalidArgument("payload", "must not contain circular references");

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) throw invalidArgument("payload", "must not contain sparse arrays");
      }
      return `[${value.map((entry) => canonicalJson(entry, ancestors)).join(",")}]`;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw invalidArgument("payload", "must be a string or plain JSON value");
    }
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key], ancestors)}`).join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
}

export function serializePublicationPayload(payload) {
  if (typeof payload === "string") return payload;
  if (payload === undefined) throw invalidArgument("payload", "is required");
  return canonicalJson(payload, new Set());
}

async function sha256Hex(text, cryptoImplementation = globalThis.crypto) {
  if (!cryptoImplementation?.subtle || typeof cryptoImplementation.subtle.digest !== "function") {
    throw new PublicationOutboxError("CRYPTO_UNAVAILABLE", "A Web Crypto implementation is required to hash publication payloads.");
  }
  const digest = await cryptoImplementation.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function hashPublicationPayload(payload, options = {}) {
  return sha256Hex(serializePublicationPayload(payload), options.crypto ?? globalThis.crypto);
}

function rowsFromResult(result) {
  if (Array.isArray(result)) return result;
  return Array.isArray(result?.results) ? result.results : [];
}

async function allRows(statement) {
  return rowsFromResult(await statement.all());
}

function numberOrNull(value) {
  return value === null || value === undefined ? null : Number(value);
}

function mapEvent(row) {
  const event = {
    id: row.id,
    destination: row.destination,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    aggregateVersion: Number(row.aggregate_version),
    eventType: row.event_type,
    payloadHash: row.payload_hash,
    idempotencyKey: row.idempotency_key,
    status: row.status,
    attemptCount: Number(row.attempt_count),
    availableAt: Number(row.available_at),
    claimToken: row.claim_token ?? null,
    claimedBy: row.claimed_by ?? null,
    leaseExpiresAt: numberOrNull(row.lease_expires_at),
    lastErrorCode: row.last_error_code ?? null,
    lastErrorAt: numberOrNull(row.last_error_at),
    deliveredAt: numberOrNull(row.delivered_at),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
  if (Object.hasOwn(row, "payload")) event.payload = row.payload;
  return event;
}

function mapReceipt(row) {
  return {
    id: row.receipt_id ?? row.id,
    eventId: row.receipt_event_id ?? row.event_id,
    destination: row.receipt_destination ?? row.destination,
    idempotencyKey: row.receipt_idempotency_key ?? row.idempotency_key,
    payloadHash: row.receipt_payload_hash ?? row.payload_hash,
    destinationReceiptId: row.destination_receipt_id ?? null,
    deliveredAt: Number(row.receipt_delivered_at ?? row.delivered_at),
    createdAt: Number(row.receipt_created_at ?? row.created_at),
    source: row.receipt_source ?? row.source,
  };
}

function sortEvents(events) {
  return events.sort((left, right) => (
    left.availableAt - right.availableAt
    || left.createdAt - right.createdAt
    || left.id.localeCompare(right.id)
  ));
}

function normalizeHash(value, label = "payloadHash") {
  const hash = requiredText(value, label, 64).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(hash)) throw invalidArgument(label, "must be a 64-character SHA-256 hex digest");
  return hash;
}

function equalImmutableEvent(row, expected) {
  return row.destination === expected.destination
    && row.aggregate_type === expected.aggregateType
    && row.aggregate_id === expected.aggregateId
    && Number(row.aggregate_version) === expected.aggregateVersion
    && row.event_type === expected.eventType
    && row.payload === expected.payload
    && row.payload_hash === expected.payloadHash
    && row.idempotency_key === expected.idempotencyKey;
}

export function computePublicationBackoffMs(attemptCount, options = {}) {
  const configuration = normalizeConfiguration(options);
  const attempt = safeInteger(attemptCount, "attemptCount", 1, Number.MAX_SAFE_INTEGER);
  if (configuration.baseBackoffMs === 0 || configuration.maxBackoffMs === 0) return 0;
  if (configuration.baseBackoffMs >= configuration.maxBackoffMs) return configuration.maxBackoffMs;

  const exponent = Math.min(attempt - 1, 52);
  const delay = configuration.baseBackoffMs * (2 ** exponent);
  return Number.isSafeInteger(delay) ? Math.min(delay, configuration.maxBackoffMs) : configuration.maxBackoffMs;
}

export async function initializePublicationOutbox(db) {
  requireDatabase(db);
  await db.batch(PUBLICATION_OUTBOX_SCHEMA_SQL.map((sql) => db.prepare(sql)));
  return { initialized: true, statementCount: PUBLICATION_OUTBOX_SCHEMA_SQL.length };
}

export async function enqueuePublicationEvent(db, input, options = {}) {
  requireDatabase(db);
  if (!input || typeof input !== "object") throw invalidArgument("event", "is required");

  const configuration = normalizeConfiguration(options);
  const now = readClock(options.clock);
  const event = {
    id: generateId(options.idGenerator, "event"),
    destination: requiredText(input.destination, "destination", 200),
    aggregateType: requiredText(input.aggregateType, "aggregateType", 200),
    aggregateId: requiredText(input.aggregateId, "aggregateId", 512),
    aggregateVersion: safeInteger(input.aggregateVersion, "aggregateVersion", 1, Number.MAX_SAFE_INTEGER),
    eventType: requiredText(input.eventType, "eventType", 200),
    payload: serializePublicationPayload(input.payload),
    idempotencyKey: requiredText(input.idempotencyKey, "idempotencyKey", 512),
    availableAt: input.availableAt === undefined ? now : safeTimestamp(input.availableAt, "availableAt"),
  };
  if (new TextEncoder().encode(event.payload).byteLength > configuration.maxPayloadBytes) {
    throw invalidArgument("payload", `must be at most ${configuration.maxPayloadBytes} bytes`);
  }

  const computedHash = await sha256Hex(event.payload, options.crypto ?? globalThis.crypto);
  event.payloadHash = input.payloadHash === undefined
    ? computedHash
    : normalizeHash(input.payloadHash);
  if (event.payloadHash !== computedHash) {
    throw new PublicationOutboxConflictError("The supplied payload hash does not match the serialized publication payload.");
  }

  const results = await db.batch([
    db.prepare(`
      INSERT INTO ${EVENT_TABLE} (
        id, destination, aggregate_type, aggregate_id, aggregate_version,
        event_type, payload, payload_hash, idempotency_key, status,
        attempt_count, available_at, claim_token, claimed_by, lease_expires_at,
        last_error_code, last_error_at, delivered_at, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?)
      ON CONFLICT DO NOTHING
      RETURNING id
    `).bind(
      event.id,
      event.destination,
      event.aggregateType,
      event.aggregateId,
      event.aggregateVersion,
      event.eventType,
      event.payload,
      event.payloadHash,
      event.idempotencyKey,
      event.availableAt,
      now,
      now,
    ),
    db.prepare(`
      SELECT ${EVENT_COLUMNS}
      FROM ${EVENT_TABLE}
      WHERE destination = ?
        AND (
          idempotency_key = ?
          OR (aggregate_type = ? AND aggregate_id = ? AND aggregate_version = ?)
        )
      ORDER BY id
    `).bind(
      event.destination,
      event.idempotencyKey,
      event.aggregateType,
      event.aggregateId,
      event.aggregateVersion,
    ),
  ]);

  const inserted = rowsFromResult(results[0]).length === 1;
  const matches = rowsFromResult(results[1]);
  if (matches.length !== 1 || !equalImmutableEvent(matches[0], event)) {
    throw new PublicationOutboxConflictError();
  }
  return { inserted, event: mapEvent(matches[0]) };
}

export async function claimDuePublicationEvents(db, input, options = {}) {
  requireDatabase(db);
  if (!input || typeof input !== "object") throw invalidArgument("claim", "is required");

  const configuration = normalizeConfiguration(options);
  const now = readClock(options.clock);
  const destination = requiredText(input.destination, "destination", 200);
  const workerId = requiredText(input.workerId, "workerId", 200);
  const leaseMs = safeInteger(input.leaseMs ?? configuration.defaultLeaseMs, "leaseMs", 1, 24 * 60 * 60_000);
  const limit = safeInteger(input.limit ?? configuration.defaultClaimLimit, "limit", 1, 100);
  const claimToken = generateId(options.idGenerator, "claim");
  const leaseExpiresAt = safeAdd(now, leaseMs, "lease expiration");

  const rows = await allRows(db.prepare(`
    UPDATE ${EVENT_TABLE}
    SET
      status = 'claimed',
      attempt_count = attempt_count + 1,
      claim_token = ?,
      claimed_by = ?,
      lease_expires_at = ?,
      updated_at = ?
    WHERE id IN (
      SELECT event.id
      FROM ${EVENT_TABLE} AS event
      WHERE event.destination = ?
        AND event.status = 'pending'
        AND event.available_at <= ?
        AND NOT EXISTS (
          SELECT 1
          FROM ${RECEIPT_TABLE} AS receipt
          WHERE receipt.event_id = event.id
            OR (
              receipt.destination = event.destination
              AND receipt.idempotency_key = event.idempotency_key
            )
        )
      ORDER BY event.available_at, event.created_at, event.id
      LIMIT ?
    )
      AND status = 'pending'
      AND available_at <= ?
      AND NOT EXISTS (
        SELECT 1
        FROM ${RECEIPT_TABLE} AS receipt
        WHERE receipt.event_id = ${EVENT_TABLE}.id
          OR (
            receipt.destination = ${EVENT_TABLE}.destination
            AND receipt.idempotency_key = ${EVENT_TABLE}.idempotency_key
          )
      )
    RETURNING ${EVENT_COLUMNS}
  `).bind(
    claimToken,
    workerId,
    leaseExpiresAt,
    now,
    destination,
    now,
    limit,
    now,
  ));

  const events = sortEvents(rows.map(mapEvent));
  return {
    claimToken: events.length > 0 ? claimToken : null,
    leaseExpiresAt: events.length > 0 ? leaseExpiresAt : null,
    events,
  };
}

export async function recordPublicationDelivery(db, input, options = {}) {
  requireDatabase(db);
  if (!input || typeof input !== "object") throw invalidArgument("delivery", "is required");

  normalizeConfiguration(options);
  const now = readClock(options.clock);
  const eventId = requiredText(input.eventId, "eventId", 200);
  const workerId = requiredText(input.workerId, "workerId", 200);
  const claimToken = requiredText(input.claimToken, "claimToken", 200);
  const destinationReceiptId = optionalText(input.destinationReceiptId, "destinationReceiptId", 512);
  const receiptId = generateId(options.idGenerator, "receipt");

  const results = await db.batch([
    db.prepare(`
      INSERT INTO ${RECEIPT_TABLE} (
        id, event_id, destination, idempotency_key, payload_hash,
        claim_token, claimed_by, destination_receipt_id, delivered_at, created_at, source
      )
      SELECT ?, event.id, event.destination, event.idempotency_key, event.payload_hash,
        event.claim_token, event.claimed_by, ?, ?, ?, 'delivery'
      FROM ${EVENT_TABLE} AS event
      WHERE event.id = ?
        AND event.status = 'claimed'
        AND event.claimed_by = ?
        AND event.claim_token = ?
        AND event.lease_expires_at > ?
      ON CONFLICT DO NOTHING
      RETURNING id
    `).bind(
      receiptId,
      destinationReceiptId,
      now,
      now,
      eventId,
      workerId,
      claimToken,
      now,
    ),
    db.prepare(`
      UPDATE ${EVENT_TABLE}
      SET
        status = 'delivered',
        delivered_at = ?,
        claim_token = NULL,
        claimed_by = NULL,
        lease_expires_at = NULL,
        last_error_code = NULL,
        last_error_at = NULL,
        updated_at = ?
      WHERE id = ?
        AND status = 'claimed'
        AND claimed_by = ?
        AND claim_token = ?
        AND lease_expires_at > ?
        AND EXISTS (
          SELECT 1
          FROM ${RECEIPT_TABLE} AS receipt
          WHERE receipt.event_id = ${EVENT_TABLE}.id
            AND receipt.destination = ${EVENT_TABLE}.destination
            AND receipt.idempotency_key = ${EVENT_TABLE}.idempotency_key
            AND receipt.payload_hash = ${EVENT_TABLE}.payload_hash
        )
      RETURNING ${EVENT_METADATA_COLUMNS}
    `).bind(
      now,
      now,
      eventId,
      workerId,
      claimToken,
      now,
    ),
    db.prepare(`
      SELECT
        event.${EVENT_METADATA_COLUMNS.trim().split(/,\s*/).join(", event.")},
        receipt.id AS receipt_id,
        receipt.event_id AS receipt_event_id,
        receipt.destination AS receipt_destination,
        receipt.idempotency_key AS receipt_idempotency_key,
        receipt.payload_hash AS receipt_payload_hash,
        receipt.claim_token AS receipt_claim_token,
        receipt.claimed_by AS receipt_claimed_by,
        receipt.destination_receipt_id,
        receipt.delivered_at AS receipt_delivered_at,
        receipt.created_at AS receipt_created_at,
        receipt.source AS receipt_source
      FROM ${EVENT_TABLE} AS event
      LEFT JOIN ${RECEIPT_TABLE} AS receipt
        ON receipt.event_id = event.id
        OR (
          receipt.destination = event.destination
          AND receipt.idempotency_key = event.idempotency_key
        )
      WHERE event.id = ?
    `).bind(eventId),
  ]);

  const updatedRows = rowsFromResult(results[1]);
  const finalRow = rowsFromResult(results[2])[0];
  if (!finalRow) {
    throw new PublicationOutboxError("EVENT_NOT_FOUND", "The publication event does not exist.");
  }

  const receiptMatches = finalRow.receipt_id
    && finalRow.receipt_event_id === finalRow.id
    && finalRow.receipt_destination === finalRow.destination
    && finalRow.receipt_idempotency_key === finalRow.idempotency_key
    && finalRow.receipt_payload_hash === finalRow.payload_hash;

  if (finalRow.status === "delivered" && receiptMatches) {
    const sameDeliveryClaim = finalRow.receipt_source === "delivery"
      && finalRow.receipt_claimed_by === workerId
      && finalRow.receipt_claim_token === claimToken;
    if (updatedRows.length === 1 || sameDeliveryClaim) {
      return {
        recorded: updatedRows.length === 1,
        event: mapEvent(finalRow),
        receipt: mapReceipt(finalRow),
      };
    }
    throw new StalePublicationClaimError();
  }
  if (finalRow.receipt_id && !receiptMatches) {
    throw new PublicationOutboxConflictError("The existing delivery receipt does not match this publication event.");
  }
  if (finalRow.status === "claimed" && finalRow.claimed_by === workerId && finalRow.claim_token === claimToken) {
    throw new PublicationOutboxError("DATABASE_INVARIANT", "The delivery receipt could not be linked to its claimed publication event.");
  }
  throw new StalePublicationClaimError();
}

function normalizeErrorCode(value) {
  if (value === undefined || value === null) return "DELIVERY_FAILED";
  const code = requiredText(value, "errorCode", 80);
  if (!/^[A-Za-z0-9_.:-]+$/.test(code)) {
    throw invalidArgument("errorCode", "must be an opaque code without spaces");
  }
  return code;
}

export async function markPublicationFailure(db, input, options = {}) {
  requireDatabase(db);
  if (!input || typeof input !== "object") throw invalidArgument("failure", "is required");

  const configuration = normalizeConfiguration(options);
  const now = readClock(options.clock);
  const eventId = requiredText(input.eventId, "eventId", 200);
  const workerId = requiredText(input.workerId, "workerId", 200);
  const claimToken = requiredText(input.claimToken, "claimToken", 200);
  const errorCode = normalizeErrorCode(input.errorCode);
  if (input.retryable !== undefined && typeof input.retryable !== "boolean") {
    throw invalidArgument("retryable", "must be a boolean");
  }
  const retryable = input.retryable ?? true;

  const claimRows = await allRows(db.prepare(`
    SELECT id, attempt_count
    FROM ${EVENT_TABLE}
    WHERE id = ?
      AND status = 'claimed'
      AND claimed_by = ?
      AND claim_token = ?
      AND lease_expires_at > ?
  `).bind(eventId, workerId, claimToken, now));
  if (claimRows.length !== 1) throw new StalePublicationClaimError();

  const attemptCount = Number(claimRows[0].attempt_count);
  const terminal = !retryable || attemptCount >= configuration.maxAttempts;
  const backoffMs = terminal ? null : computePublicationBackoffMs(attemptCount, configuration);
  const availableAt = terminal ? now : safeAdd(now, backoffMs, "retry time");
  const status = terminal ? "terminal" : "pending";

  const rows = await allRows(db.prepare(`
    UPDATE ${EVENT_TABLE}
    SET
      status = ?,
      available_at = ?,
      claim_token = NULL,
      claimed_by = NULL,
      lease_expires_at = NULL,
      last_error_code = ?,
      last_error_at = ?,
      updated_at = ?
    WHERE id = ?
      AND status = 'claimed'
      AND claimed_by = ?
      AND claim_token = ?
      AND lease_expires_at > ?
      AND attempt_count = ?
    RETURNING ${EVENT_METADATA_COLUMNS}
  `).bind(
    status,
    availableAt,
    errorCode,
    now,
    now,
    eventId,
    workerId,
    claimToken,
    now,
    attemptCount,
  ));
  if (rows.length !== 1) throw new StalePublicationClaimError();

  return {
    terminal,
    retryScheduled: !terminal,
    backoffMs,
    nextAttemptAt: terminal ? null : availableAt,
    event: mapEvent(rows[0]),
  };
}

export async function recoverExpiredPublicationClaims(db, input = {}, options = {}) {
  requireDatabase(db);
  if (!input || typeof input !== "object") throw invalidArgument("recovery", "must be an object");

  const configuration = normalizeConfiguration(options);
  const now = readClock(options.clock);
  const destination = input.destination === undefined || input.destination === null
    ? null
    : requiredText(input.destination, "destination", 200);
  const limit = safeInteger(input.limit ?? configuration.defaultRecoveryLimit, "limit", 1, 500);

  const rows = await allRows(db.prepare(`
    UPDATE ${EVENT_TABLE}
    SET
      status = CASE WHEN attempt_count >= ? THEN 'terminal' ELSE 'pending' END,
      available_at = ?,
      claim_token = NULL,
      claimed_by = NULL,
      lease_expires_at = NULL,
      last_error_code = 'LEASE_EXPIRED',
      last_error_at = ?,
      updated_at = ?
    WHERE id IN (
      SELECT event.id
      FROM ${EVENT_TABLE} AS event
      WHERE event.status = 'claimed'
        AND event.lease_expires_at <= ?
        AND (? IS NULL OR event.destination = ?)
        AND NOT EXISTS (
          SELECT 1
          FROM ${RECEIPT_TABLE} AS receipt
          WHERE receipt.event_id = event.id
            OR (
              receipt.destination = event.destination
              AND receipt.idempotency_key = event.idempotency_key
            )
        )
      ORDER BY event.lease_expires_at, event.created_at, event.id
      LIMIT ?
    )
      AND status = 'claimed'
      AND lease_expires_at <= ?
      AND NOT EXISTS (
        SELECT 1
        FROM ${RECEIPT_TABLE} AS receipt
        WHERE receipt.event_id = ${EVENT_TABLE}.id
          OR (
            receipt.destination = ${EVENT_TABLE}.destination
            AND receipt.idempotency_key = ${EVENT_TABLE}.idempotency_key
          )
      )
    RETURNING ${EVENT_METADATA_COLUMNS}
  `).bind(
    configuration.maxAttempts,
    now,
    now,
    now,
    now,
    destination,
    destination,
    limit,
    now,
  ));

  const events = sortEvents(rows.map(mapEvent));
  return {
    recoveredCount: events.filter((event) => event.status === "pending").length,
    terminalCount: events.filter((event) => event.status === "terminal").length,
    events,
  };
}

export async function reconcilePublicationOutbox(db, input = {}, options = {}) {
  requireDatabase(db);
  if (!input || typeof input !== "object") throw invalidArgument("reconciliation", "must be an object");

  const configuration = normalizeConfiguration(options);
  const now = readClock(options.clock);
  const destination = input.destination === undefined || input.destination === null
    ? null
    : requiredText(input.destination, "destination", 200);
  const limit = safeInteger(input.limit ?? configuration.defaultReconcileLimit, "limit", 1, 40);

  const inspectionResults = await db.batch([
    db.prepare(`
      SELECT event.id AS event_id, receipt.id AS receipt_id
      FROM ${EVENT_TABLE} AS event
      JOIN ${RECEIPT_TABLE} AS receipt
        ON receipt.event_id = event.id
        OR (
          receipt.destination = event.destination
          AND receipt.idempotency_key = event.idempotency_key
        )
      WHERE (
          receipt.event_id != event.id
          OR receipt.destination != event.destination
          OR receipt.idempotency_key != event.idempotency_key
          OR receipt.payload_hash != event.payload_hash
        )
        AND (? IS NULL OR event.destination = ?)
      ORDER BY event.updated_at, event.id
      LIMIT ?
    `).bind(destination, destination, limit),
    db.prepare(`
      SELECT event.id, event.delivered_at
      FROM ${EVENT_TABLE} AS event
      LEFT JOIN ${RECEIPT_TABLE} AS receipt
        ON receipt.event_id = event.id
        OR (
          receipt.destination = event.destination
          AND receipt.idempotency_key = event.idempotency_key
        )
      WHERE event.status = 'delivered'
        AND receipt.id IS NULL
        AND (? IS NULL OR event.destination = ?)
      ORDER BY event.updated_at, event.id
      LIMIT ?
    `).bind(destination, destination, limit),
  ]);

  const conflicts = rowsFromResult(inspectionResults[0]).map((row) => ({
    eventId: row.event_id,
    receiptId: row.receipt_id,
    reason: "RECEIPT_EVENT_MISMATCH",
  }));
  if (conflicts.length > 0) {
    return { receiptsCreated: 0, eventsMarkedDelivered: 0, conflicts };
  }

  const missingReceiptEvents = rowsFromResult(inspectionResults[1]);
  const receiptStatements = missingReceiptEvents.map((event) => db.prepare(`
    INSERT INTO ${RECEIPT_TABLE} (
      id, event_id, destination, idempotency_key, payload_hash,
      claim_token, claimed_by, destination_receipt_id, delivered_at, created_at, source
    )
    SELECT ?, current.id, current.destination, current.idempotency_key, current.payload_hash,
      NULL, NULL, NULL, current.delivered_at, ?, 'reconciled'
    FROM ${EVENT_TABLE} AS current
    WHERE current.id = ?
      AND current.status = 'delivered'
      AND NOT EXISTS (
        SELECT 1
        FROM ${RECEIPT_TABLE} AS receipt
        WHERE receipt.event_id = current.id
          OR (
            receipt.destination = current.destination
            AND receipt.idempotency_key = current.idempotency_key
          )
      )
    ON CONFLICT DO NOTHING
    RETURNING id
  `).bind(
    generateId(options.idGenerator, "reconciliation receipt"),
    now,
    event.id,
  ));

  const repairStatement = db.prepare(`
    UPDATE ${EVENT_TABLE}
    SET
      status = 'delivered',
      delivered_at = COALESCE((
        SELECT receipt.delivered_at
        FROM ${RECEIPT_TABLE} AS receipt
        WHERE receipt.event_id = ${EVENT_TABLE}.id
          AND receipt.destination = ${EVENT_TABLE}.destination
          AND receipt.idempotency_key = ${EVENT_TABLE}.idempotency_key
          AND receipt.payload_hash = ${EVENT_TABLE}.payload_hash
      ), ?),
      claim_token = NULL,
      claimed_by = NULL,
      lease_expires_at = NULL,
      last_error_code = NULL,
      last_error_at = NULL,
      updated_at = ?
    WHERE id IN (
      SELECT event.id
      FROM ${EVENT_TABLE} AS event
      JOIN ${RECEIPT_TABLE} AS receipt
        ON receipt.event_id = event.id
        AND receipt.destination = event.destination
        AND receipt.idempotency_key = event.idempotency_key
        AND receipt.payload_hash = event.payload_hash
      WHERE event.status IN ('pending', 'claimed', 'terminal')
        AND (? IS NULL OR event.destination = ?)
      ORDER BY event.updated_at, event.id
      LIMIT ?
    )
      AND status IN ('pending', 'claimed', 'terminal')
    RETURNING ${EVENT_METADATA_COLUMNS}
  `).bind(now, now, destination, destination, limit);

  const mutationResults = await db.batch([...receiptStatements, repairStatement]);
  const receiptResults = mutationResults.slice(0, receiptStatements.length);
  const repairedRows = rowsFromResult(mutationResults[mutationResults.length - 1]);
  return {
    receiptsCreated: receiptResults.reduce((count, result) => count + rowsFromResult(result).length, 0),
    eventsMarkedDelivered: repairedRows.length,
    conflicts: [],
  };
}

export function createPublicationOutbox(options = {}) {
  const { db, ...dependencies } = options;
  requireDatabase(db);
  normalizeConfiguration(dependencies);

  return Object.freeze({
    initialize: () => initializePublicationOutbox(db),
    enqueue: (input) => enqueuePublicationEvent(db, input, dependencies),
    claimDue: (input) => claimDuePublicationEvents(db, input, dependencies),
    recordDelivery: (input) => recordPublicationDelivery(db, input, dependencies),
    markFailure: (input) => markPublicationFailure(db, input, dependencies),
    recoverExpiredClaims: (input) => recoverExpiredPublicationClaims(db, input, dependencies),
    reconcile: (input) => reconcilePublicationOutbox(db, input, dependencies),
  });
}
