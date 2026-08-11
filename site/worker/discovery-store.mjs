const PROVIDER = "authorized_crawl";

function requireDatabase(db) {
  if (!db || typeof db.prepare !== "function" || typeof db.batch !== "function") {
    throw new TypeError("A D1-compatible DB binding is required.");
  }
  return db;
}

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value)));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function resultRows(result) {
  return Array.isArray(result?.results) ? result.results : [];
}

function chunks(values, size) {
  const output = [];
  for (let index = 0; index < values.length; index += size) output.push(values.slice(index, index + size));
  return output;
}

function kstDate(instant, label) {
  const timestamp = Date.parse(instant);
  if (!Number.isFinite(timestamp)) throw new TypeError(`${label} must be an ISO instant.`);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(timestamp));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function assertRecordInsideCollectionWindow(record, policy) {
  const effectivePublishedAt = record.publishedAt ?? record.discoveredAt;
  const publishedDate = kstDate(effectivePublishedAt, "record publishedAt/discoveredAt");
  if (publishedDate < policy.collectionWindow.startDate || publishedDate > policy.collectionWindow.endDate) {
    throw new TypeError(`Discovery record is outside the collection window: ${publishedDate}`);
  }
  kstDate(record.discoveredAt, "record.discoveredAt");
}

async function existingUrls(db, records) {
  const existing = new Set();
  for (const batch of chunks(records, 80)) {
    if (!batch.length) continue;
    const found = await db.prepare(`
      SELECT canonical_url AS canonicalUrl
      FROM articles
      WHERE canonical_url IN (${batch.map(() => "?").join(", ")})
    `).bind(...batch.map((record) => record.canonicalUrl)).all();
    for (const row of resultRows(found)) existing.add(row.canonicalUrl);
  }
  return existing;
}

export async function persistDiscoveryCycle(db, policy, cycle, options = {}) {
  requireDatabase(db);
  if (!cycle || !Array.isArray(cycle.records) || !Array.isArray(cycle.sources)) {
    throw new TypeError("A discovery-cycle result is required.");
  }
  const startedAt = Date.parse(cycle.discoveredAt);
  if (!Number.isFinite(startedAt)) throw new TypeError("cycle.discoveredAt must be an ISO instant.");
  const runId = String(options.runId ?? crypto.randomUUID());
  if (!runId || runId.length > 200) throw new TypeError("runId is invalid.");
  const knownSources = new Map(policy.sources.map((source, index) => [source.id, { ...source, sampleOrder: index + 1 }]));
  for (const record of cycle.records) {
    if (!knownSources.has(record.sourceId)) throw new TypeError(`Unknown discovery source: ${record.sourceId}`);
    assertRecordInsideCollectionWindow(record, policy);
  }
  const existing = await existingUrls(db, cycle.records);
  const sourceStatements = policy.sources.map((source, index) => db.prepare(`
    INSERT INTO media_sources
      (id, name, provider, provider_outlet_name, sample_position, sample_order, source_type, active, activation_state)
    VALUES (?, ?, ?, ?, 'unclassified', ?, ?, 1, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      sample_order = excluded.sample_order,
      source_type = excluded.source_type,
      active = 1,
      activation_state = excluded.activation_state
  `).bind(
    source.id,
    source.name,
    PROVIDER,
    source.name,
    index + 1,
    source.sourceType,
    policy.activationState,
  ));
  await db.batch(sourceStatements);

  const runStatus = cycle.status === "success" ? "success" : cycle.status === "partial" ? "partial" : "failed";
  await db.prepare(`
    INSERT INTO collection_runs
      (id, provider, trigger, status, started_at, finished_at, article_count, duplicate_count, error_count)
    VALUES (?, ?, 'scheduled', ?, ?, ?, ?, ?, ?)
  `).bind(
    runId,
    PROVIDER,
    runStatus,
    startedAt,
    startedAt,
    cycle.records.length - existing.size,
    existing.size,
    cycle.sources.filter((source) => ["partial", "stopped_access_restriction"].includes(source.status)).length,
  ).run();

  const articleStatements = [];
  for (const record of cycle.records) {
    const externalId = await sha256(record.canonicalUrl);
    const articleId = await sha256(`${PROVIDER}:${record.canonicalUrl}`);
    articleStatements.push(db.prepare(`
      INSERT INTO articles
        (id, provider, external_id, source_id, title, canonical_url, section, published_at, collected_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(canonical_url) DO UPDATE SET
        title = CASE WHEN length(excluded.title) > length(articles.title) THEN excluded.title ELSE articles.title END,
        section = COALESCE(excluded.section, articles.section),
        published_at = COALESCE(articles.published_at, excluded.published_at),
        collected_at = MIN(articles.collected_at, excluded.collected_at)
    `).bind(
      articleId,
      PROVIDER,
      externalId,
      record.sourceId,
      record.title,
      record.canonicalUrl,
      record.topic,
      Date.parse(record.publishedAt ?? record.discoveredAt),
      Date.parse(record.discoveredAt),
    ));
  }
  for (const batch of chunks(articleStatements, 80)) await db.batch(batch);

  const sourceStatementsResult = cycle.sources.map((source) => db.prepare(`
    INSERT INTO collection_source_results
      (id, run_id, source_id, status, article_count, duplicate_count, started_at, finished_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    crypto.randomUUID(),
    runId,
    source.sourceId,
    source.status === "success" ? "success" : source.status.startsWith("skipped") ? "skipped" : "failed",
    Number(source.discovered ?? 0),
    cycle.records.filter((record) => record.sourceId === source.sourceId && existing.has(record.canonicalUrl)).length,
    startedAt,
    startedAt,
  ));
  for (const batch of chunks(sourceStatementsResult, 80)) await db.batch(batch);

  return {
    runId,
    status: runStatus,
    received: cycle.records.length,
    inserted: cycle.records.length - existing.size,
    duplicates: existing.size,
  };
}
