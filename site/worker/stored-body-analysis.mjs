import {
  ARTICLE_FRAME_PROFILE_SCHEMA,
  FRAMING_ENGINE_VERSION,
  analyzeArticleFraming,
  validateArticleFrameProfile,
} from "./framing-engine.mjs";

const PROFILE_PROVIDER = "structured_extractive";
const COLLECTION_PROVIDER = "authorized_crawl";
const PROMPT_VERSION = "framing-codebook-v6";
const EXTRACTOR_VERSION = "authorized-public-news-v1";
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

function requireBindings(env) {
  if (!env?.DB || typeof env.DB.prepare !== "function") throw new TypeError("A D1-compatible DB binding is required.");
  if (!env?.CONTENT || typeof env.CONTENT.get !== "function") throw new TypeError("An R2 CONTENT binding with get() is required.");
}

function normalizeLimit(value) {
  const limit = value === undefined ? DEFAULT_LIMIT : Number(value);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new TypeError(`limit must be an integer from 1 to ${MAX_LIMIT}.`);
  }
  return limit;
}

function kstDate(value) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(Number(value)));
  const fields = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${fields.year}-${fields.month}-${fields.day}`;
}

export async function analyzeStoredArticleBodies(env, policy, options = {}) {
  requireBindings(env);
  const now = Number(options.now ?? Date.now());
  if (!Number.isSafeInteger(now) || now < 0) throw new TypeError("now must be a non-negative integer timestamp.");
  if (policy.activationState !== "active") {
    return { status: "endpoint_review_required", selected: 0, analyzed: 0, failed: 0, dates: [], results: [] };
  }
  const limit = normalizeLimit(options.limit);
  const sourceIds = policy.sources.map((source) => source.id);
  const start = Date.parse(`${policy.collectionWindow.startDate}T00:00:00+09:00`);
  const end = Date.parse(`${policy.collectionWindow.endDate}T23:59:59.999+09:00`);
  const selected = await env.DB.prepare(`
    SELECT
      a.id AS articleId,
      a.title,
      a.published_at AS publishedAt,
      content.id AS contentId,
      content.object_key AS objectKey,
      content.body_hash AS bodyHash,
      content.body_characters AS bodyCharacters
    FROM article_contents AS content
    JOIN articles AS a ON a.id = content.article_id
    LEFT JOIN article_frame_profiles AS profile
      ON profile.article_id = a.id
      AND profile.body_hash = content.body_hash
      AND profile.model_version = ?
      AND profile.schema_version = ?
      AND profile.status IN ('analyzed', 'partial')
    WHERE a.source_id IN (${sourceIds.map(() => "?").join(", ")})
      AND a.published_at >= ?
      AND a.published_at <= ?
      AND content.status = 'active'
      AND content.analysis_allowed = 1
      AND (content.usage_expires_at IS NULL OR content.usage_expires_at > ?)
      AND profile.id IS NULL
    ORDER BY content.acquired_at ASC, content.id ASC
    LIMIT ?
  `).bind(
    FRAMING_ENGINE_VERSION,
    ARTICLE_FRAME_PROFILE_SCHEMA,
    ...sourceIds,
    start,
    end,
    now,
    limit,
  ).all();
  const rows = Array.isArray(selected?.results) ? selected.results : [];
  const results = [];
  for (const row of rows) {
    try {
      const object = await env.CONTENT.get(row.objectKey);
      if (!object) throw new Error("CONTENT_OBJECT_MISSING");
      const bodyText = await object.text();
      const profile = await analyzeArticleFraming({
        articleId: row.articleId,
        title: row.title,
        bodyText,
        publishedAt: row.publishedAt ? new Date(Number(row.publishedAt)).toISOString() : null,
      });
      profile.extraction = {
        strategy: "private-r2-authorized-body",
        extractor_version: EXTRACTOR_VERSION,
        text_scope: "article_body",
        input_truncated: false,
      };
      const validation = validateArticleFrameProfile(profile);
      if (!validation.valid) throw new Error("PROFILE_VALIDATION_FAILED");
      await env.DB.prepare(`
        INSERT INTO article_frame_profiles
          (id, article_id, body_hash, body_characters, profile_json, status, failure_code, extractor_version, provider, model_version, prompt_version, schema_version, review_status, analyzed_at)
        VALUES (?, ?, ?, ?, ?, 'analyzed', NULL, ?, ?, ?, ?, ?, 'automatic_draft', ?)
        ON CONFLICT(article_id, extractor_version, model_version, schema_version) DO UPDATE SET
          body_hash = excluded.body_hash,
          body_characters = excluded.body_characters,
          profile_json = excluded.profile_json,
          status = 'analyzed',
          failure_code = NULL,
          provider = excluded.provider,
          prompt_version = excluded.prompt_version,
          review_status = 'automatic_draft',
          analyzed_at = excluded.analyzed_at
      `).bind(
        crypto.randomUUID(),
        row.articleId,
        row.bodyHash,
        Number(row.bodyCharacters),
        JSON.stringify(profile),
        EXTRACTOR_VERSION,
        PROFILE_PROVIDER,
        FRAMING_ENGINE_VERSION,
        PROMPT_VERSION,
        ARTICLE_FRAME_PROFILE_SCHEMA,
        now,
      ).run();
      results.push({ articleId: row.articleId, status: "analyzed", date: kstDate(row.publishedAt) });
    } catch (error) {
      results.push({
        articleId: row.articleId,
        status: "failed",
        code: String(error instanceof Error ? error.message : "PROFILE_ANALYSIS_FAILED").slice(0, 80),
      });
    }
  }
  const analyzed = results.filter((result) => result.status === "analyzed").length;
  const failed = results.filter((result) => result.status === "failed").length;
  return {
    status: failed ? (analyzed ? "partial" : "failed") : "success",
    selected: rows.length,
    analyzed,
    failed,
    dates: [...new Set(results.map((result) => result.date).filter(Boolean))].sort(),
    results,
  };
}

function analysisPanel(policy) {
  return {
    panelVersion: policy.policyVersion,
    panelLabel: "AgendaFrame 12개 학술연구 수집 매체",
    collectionProvider: COLLECTION_PROVIDER,
    activationState: policy.activationState,
    directCrawling: true,
    excludedMediaTypes: [],
    sources: policy.sources.map((source, index) => ({
      ...source,
      active: true,
      samplePosition: "unclassified",
      sampleOrder: index + 1,
      mediaGroupId: `${source.id}_group`,
      mediaGroupLabel: source.name,
    })),
  };
}

export async function runStoredAnalysisForDates(env, policy, dates, options = {}) {
  if (!Array.isArray(dates) || !dates.length) return [];
  const analyzeImpl = options.analyzeImpl;
  if (typeof analyzeImpl !== "function") {
    return [...new Set(dates)].sort().map((date) => ({
      date,
      status: "failed",
      httpStatus: 0,
      runId: null,
      issueCount: 0,
      error: "ANALYSIS_IMPLEMENTATION_MISSING",
    }));
  }
  const results = [];
  for (const date of [...new Set(dates)].sort()) {
    try {
      const response = await analyzeImpl(null, env, {
        internalPayload: { date, scope: "academic_panel_12" },
        panelOverride: analysisPanel(policy),
        articleScope: {
          provider: COLLECTION_PROVIDER,
          sourceIds: policy.sources.map((source) => source.id),
        },
      });
      let payload = null;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
      results.push({
        date,
        status: response.ok ? "analyzed" : "failed",
        httpStatus: response.status,
        runId: response.ok ? payload?.runId ?? null : null,
        issueCount: response.ok ? Number(payload?.issueCount ?? 0) : 0,
        error: response.ok ? null : "ANALYSIS_REQUEST_FAILED",
      });
    } catch (error) {
      console.error("AgendaFrame stored aggregate analysis failed", {
        date,
        failureType: error instanceof Error ? error.name : "UnknownError",
        failureMessage: String(error instanceof Error ? error.message : error).slice(0, 200),
      });
      results.push({
        date,
        status: "failed",
        httpStatus: 0,
        runId: null,
        issueCount: 0,
        error: "ANALYSIS_RUNTIME_FAILED",
        failureType: error instanceof Error ? error.name : "UnknownError",
        failureMessage: String(error instanceof Error ? error.message : error).slice(0, 200),
      });
    }
  }
  return results;
}
