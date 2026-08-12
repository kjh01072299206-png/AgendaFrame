function rows(result) {
  return Array.isArray(result?.results) ? result.results : [];
}

export async function readCollectionWorkflowStatus(env, policy, options = {}) {
  if (!env?.DB || typeof env.DB.batch !== "function" || typeof env.DB.prepare !== "function") {
    throw new TypeError("A D1-compatible DB binding is required.");
  }
  const now = Number(options.now ?? Date.now());
  if (!Number.isSafeInteger(now) || now < 0) throw new TypeError("now must be a non-negative integer timestamp.");
  const sourceIds = policy.sources.map((source) => source.id);
  const start = Date.parse(`${policy.collectionWindow.startDate}T00:00:00+09:00`);
  const end = Date.parse(`${policy.collectionWindow.endDate}T23:59:59.999+09:00`);
  const results = await env.DB.batch([
    env.DB.prepare(`
      SELECT id, status, started_at AS startedAt, finished_at AS finishedAt,
        article_count AS articleCount, duplicate_count AS duplicateCount, error_count AS errorCount
      FROM collection_runs
      WHERE provider = 'authorized_crawl'
      ORDER BY started_at DESC
      LIMIT 1
    `),
    env.DB.prepare(`
      SELECT COUNT(*) AS articleCount, COUNT(DISTINCT source_id) AS sourceCount,
        MAX(collected_at) AS latestCollectedAt
      FROM articles
      WHERE source_id IN (${sourceIds.map(() => "?").join(", ")})
        AND published_at >= ? AND published_at <= ?
    `).bind(...sourceIds, start, end),
    env.DB.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END), 0) AS activeCount,
        COALESCE(SUM(CASE WHEN status = 'expired' THEN 1 ELSE 0 END), 0) AS expiredCount,
        COALESCE(SUM(CASE WHEN status = 'revoked' THEN 1 ELSE 0 END), 0) AS revokedCount,
        MIN(CASE WHEN status = 'active' THEN usage_expires_at END) AS nextExpiryAt
      FROM article_contents
      WHERE article_id IN (
        SELECT id FROM articles
        WHERE source_id IN (${sourceIds.map(() => "?").join(", ")})
          AND published_at >= ? AND published_at <= ?
      )
    `).bind(...sourceIds, start, end),
    env.DB.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN status IN ('analyzed', 'partial') THEN 1 ELSE 0 END), 0) AS analyzedCount,
        COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) AS failedCount,
        MAX(analyzed_at) AS latestAnalyzedAt
      FROM article_frame_profiles
      WHERE article_id IN (
        SELECT id FROM articles
        WHERE source_id IN (${sourceIds.map(() => "?").join(", ")})
          AND published_at >= ? AND published_at <= ?
      )
    `).bind(...sourceIds, start, end),
    env.DB.prepare(`
      SELECT id, target_date AS targetDate, status, article_count AS articleCount,
        issue_count AS issueCount, finished_at AS finishedAt
      FROM analysis_runs
      WHERE target_date >= ? AND target_date <= ?
      ORDER BY started_at DESC
      LIMIT 1
    `).bind(policy.collectionWindow.startDate, policy.collectionWindow.endDate),
    env.DB.prepare(`
      SELECT source_id AS sourceId, COUNT(*) AS articleCount, MAX(collected_at) AS latestCollectedAt
      FROM articles
      WHERE source_id IN (${sourceIds.map(() => "?").join(", ")})
        AND published_at >= ? AND published_at <= ?
      GROUP BY source_id
      ORDER BY source_id
    `).bind(...sourceIds, start, end),
  ]);
  const latestRun = rows(results[0])[0] ?? null;
  const articles = rows(results[1])[0] ?? {};
  const contents = rows(results[2])[0] ?? {};
  const profiles = rows(results[3])[0] ?? {};
  const latestAnalysis = rows(results[4])[0] ?? null;
  const sourceCounts = new Map(rows(results[5]).map((row) => [row.sourceId, row]));
  return {
    activationState: policy.activationState,
    collectionWindow: policy.collectionWindow,
    scheduleConfigured: options.scheduleConfigured === true,
    now,
    latestRun,
    articles: {
      count: Number(articles.articleCount ?? 0),
      sourceCount: Number(articles.sourceCount ?? 0),
      latestCollectedAt: articles.latestCollectedAt ?? null,
    },
    contents: {
      active: Number(contents.activeCount ?? 0),
      expired: Number(contents.expiredCount ?? 0),
      revoked: Number(contents.revokedCount ?? 0),
      nextExpiryAt: contents.nextExpiryAt ?? null,
    },
    profiles: {
      analyzed: Number(profiles.analyzedCount ?? 0),
      failed: Number(profiles.failedCount ?? 0),
      latestAnalyzedAt: profiles.latestAnalyzedAt ?? null,
    },
    latestAnalysis,
    sources: policy.sources.map((source) => ({
      id: source.id,
      name: source.name,
      endpointReady: source.endpoints.some((endpoint) => endpoint.enabled),
      articleCount: Number(sourceCounts.get(source.id)?.articleCount ?? 0),
      latestCollectedAt: sourceCounts.get(source.id)?.latestCollectedAt ?? null,
    })),
  };
}
