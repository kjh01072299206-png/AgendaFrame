import {
  AdminAuthorizationError,
  DurableJobsError,
  createDurableJobsService,
} from "./durable-jobs.mjs";
import {
  PublicationOutboxError,
  createPublicationOutbox,
} from "./publication-outbox.mjs";
import discoveryPolicy from "../data/discovery-sources.json" with { type: "json" };
import collectionSchedule from "../data/collection-schedule.json" with { type: "json" };

export const OPERATIONS_QUEUE = "operations";
export const PUBLICATION_DESTINATION = "public-site-local";
const MAINTENANCE_JOB_TYPE = "operational_maintenance";
const MAINTENANCE_LEASE_MS = 60_000;
const MAX_DELIVERY_BATCH = 25;
const MAX_ADMIN_LIST = 100;

function requireDatabase(env) {
  if (!env?.DB || typeof env.DB.prepare !== "function" || typeof env.DB.batch !== "function") {
    throw new TypeError("A D1-compatible DB binding is required.");
  }
  return env.DB;
}

function normalizeClock(clock = Date.now) {
  if (typeof clock !== "function") throw new TypeError("clock must be a function.");
  return () => {
    const value = Number(clock());
    if (!Number.isSafeInteger(value) || value < 0) throw new TypeError("clock must return a non-negative integer.");
    return value;
  };
}

function normalizeIdGenerator(generator = () => crypto.randomUUID()) {
  if (typeof generator !== "function") throw new TypeError("idGenerator must be a function.");
  return (kind) => {
    const value = String(generator(kind) ?? "").trim();
    if (!value || value.length > 200) throw new TypeError(`${kind} ID is invalid.`);
    return value;
  };
}

function boundedInteger(value, fallback, minimum, maximum) {
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    throw new TypeError(`Expected an integer between ${minimum} and ${maximum}.`);
  }
  return number;
}

function resultRows(result) {
  return Array.isArray(result?.results) ? result.results : [];
}

function createServices(env, options = {}) {
  const db = requireDatabase(env);
  const clock = normalizeClock(options.clock);
  const generateId = normalizeIdGenerator(options.idGenerator);
  let leaseSequence = 0;
  const leaseTokenGenerator = options.leaseTokenGenerator
    ? normalizeIdGenerator(options.leaseTokenGenerator)
    : (kind) => generateId(`${kind}-${++leaseSequence}`);
  return {
    db,
    clock,
    jobs: createDurableJobsService(db, {
      clock,
      idGenerator: generateId,
      leaseTokenGenerator,
      authorizeAdmin: ({ adminActor }) => adminActor === "operations-admin",
      defaultLeaseMs: MAINTENANCE_LEASE_MS,
      retryBaseDelayMs: 5_000,
      retryMaxDelayMs: 15 * 60_000,
    }),
    outbox: createPublicationOutbox({
      db,
      clock,
      idGenerator: generateId,
      baseBackoffMs: 5_000,
      maxBackoffMs: 15 * 60_000,
      maxAttempts: 8,
      defaultLeaseMs: MAINTENANCE_LEASE_MS,
      defaultClaimLimit: MAX_DELIVERY_BATCH,
    }),
  };
}

