const LOCK_NAME = "collection";
const DEFAULT_LEASE_MS = 20 * 60_000;
const MAX_LEASE_MS = 60 * 60_000;

function requireDb(db) {
  if (!db || typeof db.prepare !== "function") throw new TypeError("A D1-compatible database is required.");
  return db;
}

function timestamp(value, name) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new TypeError(`${name} must be a non-negative integer.`);
  return number;
}

function requiredString(value, name) {
  const text = String(value ?? "").trim();
  if (!text || text.length > 256) throw new TypeError(`${name} is invalid.`);
  return text;
}

function leaseDuration(value) {
  const milliseconds = value === undefined ? DEFAULT_LEASE_MS : Number(value);
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 1000 || milliseconds > MAX_LEASE_MS) {
    throw new TypeError("leaseMs must be between one second and one hour.");
  }
  return milliseconds;
}

export async function acquireCollectionRunLease(db, options = {}) {
  requireDb(db);
  const now = timestamp(options.now ?? Date.now(), "now");
  const leaseMs = leaseDuration(options.leaseMs);
  const owner = requiredString(options.owner, "owner");
  const token = requiredString(options.token ?? crypto.randomUUID(), "token");
  const leaseExpiresAt = now + leaseMs;
  const row = await db.prepare(`
    INSERT INTO collection_execution_locks
      (name, owner, lease_token, lease_expires_at, acquired_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET
      owner = excluded.owner,
      lease_token = excluded.lease_token,
      lease_expires_at = excluded.lease_expires_at,
      acquired_at = excluded.acquired_at,
      updated_at = excluded.updated_at
    WHERE collection_execution_locks.lease_expires_at <= ?
    RETURNING name, owner, lease_token AS leaseToken, lease_expires_at AS leaseExpiresAt,
      acquired_at AS acquiredAt
  `).bind(LOCK_NAME, owner, token, leaseExpiresAt, now, now, now).first();
  return row ? {
    name: row.name,
    owner: row.owner,
    token: row.leaseToken,
    leaseExpiresAt: Number(row.leaseExpiresAt),
    acquiredAt: Number(row.acquiredAt),
  } : null;
}

export async function releaseCollectionRunLease(db, lease) {
  requireDb(db);
  if (!lease) return false;
  const result = await db.prepare(`
    DELETE FROM collection_execution_locks
    WHERE name = ? AND owner = ? AND lease_token = ?
  `).bind(
    LOCK_NAME,
    requiredString(lease.owner, "owner"),
    requiredString(lease.token, "token"),
  ).run();
  const changes = Number(result?.meta?.changes ?? result?.changes ?? 0);
  return changes > 0;
}
