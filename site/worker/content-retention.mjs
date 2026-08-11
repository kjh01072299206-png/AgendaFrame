export const RAW_CONTENT_DELETE_AFTER = Date.parse("2026-10-31T23:59:59+09:00");
const DEFAULT_BATCH_LIMIT = 100;
const MAX_BATCH_LIMIT = 500;
const DEFAULT_DRAIN_BATCHES = 20;
const COLLECTION_LEASE_MS = 60 * 60_000;
const COLLECTION_RUN_LIMIT_MS = 12 * 60_000;

function requireBindings(env) {
  if (!env?.DB || typeof env.DB.prepare !== "function") throw new TypeError("A D1-compatible DB binding is required.");
  if (!env?.CONTENT || typeof env.CONTENT.delete !== "function") throw new TypeError("An R2 CONTENT binding with delete() is required.");
  return env;
}

function normalizeNow(value) {
  const timestamp = value === undefined ? Date.now() : Number(value);
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) throw new TypeError("now must be a non-negative integer timestamp.");
  return timestamp;
}

function normalizeLimit(value) {
  const limit = value === undefined ? DEFAULT_BATCH_LIMIT : Number(value);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_BATCH_LIMIT) {
    throw new TypeError(`limit must be an integer from 1 to ${MAX_BATCH_LIMIT}.`);
  }
  return limit;
}

function rows(result) {
  return Array.isArray(result?.results) ? result.results : [];
}

export async function purgeExpiredArticleContent(env, options = {}) {
  requireBindings(env);
  const now = normalizeNow(options.now);
  const limit = normalizeLimit(options.limit);
  const hardShutdownReached = now > RAW_CONTENT_DELETE_AFTER;
  const result = await env.DB.prepare(`
    SELECT id, article_id AS articleId, object_key AS objectKey, usage_expires_at AS usageExpiresAt
    FROM article_contents
    WHERE status = 'active'
      AND (
        (? = 1)
        OR (usage_expires_at IS NOT NULL AND usage_expires_at <= ?)
      )
    ORDER BY COALESCE(usage_expires_at, ?) ASC, acquired_at ASC, id ASC
    LIMIT ?
  `).bind(hardShutdownReached ? 1 : 0, now, RAW_CONTENT_DELETE_AFTER, limit).all();

  const summary = {
    now,
    hardShutdownReached,
    selected: rows(result).length,
    deleted: 0,
    failed: 0,
    failures: [],
  };
  for (const content of rows(result)) {
    try {
      await env.CONTENT.delete(content.objectKey);
      await env.DB.prepare(`
        UPDATE article_contents
        SET status = 'expired', analysis_allowed = 0, public_evidence_allowed = 0
        WHERE id = ? AND status = 'active'
      `).bind(content.id).run();
      summary.deleted += 1;
    } catch {
      summary.failed += 1;
      summary.failures.push({ contentId: content.id, code: "DELETE_FAILED" });
    }
  }
  return summary;
}

export async function drainExpiredArticleContent(env, options = {}) {
  const limit = normalizeLimit(options.limit ?? MAX_BATCH_LIMIT);
  const maxBatches = Number(options.maxBatches ?? DEFAULT_DRAIN_BATCHES);
  if (!Number.isSafeInteger(maxBatches) || maxBatches < 1 || maxBatches > 100) {
    throw new TypeError("maxBatches must be an integer from 1 to 100.");
  }
  const summary = { now: normalizeNow(options.now), batches: 0, selected: 0, deleted: 0, failed: 0, failures: [], drained: false };
  for (let index = 0; index < maxBatches; index += 1) {
    const batch = await purgeExpiredArticleContent(env, { now: summary.now, limit });
    summary.batches += 1;
    summary.selected += batch.selected;
    summary.deleted += batch.deleted;
    summary.failed += batch.failed;
    summary.failures.push(...batch.failures);
    if (batch.selected < limit) {
      summary.drained = batch.failed === 0;
      break;
    }
    if (batch.deleted === 0) break;
  }
  return summary;
}

export async function runScheduledAgendaFrame(env, options = {}) {
  const scheduledTime = normalizeNow(options.scheduledTime);
  const clockNow = normalizeNow(options.clockNow ?? Date.now());
  const { acquireCollectionRunLease, releaseCollectionRunLease } = await import("./collection-run-lease.mjs");
  const lease = await acquireCollectionRunLease(env.DB, {
    now: clockNow,
    leaseMs: options.collectionLeaseMs ?? COLLECTION_LEASE_MS,
    owner: String(options.workerId ?? `collection-${scheduledTime}-${crypto.randomUUID()}`).slice(0, 256),
    token: options.leaseToken,
  });
  if (!lease) {
    return { status: "skipped_overlap", scheduledTime, lease: { acquired: false } };
  }
  try {
    return await runLeasedAgendaFrame(env, options, scheduledTime, lease);
  } finally {
    await releaseCollectionRunLease(env.DB, lease);
  }
}