function parsePublicationPayload(event) {
  let payload;
  try {
    payload = JSON.parse(event.payload);
  } catch {
    return null;
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  if (payload.schemaVersion !== 1) return null;
  if (payload.issueId !== event.aggregateId || event.aggregateType !== "issue") return null;
  if (typeof payload.runId !== "string" || !payload.runId || payload.runId.length > 128) return null;
  if (typeof payload.targetDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(payload.targetDate)) return null;
  if (typeof payload.publicApiVersion !== "string" || payload.publicApiVersion.length > 80) return null;
  if (typeof payload.comparisonSchemaVersion !== "string" || payload.comparisonSchemaVersion.length > 80) return null;
  return payload;
}

async function deliverLocalPublicationBatch(services, workerId, limit = MAX_DELIVERY_BATCH) {
  const claim = await services.outbox.claimDue({
    destination: PUBLICATION_DESTINATION,
    workerId,
    leaseMs: MAINTENANCE_LEASE_MS,
    limit,
  });
  const summary = { claimed: claim.events.length, delivered: 0, retried: 0, terminal: 0 };
  for (const event of claim.events) {
    const payload = parsePublicationPayload(event);
    if (!payload) {
      const failure = await services.outbox.markFailure({
        eventId: event.id,
        workerId,
        claimToken: claim.claimToken,
        retryable: false,
        errorCode: "INVALID_EVENT_PAYLOAD",
      });
      summary[failure.terminal ? "terminal" : "retried"] += 1;
      continue;
    }
    const aggregate = await services.db.prepare(`
      SELECT
        issue.id AS issueId,
        issue.run_id AS runId,
        issue.issue_date AS targetDate,
        run.status AS runStatus,
        comparison.schema_version AS comparisonSchemaVersion
      FROM issues AS issue
      JOIN analysis_runs AS run ON run.id = issue.run_id
      LEFT JOIN issue_frame_comparisons AS comparison ON comparison.issue_id = issue.id
      WHERE issue.id = ?
      LIMIT 1
    `).bind(event.aggregateId).first();
    const aggregateReady = aggregate
      && aggregate.runId === payload.runId
      && aggregate.targetDate === payload.targetDate
      && aggregate.runStatus === "success"
      && (aggregate.comparisonSchemaVersion ?? "none") === payload.comparisonSchemaVersion;
    if (!aggregateReady) {
      const failure = await services.outbox.markFailure({
        eventId: event.id,
        workerId,
        claimToken: claim.claimToken,
        retryable: true,
        errorCode: aggregate ? "AGGREGATE_NOT_READY" : "AGGREGATE_NOT_FOUND",
      });
      summary[failure.terminal ? "terminal" : "retried"] += 1;
      continue;
    }
    await services.outbox.recordDelivery({
      eventId: event.id,
      workerId,
      claimToken: claim.claimToken,
      destinationReceiptId: `d1:${event.aggregateId}:v${event.aggregateVersion}`,
    });
    summary.delivered += 1;
  }
  return summary;
}

async function checkpointPhase(jobs, lease, phase, summary) {
  const updated = await jobs.compareAndSetCheckpoint({
    jobId: lease.id,
    leaseOwner: lease.leaseOwner,
    leaseToken: lease.leaseToken,
    expectedVersion: lease.checkpointVersion,
    checkpoint: { schemaVersion: 1, phase, summary },
  });
  return updated;
}

export async function recoverOperationalState(env, options = {}) {
  const services = createServices(env, options);
  const durable = await services.jobs.recoverExpiredLeases({ limit: 50 });
  const publication = await services.outbox.recoverExpiredClaims({
    destination: PUBLICATION_DESTINATION,
    limit: 100,
  });
  const reconciliation = await services.outbox.reconcile({
    destination: PUBLICATION_DESTINATION,
    limit: 40,
  });
  return { durable, publication, reconciliation };
}

export async function runScheduledOperations(env, options = {}) {
  const services = createServices(env, options);
  const scheduledTime = boundedInteger(options.scheduledTime, services.clock(), 0, Number.MAX_SAFE_INTEGER);
  const workerId = String(options.workerId ?? `scheduled-${Math.floor(scheduledTime / 60_000)}`).slice(0, 200);
  if (!workerId) throw new TypeError("workerId is required.");

  const recovered = await services.jobs.recoverExpiredLeases({ limit: 50 });
  const uniqueKey = `maintenance:${Math.floor(scheduledTime / 60_000)}`;
  const enqueued = await services.jobs.enqueueUniqueJob({
    queue: OPERATIONS_QUEUE,
    jobType: MAINTENANCE_JOB_TYPE,
    uniqueKey,
    payload: { schemaVersion: 1, scheduledTime },
    maxAttempts: 5,
  });
  let lease = await services.jobs.acquireDueJob({
    queue: OPERATIONS_QUEUE,
    leaseOwner: workerId,
    leaseMs: MAINTENANCE_LEASE_MS,
  });
  if (!lease) return { recovered, enqueued: enqueued.enqueued, processed: false };

  try {
    const priorPhase = Number(lease.checkpoint?.phase ?? 0);
    const summary = { ...(lease.checkpoint?.summary ?? {}) };
    if (priorPhase < 1) {
      summary.expiredClaims = await services.outbox.recoverExpiredClaims({
        destination: PUBLICATION_DESTINATION,
        limit: 100,
      });
      lease = await checkpointPhase(services.jobs, lease, 1, summary);
    }
    lease = await services.jobs.renewLease({
      jobId: lease.id,
      leaseOwner: lease.leaseOwner,
      leaseToken: lease.leaseToken,
      leaseMs: MAINTENANCE_LEASE_MS,
    });
    if (Number(lease.checkpoint?.phase ?? 0) < 2) {
      summary.reconciliation = await services.outbox.reconcile({
        destination: PUBLICATION_DESTINATION,
        limit: 40,
      });
      lease = await checkpointPhase(services.jobs, lease, 2, summary);
    }
    lease = await services.jobs.renewLease({
      jobId: lease.id,
      leaseOwner: lease.leaseOwner,
      leaseToken: lease.leaseToken,
      leaseMs: MAINTENANCE_LEASE_MS,
    });
    if (Number(lease.checkpoint?.phase ?? 0) < 3) {
      summary.delivery = await deliverLocalPublicationBatch(services, workerId);
      lease = await checkpointPhase(services.jobs, lease, 3, summary);
    }
    const completed = await services.jobs.completeJob({
      jobId: lease.id,
      leaseOwner: lease.leaseOwner,
      leaseToken: lease.leaseToken,
    });
    return {
      recovered,
      enqueued: enqueued.enqueued,
      processed: true,
      jobId: completed.id,
      status: completed.status,
      summary,
    };
  } catch (error) {
    let failure = null;
    try {
      failure = await services.jobs.failJob({
        jobId: lease.id,
        leaseOwner: lease.leaseOwner,
        leaseToken: lease.leaseToken,
        failureCode: error instanceof PublicationOutboxError ? "OUTBOX_MAINTENANCE_FAILED" : "MAINTENANCE_FAILED",
      });
    } catch {
      failure = null;
    }
    if (error instanceof DurableJobsError || error instanceof PublicationOutboxError) throw error;
    const wrapped = new DurableJobsError("MAINTENANCE_FAILED", "The scheduled maintenance job failed.");
    wrapped.retry = failure;
    throw wrapped;
  }
}

export async function readOperationsStatus(env) {
  const db = requireDatabase(env);
  const results = await db.batch([
    db.prepare("SELECT status, COUNT(*) AS count FROM durable_jobs GROUP BY status ORDER BY status"),
    db.prepare("SELECT status, COUNT(*) AS count FROM publication_outbox_events GROUP BY status ORDER BY status"),
    db.prepare("SELECT COUNT(*) AS count FROM durable_job_dead_letters WHERE redriven_at IS NULL"),
  ]);
  return {
    jobs: resultRows(results[0]).map((row) => ({ status: row.status, count: Number(row.count) })),
    outbox: resultRows(results[1]).map((row) => ({ status: row.status, count: Number(row.count) })),
    openDeadLetters: Number(resultRows(results[2])[0]?.count ?? 0),
  };
}

export async function listOpenDeadLetters(env, options = {}) {
  const db = requireDatabase(env);
  const limit = boundedInteger(options.limit, 25, 1, MAX_ADMIN_LIST);
  const result = await db.prepare(`
    SELECT
      dead.id,
      dead.job_id AS jobId,
      dead.queue,
      dead.job_type AS jobType,
      dead.reason_code AS reasonCode,
      dead.attempt_count AS attemptCount,
      dead.checkpoint_version AS checkpointVersion,
      dead.dead_lettered_at AS deadLetteredAt,
      job.status
    FROM durable_job_dead_letters AS dead
    JOIN durable_jobs AS job ON job.id = dead.job_id
    WHERE dead.redriven_at IS NULL
    ORDER BY dead.dead_lettered_at ASC, dead.id ASC
    LIMIT ?
  `).bind(limit).all();
  return resultRows(result).map((row) => ({
    id: row.id,
    jobId: row.jobId,
    queue: row.queue,
    jobType: row.jobType,
    reasonCode: row.reasonCode,
    attemptCount: Number(row.attemptCount),
    checkpointVersion: Number(row.checkpointVersion),
    deadLetteredAt: Number(row.deadLetteredAt),
    status: row.status,
  }));
}

export async function redriveOperationalJob(env, jobId, options = {}) {
  const services = createServices(env, options);
  return services.jobs.adminRedrive({
    jobId,
    adminActor: "operations-admin",
    authorization: "runtime-authorized",
  });
}

async function secureTokenMatches(candidate, configured) {
  if (!candidate || !configured) return false;
  const encoder = new TextEncoder();
  const [left, right] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(candidate)),
    crypto.subtle.digest("SHA-256", encoder.encode(String(configured))),
  ]);
  const leftBytes = new Uint8Array(left);
  const rightBytes = new Uint8Array(right);
  let difference = leftBytes.length ^ rightBytes.length;
  for (let index = 0; index < Math.max(leftBytes.length, rightBytes.length); index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return difference === 0;
}

async function adminAuthorized(request, env) {
  const tokens = [env?.IMPORT_TOKEN, env?.CODEX_IMPORT_TOKEN].filter(Boolean);
  if (!tokens.length) return false;
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if ((origin && origin !== url.origin) || (fetchSite && !["same-origin", "none"].includes(fetchSite))) return false;
  const authorization = request.headers.get("authorization") ?? "";
  const candidate = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  const matches = await Promise.all(tokens.map((token) => secureTokenMatches(candidate, token)));
  return matches.some(Boolean);
}

function operationResponse(request, body, status = 200) {
  const requestId = request.headers.get("cf-ray") ?? request.headers.get("x-request-id") ?? crypto.randomUUID();
  return Response.json({ ...body, requestId }, {
    status,
    headers: { "cache-control": "no-store", "x-request-id": requestId },
  });
}

function safeJobId(value) {
  const jobId = decodeURIComponent(value ?? "").trim();
  return jobId && jobId.length <= 200 ? jobId : null;
}

export function compactCollectionRunResult(result) {
  return {
    status: result?.status ?? "unknown",
    scheduledTime: result?.scheduledTime ?? null,
    lease: result?.lease ?? null,
    retention: result?.retention ? {
      selected: Number(result.retention.selected ?? 0),
      deleted: Number(result.retention.deleted ?? 0),
      failed: Number(result.retention.failed ?? 0),
      drained: result.retention.drained === true,
    } : null,
    discovery: result?.discovery ? {
      status: result.discovery.status ?? "unknown",
      deadlineExceeded: result.discovery.deadlineExceeded === true,
      discovered: Array.isArray(result.discovery.records) ? result.discovery.records.length : 0,
      sources: Array.isArray(result.discovery.sources) ? result.discovery.sources.map((source) => ({
        sourceId: source.sourceId,
        status: source.status,
        discovered: Number(source.discovered ?? 0),
      })) : [],
    } : null,
    discoveryPersistence: result?.discoveryPersistence ?? null,
    bodyCollection: result?.bodyCollection ? {
      status: result.bodyCollection.status ?? "unknown",
      selected: Number(result.bodyCollection.selected ?? 0),
      stored: Number(result.bodyCollection.stored ?? 0),
      failed: Number(result.bodyCollection.failed ?? 0),
    } : null,
    profileAnalysis: result?.profileAnalysis ? {
      status: result.profileAnalysis.status ?? "unknown",
      selected: Number(result.profileAnalysis.selected ?? 0),
      analyzed: Number(result.profileAnalysis.analyzed ?? 0),
      failed: Number(result.profileAnalysis.failed ?? 0),
      dates: Array.isArray(result.profileAnalysis.dates) ? result.profileAnalysis.dates : [],
    } : null,
    aggregateAnalysis: Array.isArray(result?.aggregateAnalysis) ? result.aggregateAnalysis : [],
    operations: result?.operations ?? null,
    stageErrors: Array.isArray(result?.stageErrors) ? result.stageErrors : [],
  };
}