async function runLeasedAgendaFrame(env, options, scheduledTime, lease) {
  const runDeadline = normalizeNow(options.runDeadline ?? (Date.now() + COLLECTION_RUN_LIMIT_MS));
  const { createSerialRequestGate } = await import("./request-limiter.mjs");
  const beforePublisherRequest = createSerialRequestGate({
    minimumDelayMilliseconds: options.discoveryPolicy?.polling?.minimumDelayMilliseconds ?? 3000,
    sleepImpl: options.sleepImpl,
  });
  const stageErrors = [];
  const [{ runScheduledOperations }, retention] = await Promise.all([
    import("./operations.mjs"),
    drainExpiredArticleContent(env, { now: scheduledTime, limit: options.retentionLimit }),
  ]);
  let discovery = { status: "not_configured", records: [], sources: [] };
  let discoveryPersistence = null;
  let bodyCollection = { status: "not_configured", selected: 0, stored: 0, failed: 0, results: [] };
  let profileAnalysis = { status: "not_configured", selected: 0, analyzed: 0, failed: 0, dates: [], results: [] };
  let aggregateAnalysis = [];
  if (options.discoveryPolicy) {
    const enabled = options.discoveryPolicy.sources
      .some((source) => source.endpoints.some((endpoint) => endpoint.enabled));
    if (enabled) {
      const [{ runDiscoveryCycle }, { persistDiscoveryCycle }] = await Promise.all([
        import("./article-discovery.mjs"),
        import("./discovery-store.mjs"),
      ]);
      const fetchImpl = options.discoveryFetchImpl
        ?? (env?.ARTICLE_FETCHER?.fetch ? env.ARTICLE_FETCHER.fetch.bind(env.ARTICLE_FETCHER) : fetch);
      discovery = await runDiscoveryCycle(options.discoveryPolicy, {
        fetchImpl,
        now: scheduledTime,
        deadlineTimestamp: runDeadline,
        beforeRequest: beforePublisherRequest,
      });
      if (["success", "partial"].includes(discovery.status)) {
        discoveryPersistence = await persistDiscoveryCycle(env.DB, options.discoveryPolicy, discovery);
      }
      if (Date.now() < runDeadline) {
        const { collectAuthorizedArticleBodies } = await import("./authorized-body-collector.mjs");
        bodyCollection = await collectAuthorizedArticleBodies(env, options.discoveryPolicy, {
          fetchImpl,
          now: scheduledTime,
          deadlineTimestamp: runDeadline,
          beforeRequest: beforePublisherRequest,
        });
      } else {
        bodyCollection = { status: "run_deadline_exceeded", selected: 0, stored: 0, failed: 0, results: [] };
      }
      if (Date.now() < runDeadline) {
        try {
          const { analyzeStoredArticleBodies, runStoredAnalysisForDates } = await import("./stored-body-analysis.mjs");
          profileAnalysis = await analyzeStoredArticleBodies(env, options.discoveryPolicy, {
            now: scheduledTime,
          });
          if (Date.now() < runDeadline) {
            aggregateAnalysis = await runStoredAnalysisForDates(env, options.discoveryPolicy, profileAnalysis.dates);
          }
        } catch (error) {
          profileAnalysis = { status: "failed", selected: 0, analyzed: 0, failed: 0, dates: [], results: [] };
          aggregateAnalysis = [];
          stageErrors.push({
            stage: "profile_analysis",
            code: error instanceof TypeError ? "ANALYSIS_CONFIGURATION_INCOMPLETE" : "ANALYSIS_RUNTIME_FAILED",
            message: String(error instanceof Error ? error.message : error).slice(0, 200),
          });
        }
      } else {
        profileAnalysis = { status: "run_deadline_exceeded", selected: 0, analyzed: 0, failed: 0, dates: [], results: [] };
      }
    } else {
      discovery = { status: "endpoint_review_required", records: [], sources: [] };
      bodyCollection = { status: "endpoint_review_required", selected: 0, stored: 0, failed: 0, results: [] };
      profileAnalysis = { status: "endpoint_review_required", selected: 0, analyzed: 0, failed: 0, dates: [], results: [] };
    }
  }
  let operations;
  try {
    operations = await runScheduledOperations(env, { scheduledTime });
  } catch {
    operations = { status: "failed", code: "OPERATIONS_FAILED" };
    stageErrors.push({ stage: "operations", code: "OPERATIONS_FAILED" });
  }
  for (const result of aggregateAnalysis) {
    if (result?.status === "failed" && result?.error) {
      stageErrors.push({
        stage: "aggregate_analysis",
        code: String(result.error).slice(0, 80),
        date: result.date,
      });
    }
  }
  return {
    status: stageErrors.length ? "completed_with_errors" : "completed",
    scheduledTime,
    lease: { acquired: true, owner: lease.owner, leaseExpiresAt: lease.leaseExpiresAt },
    operations,
    retention,
    discovery,
    discoveryPersistence,
    bodyCollection,
    profileAnalysis,
    aggregateAnalysis,
    stageErrors,
  };
}