export async function handleOperationsAdminRequest(request, env = {}) {
  const url = new URL(request.url);
  const managed = url.pathname === "/api/admin/operations"
    || url.pathname === "/api/admin/operations/recover"
    || url.pathname === "/api/admin/operations/run"
    || url.pathname === "/api/admin/jobs/dead-letters"
    || url.pathname === "/api/admin/collection/status"
    || url.pathname === "/api/admin/collection/run"
    || /^\/api\/admin\/jobs\/[^/]+\/redrive$/.test(url.pathname);
  if (!managed) return null;
  if (!env?.DB) return operationResponse(request, { error: { code: "UNAVAILABLE", message: "운영 저장소가 준비되지 않았습니다." } }, 503);
  if (!(await adminAuthorized(request, env))) {
    return operationResponse(request, { error: { code: "UNAUTHORIZED", message: "관리자 인증이 필요합니다." } }, 401);
  }
  try {
    if (url.pathname === "/api/admin/operations" && request.method === "GET") {
      return operationResponse(request, { operations: await readOperationsStatus(env) });
    }
    if (url.pathname === "/api/admin/collection/status" && request.method === "GET") {
      const { readCollectionWorkflowStatus } = await import("./collection-status.mjs");
      return operationResponse(request, {
        collection: await readCollectionWorkflowStatus(env, discoveryPolicy, {
          scheduleConfigured: collectionSchedule.enabled === true && collectionSchedule.cronsUtc.length > 0,
        }),
      });
    }
    if (url.pathname === "/api/admin/collection/run" && request.method === "POST") {
      if (!env?.CONTENT) return operationResponse(request, { error: { code: "UNAVAILABLE", message: "비공개 본문 저장소가 준비되지 않았습니다." } }, 503);
      const { runScheduledAgendaFrame } = await import("./content-retention.mjs");
      const collection = await runScheduledAgendaFrame(env, {
          scheduledTime: Date.now(),
          discoveryPolicy,
        });
      return operationResponse(request, { collection: compactCollectionRunResult(collection) });
    }
    if (url.pathname === "/api/admin/jobs/dead-letters" && request.method === "GET") {
      const limit = boundedInteger(Number(url.searchParams.get("limit") ?? 25), 25, 1, MAX_ADMIN_LIST);
      return operationResponse(request, { deadLetters: await listOpenDeadLetters(env, { limit }) });
    }
    if (url.pathname === "/api/admin/operations/recover" && request.method === "POST") {
      return operationResponse(request, { recovery: await recoverOperationalState(env) });
    }
    if (url.pathname === "/api/admin/operations/run" && request.method === "POST") {
      return operationResponse(request, {
        maintenance: await runScheduledOperations(env, {
          scheduledTime: Date.now(),
          workerId: `admin-${crypto.randomUUID()}`,
        }),
      });
    }
    const redrive = url.pathname.match(/^\/api\/admin\/jobs\/([^/]+)\/redrive$/);
    if (redrive && request.method === "POST") {
      const jobId = safeJobId(redrive[1]);
      if (!jobId) return operationResponse(request, { error: { code: "INVALID_REQUEST", message: "작업 ID를 확인해 주세요." } }, 400);
      return operationResponse(request, { redrive: await redriveOperationalJob(env, jobId) });
    }
    return operationResponse(request, { error: { code: "METHOD_NOT_ALLOWED", message: "허용되지 않은 요청 방식입니다." } }, 405);
  } catch (error) {
    if (error instanceof AdminAuthorizationError) {
      return operationResponse(request, { error: { code: "FORBIDDEN", message: "관리자 작업을 수행할 수 없습니다." } }, 403);
    }
    if (error instanceof TypeError) {
      return operationResponse(request, { error: { code: "INVALID_REQUEST", message: "운영 요청 형식을 확인해 주세요." } }, 400);
    }
    const code = error instanceof DurableJobsError || error instanceof PublicationOutboxError
      ? error.code
      : "OPERATIONS_FAILED";
    return operationResponse(request, { error: { code, message: "운영 작업을 완료하지 못했습니다." } }, 409);
  }
}
