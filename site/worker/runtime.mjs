import { getAnalysisProvider } from "./analysis-provider.mjs";
import { CLUSTERING_VERSION, FRAME_TAXONOMY_VERSION, SCORE_VERSION, extractBodyFrameSignals } from "./analysis.mjs";
import publicApiSchema from "../docs/public-api.schema.json" with { type: "json" };

const analysisProvider = getAnalysisProvider();
const ANALYSIS_PROVIDER = analysisProvider.provider;
const ANALYSIS_MODEL_VERSION = analysisProvider.modelVersion;
const PUBLIC_API_SCHEMA_VERSION = publicApiSchema["x-api-version"];
const PROMPT_VERSION = "not_applicable_rules";
const EVALUATION_DATASET_VERSION = "not_configured";
const COMPATIBLE_ANALYSIS_MODELS = new Set([ANALYSIS_MODEL_VERSION, "agenda-rules-v3", "agenda-rules-v2"]);

const assets = globalThis.__AGENDAFRAME_ASSETS__ ?? {};
let sourcePanel = globalThis.__AGENDAFRAME_SOURCE_PANEL__ ?? {
  collectionProvider: "bigkinds_export",
  activationState: "ready_for_admin_import",
  directCrawling: false,
  sources: [],
};

export function configureSourcePanel(panel) {
  if (panel?.sources?.length) sourcePanel = panel;
}

const securityHeaders = {
  "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
  "referrer-policy": "strict-origin-when-cross-origin",
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
};

export function withSecurityHeaders(response) {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(securityHeaders)) headers.set(name, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function scriptHash(source) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source));
  return `'sha256-${btoa(String.fromCharCode(...new Uint8Array(digest)))}'`;
}

export async function withDocumentSecurityHeaders(response) {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html") || !response.body) return withSecurityHeaders(response);

  const html = await response.text();
  const inlineScripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map((match) => match[1]);
  const hashes = [...new Set(await Promise.all(inlineScripts.map(scriptHash)))];
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(securityHeaders)) headers.set(name, value);
  headers.set("content-security-policy", securityHeaders["content-security-policy"].replace("script-src 'self'", `script-src 'self' ${hashes.join(" ")}`));
  headers.delete("content-length");
  return new Response(html, { status: response.status, statusText: response.statusText, headers });
}

function errorCode(status) {
  return ({ 400: "INVALID_REQUEST", 401: "UNAUTHORIZED", 403: "FORBIDDEN", 404: "NOT_FOUND", 405: "METHOD_NOT_ALLOWED", 409: "CONFLICT", 413: "PAYLOAD_TOO_LARGE", 429: "RATE_LIMITED", 500: "INTERNAL_ERROR", 503: "UNAVAILABLE" })[status] ?? "REQUEST_FAILED";
}

function weakEtag(value) {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `W/\"${(hash >>> 0).toString(16)}-${text.length}\"`;
}

function jsonResponse(value, status = 200, { request = null, cacheControl = "no-store", etag = false } = {}) {
  const requestId = request?.headers.get("cf-ray") ?? request?.headers.get("x-request-id") ?? crypto.randomUUID();
  const payload = typeof value?.error === "string"
    ? { ...value, error: { code: errorCode(status), message: value.error }, requestId }
    : value;
  const headers = new Headers({ ...securityHeaders, "cache-control": cacheControl, "content-type": "application/json; charset=utf-8", "x-request-id": requestId });
  if (etag && status === 200) {
    const tag = weakEtag(payload);
    headers.set("etag", tag);
    if (request?.headers.get("if-none-match") === tag) return new Response(null, { status: 304, headers });
  }
  return new Response(JSON.stringify(payload), { status, headers });
}

function kstDateFromNow(now) {
  return new Date(Number(now) + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function classifySnapshotStatus({ targetDate = null, dataAsOf = null, collectionStatus = "awaiting_import", latestSourceCount = 0, configuredSources = 0 } = {}, now = Date.now()) {
  if (!targetDate) return { status: "analysis_pending", label: "분석 보류", staleDays: null };
  if (collectionStatus === "partial" || (latestSourceCount > 0 && configuredSources > 0 && latestSourceCount < configuredSources)) {
    return { status: "partial_collection", label: "부분 수집", staleDays: null };
  }
  const today = kstDateFromNow(now);
  const target = Date.parse(`${targetDate}T00:00:00+09:00`);
  const current = Date.parse(`${today}T00:00:00+09:00`);
  const staleDays = Number.isFinite(target) ? Math.max(0, Math.round((current - target) / 86_400_000)) : null;
  if (staleDays > 0) return { status: "stale_snapshot", label: "오래된 스냅샷", staleDays };
  const collectedAt = dataAsOf ? Date.parse(dataAsOf) : NaN;
  if (!Number.isFinite(collectedAt) || Number(now) - collectedAt > 24 * 60 * 60 * 1000) {
    return { status: "collection_delayed", label: "수집 지연", staleDays: 0 };
  }
  return { status: "normal", label: "정상", staleDays: 0 };
}

function analysisVersions(run) {
  const current = !run?.modelVersion || COMPATIBLE_ANALYSIS_MODELS.has(run.modelVersion);
  return {
    sourcePolicyVersion: sourcePanel.panelVersion ?? "unknown",
    clusteringVersion: current ? CLUSTERING_VERSION : "legacy-v1-unverified",
    scoreVersion: current ? SCORE_VERSION : "legacy-v1-unverified",
    frameTaxonomyVersion: current ? FRAME_TAXONOMY_VERSION : "legacy-v1-unverified",
    modelId: run?.modelVersion ?? ANALYSIS_MODEL_VERSION,
    promptVersion: PROMPT_VERSION,
    evaluationDatasetVersion: EVALUATION_DATASET_VERSION,
  };
}

function responseMeta(run = null, runtimeMode = "demo") {
  return {
    schemaVersion: PUBLIC_API_SCHEMA_VERSION,
    runtimeMode,
    snapshotId: run?.id ?? null,
    runId: run?.id ?? null,
    basisDate: run?.targetDate ?? null,
    publishedAt: run?.finishedAt ?? null,
    ...analysisVersions(run),
  };
}

function publicIssue(row, run) {
  const placementObservedCount = Number(row.placementObservedCount ?? 0);
  const contentAvailableCount = Number(row.contentAvailableCount ?? 0);
  const legacy = !COMPATIBLE_ANALYSIS_MODELS.has(run?.modelVersion);
  const issue = { ...row };
  delete issue.confidence;
  return {
    ...issue,
    agendaScore: legacy ? null : Number(row.agendaScore),
    placementScore: placementObservedCount ? Number(row.placementScore) : null,
    placementObservedCount,
    placementTotalCount: Number(row.placementTotalCount ?? row.articleCount ?? 0),
    followUpVolumeScore: Number(row.repetitionScore ?? 0),
    scoreStatus: legacy ? "legacy_reanalysis_required" : (placementObservedCount ? "observed_components" : "placement_excluded"),
    calibrationStatus: "not_calibrated",
    clusterQuality: legacy ? "review_required" : "not_human_reviewed",
    contentAvailableCount,
    evidenceBasis: contentAvailableCount ? "body_signals_and_metadata" : "headline_metadata_only",
  };
}

function evidenceFirstComparison(issue, articles) {
  const contentAvailableCount = Number(issue.contentAvailableCount ?? articles.filter((article) => article.contentAvailable).length);
  return {
    status: "withheld_insufficient_evidence",
    evidenceBasis: contentAvailableCount ? "body_signals_not_structured_comparison" : "headline_metadata_only",
    reason: contentAvailableCount
      ? `본문 분석 ${contentAvailableCount}건에서 표현 단서를 확인했지만, 원인·책임·해법 비교는 구조화 분석과 사람 검토 전까지 보류합니다.`
      : "기사 본문과 독립 출처 관계를 확인할 수 없어 공통 사실·설명 차이·취재원·추천을 생성하지 않았습니다.",
    frameElements: ["problem_definition", "causal_attribution", "evaluation", "treatment_recommendation"].map((element) => ({ element, status: "not_assessed", evidence: [] })),
    commonFacts: [],
    divergenceQuestions: [],
    sourceVoices: [],
    recommendedPair: null,
    availableHeadlineEvidence: articles.map((article) => ({ articleId: article.id, source: article.source, sourceUrl: article.url, text: article.title, evidenceType: "headline" })),
    articleCount: Number(issue.articleCount ?? articles.length),
    sourceCount: Number(issue.sourceCount ?? new Set(articles.map((article) => article.source)).size),
  };
}

function matchesSourceDomain(hostname, domains) {
  return domains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
}

export function canonicalizeArticleUrl(value) {
  const url = new URL(String(value));
  if (url.protocol !== "https:") throw new Error("HTTPS 원문 URL만 허용됩니다.");
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (key.toLowerCase().startsWith("utm_") || ["fbclid", "gclid"].includes(key.toLowerCase())) {
      url.searchParams.delete(key);
    }
  }
  url.searchParams.sort();
  return url.toString();
}

function normalizePlacement(value) {
  if (!value) return null;
  const normalized = String(value).trim().toLowerCase();
  const placements = {
    top: "top",
    main: "main",
    section: "section",
    list: "list",
    최상단: "top",
    메인: "main",
    섹션: "section",
    목록: "list",
  };
  return placements[normalized] ?? null;
}

function parseTimestamp(value, label, fallback) {
  const candidate = value || fallback;
  const milliseconds = Date.parse(candidate);
  if (!Number.isFinite(milliseconds)) throw new Error(`${label}을(를) 확인해 주세요.`);
  return milliseconds;
}

export function validateImportRows(inputRows, panel = sourcePanel, now = new Date().toISOString()) {
  if (!Array.isArray(inputRows) || inputRows.length === 0) throw new Error("가져올 기사 행이 없습니다.");
  if (inputRows.length > 500) throw new Error("한 번에 최대 500행까지 가져올 수 있습니다.");

  const sourceByName = new Map();
  for (const source of panel.sources) {
    sourceByName.set(source.id, source);
    sourceByName.set(source.name, source);
  }

  return inputRows.map((input, index) => {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error(`${index + 1}행 형식이 올바르지 않습니다.`);
    if (["body", "content", "fullText", "본문", "원문"].some((key) => Object.hasOwn(input, key))) {
      throw new Error(`${index + 1}행: 기사 본문은 가져올 수 없습니다.`);
    }
    const source = sourceByName.get(String(input.source ?? "").trim());
    if (!source || !source.active) throw new Error(`${index + 1}행: 지원하지 않는 언론사입니다.`);

    const title = String(input.title ?? "").trim();
    if (!title || title.length > 500) throw new Error(`${index + 1}행: 제목은 1~500자여야 합니다.`);

    let canonicalUrl;
    try {
      canonicalUrl = canonicalizeArticleUrl(input.url);
    } catch {
      throw new Error(`${index + 1}행: 올바른 HTTPS 원문 URL이 아닙니다.`);
    }
    const hostname = new URL(canonicalUrl).hostname.toLowerCase();
    if (!matchesSourceDomain(hostname, source.domains ?? [])) {
      throw new Error(`${index + 1}행: ${source.name} 공식 도메인의 원문 URL이 아닙니다.`);
    }

    const placementInput = String(input.homepage_placement ?? "").trim();
    const homepagePlacement = normalizePlacement(placementInput);
    if (placementInput && !homepagePlacement) throw new Error(`${index + 1}행: 홈페이지 배치 값을 확인해 주세요.`);

    const rankInput = String(input.homepage_rank ?? "").trim();
    const homepageRank = rankInput ? Number(rankInput) : null;
    if (homepageRank !== null && (!Number.isInteger(homepageRank) || homepageRank < 1 || homepageRank > 1000)) {
      throw new Error(`${index + 1}행: 홈페이지 순위는 1~1000의 정수여야 합니다.`);
    }

    return {
      source,
      title,
      canonicalUrl,
      publishedAt: parseTimestamp(input.published_at, `${index + 1}행 게시 시각`),
      collectedAt: parseTimestamp(input.collected_at, `${index + 1}행 수집 시각`, now),
      section: String(input.section ?? "").trim().slice(0, 80) || null,
      homepagePlacement,
      homepageRank,
    };
  });
}

async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function secureTokenMatches(provided, expected) {
  if (!provided || !expected) return false;
  const [providedHash, expectedHash] = await Promise.all([sha256Hex(provided), sha256Hex(expected)]);
  let difference = providedHash.length ^ expectedHash.length;
  for (let index = 0; index < Math.max(providedHash.length, expectedHash.length); index += 1) {
    difference |= (providedHash.charCodeAt(index) || 0) ^ (expectedHash.charCodeAt(index) || 0);
  }
  return difference === 0;
}

const DEFAULT_TRUSTED_ORIGINS = new Set([
  "https://agendaframe.com",
  "https://www.agendaframe.com",
  "https://agendaframe-capstone.kjh01072299206.chatgpt.site",
]);

function isSameSiteRequest(request, env = {}) {
  const requestUrl = new URL(request.url);
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  const configuredOrigins = String(env.PUBLIC_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const trustedOrigins = new Set([requestUrl.origin, ...DEFAULT_TRUSTED_ORIGINS, ...configuredOrigins]);
  return (!origin || trustedOrigins.has(origin)) && (!fetchSite || ["same-origin", "same-site", "none"].includes(fetchSite));
}

async function ensureSources(db) {
  const statements = sourcePanel.sources.map((source) => db.prepare(`
    INSERT INTO media_sources
      (id, name, provider, provider_outlet_name, sample_position, sample_order, source_type, active, activation_state)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      provider = excluded.provider,
      provider_outlet_name = excluded.provider_outlet_name,
      sample_position = excluded.sample_position,
      sample_order = excluded.sample_order,
      source_type = excluded.source_type,
      active = excluded.active,
      activation_state = excluded.activation_state
  `).bind(
    source.id,
    source.name,
    sourcePanel.collectionProvider,
    source.providerOutletName,
    source.samplePosition,
    source.sampleOrder,
    source.sourceType,
    source.active ? 1 : 0,
    sourcePanel.activationState,
  ));
  if (statements.length) await db.batch(statements);
}

async function collectionHealth(db) {
  await ensureSources(db);
  const summary = await db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM media_sources WHERE active = 1) AS configured_sources,
      (SELECT COUNT(*) FROM articles) AS article_count,
      (SELECT COUNT(DISTINCT article_id) FROM article_contents
        WHERE status = 'active'
          AND analysis_allowed = 1
          AND (usage_expires_at IS NULL OR usage_expires_at > (unixepoch() * 1000))) AS authorized_content_count,
      (SELECT COUNT(DISTINCT article_id)
        FROM article_body_signals
        WHERE status = 'analyzed'
          AND extractor_version = ?
          AND taxonomy_version = ?) AS transient_evidence_count,
      (SELECT COUNT(DISTINCT article_id) FROM (
        SELECT ac.article_id AS article_id
        FROM article_contents ac
        WHERE ac.status = 'active'
          AND ac.analysis_allowed = 1
          AND (ac.usage_expires_at IS NULL OR ac.usage_expires_at > (unixepoch() * 1000))
        UNION
        SELECT article_id
        FROM article_body_signals
        WHERE status = 'analyzed'
          AND extractor_version = ?
          AND taxonomy_version = ?
      )) AS body_evidence_count
  `).bind(
    ARTICLE_EXTRACTOR_VERSION,
    FRAME_TAXONOMY_VERSION,
    ARTICLE_EXTRACTOR_VERSION,
    FRAME_TAXONOMY_VERSION,
  ).first();
  const latest = await db.prepare(`
    SELECT id, status, finished_at, article_count, duplicate_count
    FROM collection_runs
    WHERE status IN ('success', 'partial')
    ORDER BY finished_at DESC
    LIMIT 1
  `).first();
  let latestSourceCount = 0;
  if (latest?.id) {
    const sourceSummary = await db.prepare(`
      SELECT COUNT(*) AS source_count
      FROM collection_source_results
      WHERE run_id = ? AND status = 'success' AND (article_count + duplicate_count) > 0
    `).bind(latest.id).first();
    latestSourceCount = Number(sourceSummary?.source_count ?? 0);
  }
  const articleCount = Number(summary?.article_count ?? 0);
  return {
    status: "ok",
    mode: articleCount > 0 ? "metadata" : "demo",
    dataAsOf: latest?.finished_at ? new Date(Number(latest.finished_at)).toISOString() : null,
    collection: {
      method: sourcePanel.collectionProvider,
      directCrawling: false,
      configuredSources: Number(summary?.configured_sources ?? sourcePanel.sources.length),
      articleCount,
      authorizedContentCount: Number(summary?.authorized_content_count ?? 0),
      transientEvidenceCount: Number(summary?.transient_evidence_count ?? 0),
      bodyEvidenceCount: Number(summary?.body_evidence_count ?? 0),
      latestSourceCount,
      latestInserted: Number(latest?.article_count ?? 0),
      latestDuplicates: Number(latest?.duplicate_count ?? 0),
      latestStatus: latest?.status ?? "awaiting_import",
    },
  };
}

async function readJsonPayload(request, maximumBytes = 1024 * 1024) {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > maximumBytes) throw new Error(`요청 크기는 ${Math.round(maximumBytes / 1024)}KB 이하여야 합니다.`);
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maximumBytes) throw new Error(`요청 크기는 ${Math.round(maximumBytes / 1024)}KB 이하여야 합니다.`);
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error("JSON 형식을 확인해 주세요.");
  }
  return payload;
}

async function readImportPayload(request) {
  return readJsonPayload(request);
}

async function handleImport(request, env) {
  if (!env?.DB) return jsonResponse({ error: "데이터 저장소가 아직 준비되지 않았습니다." }, 503);
  if (!env?.IMPORT_TOKEN) return jsonResponse({ error: "관리자 가져오기가 아직 활성화되지 않았습니다." }, 503);

  if (!isSameSiteRequest(request, env)) {
    return jsonResponse({ error: "같은 사이트에서 보낸 요청만 허용됩니다." }, 403);
  }

  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!(await secureTokenMatches(token, env.IMPORT_TOKEN))) {
    return jsonResponse({ error: "관리자 토큰이 올바르지 않습니다." }, 401);
  }

  let rows;
  try {
    const payload = await readImportPayload(request);
    rows = validateImportRows(payload.rows);
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "가져오기 형식을 확인해 주세요." }, 400);
  }

  const db = env.DB;
  const startedAt = Date.now();
  const runId = crypto.randomUUID();
  try {
    await ensureSources(db);
    await db.prepare(`
      INSERT INTO collection_runs
        (id, provider, trigger, status, started_at, article_count, duplicate_count, error_count)
      VALUES (?, 'bigkinds_export', 'manual', 'running', ?, 0, 0, 0)
    `).bind(runId, startedAt).run();

    const articleIds = await Promise.all(rows.map((row) => sha256Hex(row.canonicalUrl)));
    const statements = rows.map((row, index) => db.prepare(`
      INSERT INTO articles
        (id, provider, external_id, source_id, title, canonical_url, section, published_at, collected_at, homepage_placement, homepage_rank)
      VALUES (?, 'bigkinds_export', ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(canonical_url) DO UPDATE SET
        provider = excluded.provider,
        external_id = excluded.external_id,
        source_id = excluded.source_id,
        title = excluded.title,
        section = COALESCE(excluded.section, articles.section),
        published_at = excluded.published_at,
        homepage_placement = COALESCE(excluded.homepage_placement, articles.homepage_placement),
        homepage_rank = COALESCE(excluded.homepage_rank, articles.homepage_rank)
      WHERE
        articles.provider != excluded.provider OR
        articles.external_id != excluded.external_id OR
        articles.source_id != excluded.source_id OR
        articles.title != excluded.title OR
        (excluded.section IS NOT NULL AND COALESCE(articles.section, '') != excluded.section) OR
        COALESCE(articles.published_at, 0) != COALESCE(excluded.published_at, 0) OR
        (excluded.homepage_placement IS NOT NULL AND COALESCE(articles.homepage_placement, '') != excluded.homepage_placement) OR
        (excluded.homepage_rank IS NOT NULL AND COALESCE(articles.homepage_rank, 0) != excluded.homepage_rank)
    `).bind(
      crypto.randomUUID(),
      articleIds[index],
      row.source.id,
      row.title,
      row.canonicalUrl,
      row.section,
      row.publishedAt,
      row.collectedAt,
      row.homepagePlacement,
      row.homepageRank,
    ));
    const articleResults = await db.batch(statements);
    const observationLinkStatements = rows.map((row) => db.prepare(`
      UPDATE placement_observations
      SET
        article_id = (SELECT id FROM articles WHERE canonical_url = ?),
        match_method = 'canonical_url',
        match_confidence = 1
      WHERE canonical_url = ? AND article_id IS NULL
    `).bind(row.canonicalUrl, row.canonicalUrl));
    await runBatches(db, observationLinkStatements);
    const counts = new Map(sourcePanel.sources.map((source) => [source.id, { received: 0, inserted: 0 }]));
    rows.forEach((row, index) => {
      const sourceCount = counts.get(row.source.id);
      sourceCount.received += 1;
      sourceCount.inserted += Number(articleResults[index]?.meta?.changes ?? 0) > 0 ? 1 : 0;
    });
    const saved = [...counts.values()].reduce((total, value) => total + value.inserted, 0);
    const duplicates = rows.length - saved;
    const finishedAt = Date.now();

    const resultStatements = sourcePanel.sources.map((source) => {
      const value = counts.get(source.id);
      return db.prepare(`
        INSERT INTO collection_source_results
          (id, run_id, source_id, status, article_count, duplicate_count, started_at, finished_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        crypto.randomUUID(),
        runId,
        source.id,
        value.received > 0 ? "success" : "skipped",
        value.inserted,
        value.received - value.inserted,
        startedAt,
        finishedAt,
      );
    });
    resultStatements.push(db.prepare(`
      UPDATE collection_runs
      SET status = 'success', finished_at = ?, article_count = ?, duplicate_count = ?, error_count = 0
      WHERE id = ?
    `).bind(finishedAt, saved, duplicates, runId));
    await db.batch(resultStatements);

    return jsonResponse({
      runId,
      received: rows.length,
      saved,
      inserted: saved,
      duplicates,
      sources: sourcePanel.sources.map((source) => ({
        id: source.id,
        name: source.name,
        received: counts.get(source.id).received,
        saved: counts.get(source.id).inserted,
        inserted: counts.get(source.id).inserted,
      })),
    }, 201);
  } catch (error) {
    console.error("AgendaFrame import failed", error);
    try {
      const occurredAt = Date.now();
      await db.batch([
        db.prepare(`
          UPDATE collection_runs
          SET status = 'failed', finished_at = ?, error_count = 1
          WHERE id = ?
        `).bind(occurredAt, runId),
        db.prepare(`
          INSERT INTO collection_errors (id, run_id, source_id, code, message, occurred_at)
          VALUES (?, ?, NULL, 'IMPORT_FAILED', 'Manual CSV import failed', ?)
        `).bind(crypto.randomUUID(), runId, occurredAt),
      ]);
    } catch (recordError) {
      console.error("AgendaFrame import error could not be recorded", recordError);
    }
    return jsonResponse({ error: "데이터를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요." }, 500);
  }
}

const PLACEMENT_ZONES = new Set(["top", "main", "section", "list"]);
const CONTENT_ACQUISITION_METHODS = new Set(["licensed_export", "publisher_api", "authorized_crawl", "manual_research"]);
const ARTICLE_FETCH_BATCH_LIMIT = 20;
const ARTICLE_FETCH_CONCURRENCY = 2;
const ARTICLE_HTML_MAX_BYTES = 2 * 1024 * 1024;
const ARTICLE_REDIRECT_LIMIT = 3;
const ARTICLE_EXTRACTOR_VERSION = "authorized-jsonld-v1";

function integerInRange(value, minimum, maximum, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) throw new Error(`${label} 값을 확인해 주세요.`);
  return number;
}

async function handleHomepageObservation(request, env) {
  if (!env?.DB) return jsonResponse({ error: "데이터 저장소가 아직 준비되지 않았습니다." }, 503);
  if (!(await adminAuthorized(request, env))) return jsonResponse({ error: "관리자 토큰이 올바르지 않습니다." }, 401);
  if (!isSameSiteRequest(request, env)) return jsonResponse({ error: "허용된 AgendaFrame 주소에서 보낸 요청만 처리합니다." }, 403);

  let payload;
  try {
    payload = await readJsonPayload(request);
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "관측 데이터 형식을 확인해 주세요." }, 400);
  }

  try {
    await ensureSources(env.DB);
    const source = sourcePanel.sources.find((entry) => [entry.id, entry.name].includes(String(payload.source ?? "").trim()));
    if (!source?.active) throw new Error("지원하지 않는 언론사입니다.");

    const homepageUrl = canonicalizeArticleUrl(payload.homepage_url);
    if (!matchesSourceDomain(new URL(homepageUrl).hostname.toLowerCase(), source.domains ?? [])) {
      throw new Error(`${source.name} 공식 도메인의 홈페이지 URL이 아닙니다.`);
    }
    const observedAt = parseTimestamp(payload.observed_at, "관측 시각");
    const viewportWidth = integerInRange(payload.viewport?.width, 320, 3840, "화면 너비");
    const viewportHeight = integerInRange(payload.viewport?.height, 480, 8000, "화면 높이");
    const collectorVersion = String(payload.collector_version ?? "").trim();
    if (!collectorVersion || collectorVersion.length > 80) throw new Error("수집기 버전을 확인해 주세요.");
    const captureHash = String(payload.capture_hash ?? "").trim().toLowerCase() || null;
    if (captureHash && !/^[a-f0-9]{64}$/.test(captureHash)) throw new Error("화면 해시는 SHA-256 형식이어야 합니다.");
    const status = ["success", "partial", "failed"].includes(payload.status) ? payload.status : "success";
    if (!Array.isArray(payload.placements) || payload.placements.length === 0 || payload.placements.length > 500) {
      throw new Error("배치 관측은 1~500건이어야 합니다.");
    }

    const placements = payload.placements.map((input, index) => {
      const canonicalUrl = canonicalizeArticleUrl(input.url);
      if (!matchesSourceDomain(new URL(canonicalUrl).hostname.toLowerCase(), source.domains ?? [])) {
        throw new Error(`${index + 1}번 배치: ${source.name} 공식 도메인의 기사 URL이 아닙니다.`);
      }
      const observedTitle = String(input.title ?? "").trim();
      if (!observedTitle || observedTitle.length > 500) throw new Error(`${index + 1}번 배치: 제목을 확인해 주세요.`);
      const zone = normalizePlacement(input.zone);
      if (!zone || !PLACEMENT_ZONES.has(zone)) throw new Error(`${index + 1}번 배치: 영역을 확인해 주세요.`);
      const x = integerInRange(input.x, 0, 10000, `${index + 1}번 배치 x 좌표`);
      const y = integerInRange(input.y, 0, 100000, `${index + 1}번 배치 y 좌표`);
      const width = integerInRange(input.width, 1, 10000, `${index + 1}번 배치 너비`);
      const height = integerInRange(input.height, 1, 10000, `${index + 1}번 배치 높이`);
      return {
        canonicalUrl,
        observedTitle,
        zone,
        pageRank: integerInRange(input.rank, 1, 1000, `${index + 1}번 배치 순위`),
        x,
        y,
        width,
        height,
        aboveFold: input.above_fold === true || y < viewportHeight,
        moduleName: String(input.module_name ?? "").trim().slice(0, 120) || null,
      };
    });

    const snapshotId = await sha256Hex(`${source.id}:${observedAt}:${viewportWidth}x${viewportHeight}`);
    await env.DB.prepare(`
      INSERT INTO homepage_snapshots
        (id, source_id, homepage_url, observed_at, viewport_width, viewport_height, collector_version, capture_hash, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source_id, observed_at, viewport_width, viewport_height) DO UPDATE SET
        homepage_url = excluded.homepage_url,
        collector_version = excluded.collector_version,
        capture_hash = COALESCE(excluded.capture_hash, homepage_snapshots.capture_hash),
        status = excluded.status
    `).bind(snapshotId, source.id, homepageUrl, observedAt, viewportWidth, viewportHeight, collectorVersion, captureHash, status).run();

    const observationStatements = placements.map((placement) => env.DB.prepare(`
      INSERT INTO placement_observations
        (id, snapshot_id, article_id, canonical_url, observed_title, zone, page_rank, x, y, width, height, above_fold, module_name, match_method, match_confidence)
      VALUES (
        ?, ?, (SELECT id FROM articles WHERE canonical_url = ?), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        CASE WHEN EXISTS(SELECT 1 FROM articles WHERE canonical_url = ?) THEN 'canonical_url' ELSE 'unmatched' END,
        CASE WHEN EXISTS(SELECT 1 FROM articles WHERE canonical_url = ?) THEN 1 ELSE 0 END
      )
      ON CONFLICT(snapshot_id, canonical_url, x, y) DO UPDATE SET
        article_id = excluded.article_id,
        observed_title = excluded.observed_title,
        zone = excluded.zone,
        page_rank = excluded.page_rank,
        width = excluded.width,
        height = excluded.height,
        above_fold = excluded.above_fold,
        module_name = excluded.module_name,
        match_method = excluded.match_method,
        match_confidence = excluded.match_confidence
    `).bind(
      crypto.randomUUID(),
      snapshotId,
      placement.canonicalUrl,
      placement.canonicalUrl,
      placement.observedTitle,
      placement.zone,
      placement.pageRank,
      placement.x,
      placement.y,
      placement.width,
      placement.height,
      placement.aboveFold ? 1 : 0,
      placement.moduleName,
      placement.canonicalUrl,
      placement.canonicalUrl,
    ));
    await runBatches(env.DB, observationStatements);

    const uniqueUrls = [...new Set(placements.map((placement) => placement.canonicalUrl))];
    const updateStatements = uniqueUrls.map((canonicalUrl) => env.DB.prepare(`
      UPDATE articles
      SET
        homepage_placement = (
          SELECT po.zone
          FROM placement_observations po
          JOIN homepage_snapshots hs ON hs.id = po.snapshot_id
          WHERE po.article_id = articles.id
          ORDER BY hs.observed_at DESC,
            CASE po.zone WHEN 'top' THEN 4 WHEN 'main' THEN 3 WHEN 'section' THEN 2 ELSE 1 END DESC,
            po.page_rank ASC
          LIMIT 1
        ),
        homepage_rank = (
          SELECT po.page_rank
          FROM placement_observations po
          JOIN homepage_snapshots hs ON hs.id = po.snapshot_id
          WHERE po.article_id = articles.id
          ORDER BY hs.observed_at DESC,
            CASE po.zone WHEN 'top' THEN 4 WHEN 'main' THEN 3 WHEN 'section' THEN 2 ELSE 1 END DESC,
            po.page_rank ASC
          LIMIT 1
        )
      WHERE canonical_url = ?
    `).bind(canonicalUrl));
    await runBatches(env.DB, updateStatements);

    const matched = await env.DB.prepare(`
      SELECT COUNT(*) AS count
      FROM placement_observations
      WHERE snapshot_id = ? AND article_id IS NOT NULL
    `).bind(snapshotId).first();
    return jsonResponse({
      snapshotId,
      source: source.name,
      observedAt: new Date(observedAt).toISOString(),
      observed: placements.length,
      matched: Number(matched?.count ?? 0),
      unmatched: placements.length - Number(matched?.count ?? 0),
    }, 201);
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "홈페이지 관측을 저장하지 못했습니다." }, 400);
  }
}

function normalizeArticleBody(value) {
  return String(value ?? "")
    .normalize("NFC")
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function decodeHtmlEntities(value) {
  const named = { amp: "&", apos: "'", gt: ">", lt: "<", nbsp: " ", quot: '"' };
  return String(value ?? "").replace(/&(#x[0-9a-f]+|#\d+|amp|apos|gt|lt|nbsp|quot);/gi, (match, entity) => {
    const normalized = entity.toLowerCase();
    if (normalized.startsWith("#x")) {
      const codePoint = Number.parseInt(normalized.slice(2), 16);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }
    if (normalized.startsWith("#")) {
      const codePoint = Number.parseInt(normalized.slice(1), 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }
    return named[normalized] ?? match;
  });
}

function htmlFragmentToText(value) {
  const withoutNonArticleContent = String(value ?? "")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|template|svg|form|nav|aside|footer|header)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(br|hr)\b[^>]*\/?\s*>/gi, "\n")
    .replace(/<\/(p|div|li|section|blockquote|h[1-6])\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return normalizeArticleBody(decodeHtmlEntities(withoutNonArticleContent).replace(/[ \t]{2,}/g, " "));
}

function articleBodyCandidates(value, candidates, accessibility) {
  if (Array.isArray(value)) {
    for (const item of value) articleBodyCandidates(item, candidates, accessibility);
    return;
  }
  if (!value || typeof value !== "object") return;
  const accessible = value.isAccessibleForFree;
  if (accessible === false || String(accessible).toLowerCase() === "false") accessibility.blocked = true;
  if (typeof value.articleBody === "string") candidates.push(normalizeArticleBody(decodeHtmlEntities(value.articleBody)));
  if (Array.isArray(value["@graph"])) articleBodyCandidates(value["@graph"], candidates, accessibility);
  for (const [key, child] of Object.entries(value)) {
    if (key !== "@graph" && child && typeof child === "object") articleBodyCandidates(child, candidates, accessibility);
  }
}

export function extractArticleBodyFromHtml(html) {
  const source = String(html ?? "");
  const candidates = [];
  const accessibility = { blocked: false };
  for (const match of source.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    const jsonText = match[1].replace(/^\s*<!--|-->\s*$/g, "").trim();
    if (!jsonText) continue;
    try {
      articleBodyCandidates(JSON.parse(jsonText), candidates, accessibility);
    } catch {
      // Invalid publisher JSON-LD is ignored; the narrow HTML fallback remains available.
    }
  }
  if (accessibility.blocked) throw new Error("유료 또는 구독 전용으로 표시된 기사입니다.");

  for (const match of source.matchAll(/<article\b[^>]*>([\s\S]*?)<\/article>/gi)) {
    candidates.push(htmlFragmentToText(match[1]));
  }
  const bodyContainerPattern = /<([a-z0-9]+)\b[^>]*(?:id|class)=["'][^"']*(?:article[-_ ]?body|article[-_ ]?content|news[-_ ]?(?:body|content)|view[-_ ]?content)[^"']*["'][^>]*>([\s\S]*?)<\/\1>/gi;
  for (const match of source.matchAll(bodyContainerPattern)) candidates.push(htmlFragmentToText(match[2]));

  const body = candidates
    .filter((candidate) => candidate.length >= 300 && candidate.length <= 200_000)
    .sort((left, right) => right.length - left.length)[0];
  if (!body) throw new Error("페이지에서 300자 이상의 기사 본문을 확인하지 못했습니다.");
  return body;
}

function sourceForArticle(article) {
  return sourcePanel.sources.find((source) => source.id === article.sourceId || source.name === article.source);
}

function validateArticleFetchUrl(value, source) {
  const canonicalUrl = canonicalizeArticleUrl(value);
  const hostname = new URL(canonicalUrl).hostname.toLowerCase();
  if (!source?.active || !matchesSourceDomain(hostname, source.domains ?? [])) {
    throw new Error("등록된 언론사 공식 도메인의 HTTPS 기사만 가져올 수 있습니다.");
  }
  return canonicalUrl;
}

async function fetchArticleHtml(initialUrl, source, env) {
  const fetcher = env?.ARTICLE_FETCHER?.fetch
    ? env.ARTICLE_FETCHER.fetch.bind(env.ARTICLE_FETCHER)
    : fetch;
  let currentUrl = validateArticleFetchUrl(initialUrl, source);
  for (let redirectCount = 0; redirectCount <= ARTICLE_REDIRECT_LIMIT; redirectCount += 1) {
    const response = await fetcher(currentUrl, {
      method: "GET",
      redirect: "manual",
      headers: {
        accept: "text/html,application/xhtml+xml;q=0.9",
        "user-agent": "AgendaFrame-Research/1.0 (+https://agendaframe.com)",
      },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location || redirectCount === ARTICLE_REDIRECT_LIMIT) throw new Error("기사 주소의 리디렉션을 확인하지 못했습니다.");
      currentUrl = validateArticleFetchUrl(new URL(location, currentUrl).toString(), source);
      continue;
    }
    if (!response.ok) throw new Error(`기사 페이지가 HTTP ${response.status}로 응답했습니다.`);
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("text/html") && !contentType.toLowerCase().includes("application/xhtml+xml")) {
      throw new Error("HTML 기사 페이지가 아닙니다.");
    }
    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > ARTICLE_HTML_MAX_BYTES) throw new Error("기사 페이지가 허용 크기를 초과했습니다.");
    const html = await response.text();
    if (new TextEncoder().encode(html).byteLength > ARTICLE_HTML_MAX_BYTES) throw new Error("기사 페이지가 허용 크기를 초과했습니다.");
    return { html, finalUrl: currentUrl };
  }
  throw new Error("기사 주소의 리디렉션을 확인하지 못했습니다.");
}

async function storeAuthorizedArticleContent(env, article, body, options) {
  const normalizedBody = normalizeArticleBody(body);
  if (normalizedBody.length < 300 || normalizedBody.length > 200_000) throw new Error("본문은 300~200,000자 범위의 승인된 전문이어야 합니다.");
  const bodyHash = await sha256Hex(normalizedBody);
  const existing = await env.DB.prepare(`
    SELECT id, object_key AS objectKey
    FROM article_contents
    WHERE article_id = ? AND body_hash = ?
  `).bind(article.id, bodyHash).first();
  const contentId = existing?.id ?? crypto.randomUUID();
  const objectKey = existing?.objectKey ?? `article-content/${article.id}/${bodyHash}.txt`;

  await env.CONTENT.put(objectKey, normalizedBody, {
    httpMetadata: { contentType: "text/plain; charset=utf-8" },
    customMetadata: { articleId: article.id, acquisitionMethod: options.acquisitionMethod },
  });
  await env.DB.prepare(`
    INSERT INTO article_contents
      (id, article_id, object_key, body_hash, body_characters, acquired_at, acquisition_method, usage_basis, usage_expires_at, analysis_allowed, public_evidence_allowed, extractor_version, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 'active')
    ON CONFLICT(article_id, body_hash) DO UPDATE SET
      acquired_at = excluded.acquired_at,
      acquisition_method = excluded.acquisition_method,
      usage_basis = excluded.usage_basis,
      usage_expires_at = excluded.usage_expires_at,
      analysis_allowed = 1,
      public_evidence_allowed = excluded.public_evidence_allowed,
      extractor_version = excluded.extractor_version,
      status = 'active'
  `).bind(
    contentId,
    article.id,
    objectKey,
    bodyHash,
    normalizedBody.length,
    options.acquiredAt,
    options.acquisitionMethod,
    options.usageBasis,
    options.usageExpiresAt,
    options.publicEvidenceAllowed ? 1 : 0,
    options.extractorVersion,
  ).run();
  return { contentId, bodyCharacters: normalizedBody.length, existing: Boolean(existing) };
}

async function handleContentUpload(request, env) {
  if (!env?.DB || !env?.CONTENT) return jsonResponse({ error: "비공개 본문 저장소가 아직 준비되지 않았습니다." }, 503);
  if (!(await adminAuthorized(request, env))) return jsonResponse({ error: "관리자 토큰이 올바르지 않습니다." }, 401);
  if (!isSameSiteRequest(request, env)) return jsonResponse({ error: "허용된 AgendaFrame 주소에서 보낸 요청만 처리합니다." }, 403);

  let payload;
  try {
    payload = await readJsonPayload(request, 768 * 1024);
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "본문 등록 형식을 확인해 주세요." }, 400);
  }

  try {
    if (payload.rights_attested !== true) throw new Error("본문 분석 권한을 확인해야 합니다.");
    const canonicalUrl = canonicalizeArticleUrl(payload.url);
    const article = await env.DB.prepare(`
      SELECT a.id, a.title, s.name AS source
      FROM articles a
      JOIN media_sources s ON s.id = a.source_id
      WHERE a.canonical_url = ?
    `).bind(canonicalUrl).first();
    if (!article) throw new Error("먼저 동일한 원문 URL의 기사 메타데이터를 가져오세요.");

    const acquisitionMethod = String(payload.acquisition_method ?? "").trim();
    if (!CONTENT_ACQUISITION_METHODS.has(acquisitionMethod)) throw new Error("본문 확보 방식을 확인해 주세요.");
    const usageBasis = String(payload.usage_basis ?? "").trim();
    if (usageBasis.length < 10 || usageBasis.length > 500) throw new Error("이용 근거를 10~500자로 기록하세요.");
    if (payload.analysis_allowed !== true) throw new Error("분석 허용 여부를 확인해야 합니다.");

    const body = normalizeArticleBody(payload.body);
    if (body.length < 300 || body.length > 200_000) throw new Error("본문은 300~200,000자 범위의 승인된 전문이어야 합니다.");
    const acquiredAt = parseTimestamp(payload.acquired_at, "본문 확보 시각", new Date().toISOString());
    const usageExpiresAt = payload.usage_expires_at ? parseTimestamp(payload.usage_expires_at, "이용 만료 시각") : null;
    if (usageExpiresAt !== null && usageExpiresAt <= acquiredAt) throw new Error("이용 만료 시각은 확보 시각 이후여야 합니다.");
    const extractorVersion = String(payload.extractor_version ?? "manual-upload-v1").trim().slice(0, 80) || "manual-upload-v1";
    const publicEvidenceAllowed = payload.public_evidence_allowed === true;
    const stored = await storeAuthorizedArticleContent(env, article, body, {
      acquiredAt,
      acquisitionMethod,
      usageBasis,
      usageExpiresAt,
      publicEvidenceAllowed,
      extractorVersion,
    });

    return jsonResponse({
      contentId: stored.contentId,
      articleId: article.id,
      source: article.source,
      title: article.title,
      bodyCharacters: stored.bodyCharacters,
      analysisAllowed: true,
      publicEvidenceAllowed,
      status: "active",
    }, stored.existing ? 200 : 201);
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "본문을 등록하지 못했습니다." }, 400);
  }
}

function transientFailureCode(error) {
  const message = String(error instanceof Error ? error.message : error ?? "");
  if (/유료|구독|로그인|접근 제한|차단/.test(message)) return "ACCESS_RESTRICTED";
  if (/리디렉션|도메인/.test(message)) return "REDIRECT_REJECTED";
  if (/본문|articleBody|추출/.test(message)) return "BODY_UNAVAILABLE";
  return "FETCH_FAILED";
}

function parseDetectedFrames(value) {
  try {
    const parsed = JSON.parse(String(value ?? "[]"));
    return Array.isArray(parsed)
      ? [...new Set(parsed.filter((frame) => typeof frame === "string" && frame.length <= 40))]
      : [];
  } catch {
    return [];
  }
}

async function loadTransientBodySignals(db, start, end) {
  const result = await db.prepare(`
    SELECT signals.article_id AS articleId, signals.detected_frames AS detectedFrames
    FROM article_body_signals signals
    JOIN articles a ON a.id = signals.article_id
    WHERE a.published_at >= ? AND a.published_at < ?
      AND signals.status = 'analyzed'
      AND signals.extractor_version = ?
      AND signals.taxonomy_version = ?
  `).bind(start, end, ARTICLE_EXTRACTOR_VERSION, FRAME_TAXONOMY_VERSION).all();
  return new Map((result.results ?? []).map((row) => [row.articleId, {
    bodyAnalysisAvailable: true,
    bodyFrameSignals: parseDetectedFrames(row.detectedFrames),
    contentVersionId: null,
    publicEvidenceAllowed: false,
    transientContent: true,
  }]));
}

async function transientAnalysisProgress(db, start, end) {
  const row = await db.prepare(`
    SELECT
      COUNT(*) AS total,
      COALESCE(SUM(CASE WHEN signals.status = 'analyzed' THEN 1 ELSE 0 END), 0) AS analyzed,
      COALESCE(SUM(CASE WHEN signals.status = 'failed' THEN 1 ELSE 0 END), 0) AS failed
    FROM articles a
    LEFT JOIN article_body_signals signals
      ON signals.article_id = a.id
      AND signals.extractor_version = ?
      AND signals.taxonomy_version = ?
    WHERE a.published_at >= ? AND a.published_at < ?
  `).bind(ARTICLE_EXTRACTOR_VERSION, FRAME_TAXONOMY_VERSION, start, end).first();
  const total = Number(row?.total ?? 0);
  const analyzed = Number(row?.analyzed ?? 0);
  const failed = Number(row?.failed ?? 0);
  return {
    total,
    processed: analyzed + failed,
    analyzed,
    failed,
    remaining: Math.max(0, total - analyzed - failed),
  };
}

async function handleTransientAnalysisStatus(request, env) {
  if (!env?.DB) return jsonResponse({ error: "데이터 저장소가 아직 준비되지 않았습니다." }, 503, { request });
  if (!(await adminAuthorized(request, env))) return jsonResponse({ error: "관리자 토큰이 올바르지 않습니다." }, 401, { request });
  if (!isSameSiteRequest(request, env)) return jsonResponse({ error: "허용된 AgendaFrame 주소에서 보낸 요청만 처리합니다." }, 403, { request });
  try {
    const targetDate = await resolveAnalysisDate(env.DB, String(new URL(request.url).searchParams.get("date") ?? "").trim());
    const start = Date.parse(`${targetDate}T00:00:00+09:00`);
    const end = start + 86_400_000;
    const progress = await transientAnalysisProgress(env.DB, start, end);
    return jsonResponse({
      date: targetDate,
      extractorVersion: ARTICLE_EXTRACTOR_VERSION,
      taxonomyVersion: FRAME_TAXONOMY_VERSION,
      bodyStorageCount: 0,
      complete: progress.remaining === 0,
      progress,
    }, 200, { request });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "본문 분석 상태를 확인하지 못했습니다." }, 400, { request });
  }
}

async function handleTransientAnalyze(request, env) {
  if (!env?.DB) return jsonResponse({ error: "데이터 저장소가 아직 준비되지 않았습니다." }, 503, { request });
  if (!(await adminAuthorized(request, env))) return jsonResponse({ error: "관리자 토큰이 올바르지 않습니다." }, 401, { request });
  if (!isSameSiteRequest(request, env)) return jsonResponse({ error: "허용된 AgendaFrame 주소에서 보낸 요청만 처리합니다." }, 403, { request });

  let payload;
  try {
    payload = await readJsonPayload(request);
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "본문 수집 형식을 확인해 주세요." }, 400, { request });
  }

  try {
    if (payload.transient_analysis_acknowledged !== true) throw new Error("공개 기사만 임시 분석하고 접근 제한을 우회하지 않는 조건을 확인해야 합니다.");
    const targetDate = await resolveAnalysisDate(env.DB, String(payload.date ?? "").trim());
    const limit = integerInRange(payload.limit ?? ARTICLE_FETCH_BATCH_LIMIT, 1, ARTICLE_FETCH_BATCH_LIMIT, "배치당 임시 분석 건수");
    const retryFailed = payload.retry_failed === true;
    const start = Date.parse(`${targetDate}T00:00:00+09:00`);
    const end = start + 86_400_000;
    const selected = await env.DB.prepare(`
      SELECT
        a.id,
        a.title,
        a.canonical_url AS canonicalUrl,
        a.source_id AS sourceId,
        s.name AS source
      FROM articles a
      JOIN media_sources s ON s.id = a.source_id
      LEFT JOIN article_body_signals signals
        ON signals.article_id = a.id
        AND signals.extractor_version = ?
        AND signals.taxonomy_version = ?
      WHERE a.published_at >= ? AND a.published_at < ?
        AND (signals.article_id IS NULL OR (? = 1 AND signals.status = 'failed'))
      ORDER BY
        CASE a.homepage_placement WHEN 'top' THEN 4 WHEN 'main' THEN 3 WHEN 'section' THEN 2 ELSE 1 END DESC,
        a.homepage_rank ASC,
        a.published_at DESC
      LIMIT ?
    `).bind(ARTICLE_EXTRACTOR_VERSION, FRAME_TAXONOMY_VERSION, start, end, retryFailed ? 1 : 0, limit).all();
    const articles = selected.results ?? [];
    const results = await mapWithConcurrency(articles, ARTICLE_FETCH_CONCURRENCY, async (article) => {
      try {
        const source = sourceForArticle(article);
        const { html } = await fetchArticleHtml(article.canonicalUrl, source, env);
        const body = extractArticleBodyFromHtml(html);
        const signals = extractBodyFrameSignals(body);
        return {
          articleId: article.id,
          source: article.source,
          title: article.title,
          status: "analyzed",
          bodyHash: await sha256Hex(body),
          bodyCharacters: signals.bodyCharacters,
          detectedFrames: signals.detectedFrames,
        };
      } catch (error) {
        return {
          articleId: article.id,
          source: article.source,
          title: article.title,
          status: "failed",
          failureCode: transientFailureCode(error),
          reason: String(error instanceof Error ? error.message : "본문을 가져오지 못했습니다.").slice(0, 240),
        };
      }
    });
    if (results.length) {
      const analyzedAt = Date.now();
      await runBatches(env.DB, results.map((result) => env.DB.prepare(`
        INSERT INTO article_body_signals
          (id, article_id, body_hash, body_characters, detected_frames, status, failure_code, extractor_version, taxonomy_version, analyzed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(article_id, extractor_version, taxonomy_version) DO UPDATE SET
          body_hash = excluded.body_hash,
          body_characters = excluded.body_characters,
          detected_frames = excluded.detected_frames,
          status = excluded.status,
          failure_code = excluded.failure_code,
          analyzed_at = excluded.analyzed_at
      `).bind(
        crypto.randomUUID(),
        result.articleId,
        result.status === "analyzed" ? result.bodyHash : null,
        result.status === "analyzed" ? result.bodyCharacters : null,
        JSON.stringify(result.status === "analyzed" ? result.detectedFrames : []),
        result.status,
        result.status === "failed" ? result.failureCode : null,
        ARTICLE_EXTRACTOR_VERSION,
        FRAME_TAXONOMY_VERSION,
        analyzedAt,
      )));
    }

    const progress = await transientAnalysisProgress(env.DB, start, end);
    const ready = results.filter((result) => result.status === "analyzed");
    let analysis = null;
    if (ready.length || (payload.refresh_analysis === true && progress.remaining === 0)) {
      const analysisHeaders = new Headers({ "content-type": "application/json" });
      for (const name of ["authorization", "origin", "sec-fetch-site"]) {
        const value = request.headers.get(name);
        if (value) analysisHeaders.set(name, value);
      }
      const analysisResponse = await handleAnalyze(new Request(new URL("/api/analyze", request.url), {
        method: "POST",
        headers: analysisHeaders,
        body: JSON.stringify({ date: targetDate }),
      }), env);
      analysis = await analysisResponse.json();
      if (!analysisResponse.ok) return jsonResponse(analysis, analysisResponse.status, { request });
    }
    const publicResults = results.map((result) => result.status === "analyzed" ? {
      articleId: result.articleId,
      source: result.source,
      title: result.title,
      status: result.status,
      signalCount: result.detectedFrames.length,
    } : {
      articleId: result.articleId,
      source: result.source,
      title: result.title,
      status: result.status,
      failureCode: result.failureCode,
      reason: result.reason,
    });
    return jsonResponse({
      date: targetDate,
      requested: articles.length,
      analyzedBodies: ready.length,
      bodyStorageCount: 0,
      failed: results.filter((result) => result.status === "failed").length,
      extractorVersion: ARTICLE_EXTRACTOR_VERSION,
      taxonomyVersion: FRAME_TAXONOMY_VERSION,
      complete: progress.remaining === 0,
      progress,
      results: publicResults,
      analysis,
    }, results.length ? 201 : 200, { request });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "본문 임시 분석을 완료하지 못했습니다." }, 400, { request });
  }
}

function encodeCursor(offset) {
  return btoa(JSON.stringify({ offset }));
}

function decodeCursor(value) {
  if (!value) return null;
  try {
    const decoded = JSON.parse(atob(value));
    return Number.isInteger(decoded?.offset) && decoded.offset >= 0 && decoded.offset <= 100_000 ? decoded.offset : null;
  } catch {
    return null;
  }
}

async function handleArticles(request, env) {
  if (!env?.DB) return jsonResponse({ articles: [], total: 0, nextCursor: null, meta: responseMeta(null, "demo") }, 200, { request, etag: true, cacheControl: "public, max-age=30, must-revalidate" });
  const url = new URL(request.url);
  const limitValue = Number(url.searchParams.get("limit") ?? 50);
  const limit = Number.isInteger(limitValue) ? Math.min(Math.max(limitValue, 1), 100) : 50;
  const offsetValue = Number(url.searchParams.get("offset") ?? 0);
  const cursorValue = String(url.searchParams.get("cursor") ?? "").trim();
  const cursorOffset = decodeCursor(cursorValue);
  if (cursorValue && cursorOffset === null) return jsonResponse({ error: "페이지 커서를 확인해 주세요." }, 400, { request });
  const offset = cursorOffset ?? (Number.isInteger(offsetValue) ? Math.min(Math.max(offsetValue, 0), 100_000) : 0);
  const sourceValue = String(url.searchParams.get("source") ?? "").trim();
  const sectionValue = String(url.searchParams.get("section") ?? "").trim().slice(0, 40);
  const queryValue = String(url.searchParams.get("q") ?? "").trim().slice(0, 100);
  const dateValue = String(url.searchParams.get("date") ?? "").trim();
  const clauses = [];
  const parameters = [];

  if (sourceValue) {
    const source = sourcePanel.sources.find((candidate) => candidate.active && (candidate.id === sourceValue || candidate.name === sourceValue));
    if (!source) return jsonResponse({ error: "지원하지 않는 언론사 필터입니다." }, 400);
    clauses.push("a.source_id = ?");
    parameters.push(source.id);
  }
  if (sectionValue) {
    clauses.push("a.section LIKE ? ESCAPE '\\'");
    parameters.push(`${sectionValue.replace(/[\\%_]/g, "\\$&")}%`);
  }
  if (queryValue) {
    clauses.push("a.title LIKE ? ESCAPE '\\'");
    parameters.push(`%${queryValue.replace(/[\\%_]/g, "\\$&")}%`);
  }
  if (dateValue) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) return jsonResponse({ error: "날짜 필터 형식을 확인해 주세요." }, 400);
    const start = Date.parse(`${dateValue}T00:00:00+09:00`);
    if (!Number.isFinite(start)) return jsonResponse({ error: "날짜 필터를 확인해 주세요." }, 400);
    clauses.push("a.published_at >= ? AND a.published_at < ?");
    parameters.push(start, start + 86_400_000);
  }

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const totalStatement = env.DB.prepare(`
    SELECT COUNT(*) AS total
    FROM articles a
    JOIN media_sources s ON s.id = a.source_id
    ${where}
  `);
  const totalResult = parameters.length
    ? await totalStatement.bind(...parameters).first()
    : await totalStatement.first();
  const result = await env.DB.prepare(`
    SELECT
      a.id,
      s.name AS source,
      a.title,
      a.canonical_url AS url,
      a.section,
      a.published_at AS publishedAt,
      a.collected_at AS collectedAt,
      a.homepage_placement AS homepagePlacement,
      a.homepage_rank AS homepageRank,
      (SELECT COUNT(*) FROM placement_observations po WHERE po.article_id = a.id) AS placementObservationCount,
      CASE WHEN EXISTS(
        SELECT 1 FROM article_contents ac
        WHERE ac.article_id = a.id
          AND ac.status = 'active'
          AND ac.analysis_allowed = 1
          AND (ac.usage_expires_at IS NULL OR ac.usage_expires_at > (unixepoch() * 1000))
      ) THEN 1 ELSE 0 END AS contentAvailable
    FROM articles a
    JOIN media_sources s ON s.id = a.source_id
    ${where}
    ORDER BY COALESCE(a.published_at, a.collected_at) DESC, a.id DESC
    LIMIT ? OFFSET ?
  `).bind(...parameters, limit, offset).all();
  const articles = result.results ?? [];
  const total = Number(totalResult?.total ?? 0);
  const hasMore = offset + articles.length < total;
  return jsonResponse({
    articles,
    total,
    limit,
    offset,
    hasMore,
    nextCursor: hasMore ? encodeCursor(offset + articles.length) : null,
    meta: responseMeta(null, "live_metadata"),
  }, 200, { request, etag: true, cacheControl: "public, max-age=30, must-revalidate" });
}

async function adminAuthorized(request, env) {
  if (!env?.IMPORT_TOKEN) return false;
  const requestUrl = new URL(request.url);
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if ((origin && origin !== requestUrl.origin) || (fetchSite && !["same-origin", "none"].includes(fetchSite))) return false;
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  return secureTokenMatches(token, env.IMPORT_TOKEN);
}

async function runBatches(db, statements, size = 100) {
  for (let offset = 0; offset < statements.length; offset += size) {
    await db.batch(statements.slice(offset, offset + size));
  }
}

async function mapWithConcurrency(values, concurrency, task) {
  const results = new Array(values.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await task(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => worker()));
  return results;
}

async function loadAuthorizedArticleContents(db, bucket, start, end, now = Date.now()) {
  if (!bucket) return new Map();
  const metadata = await db.prepare(`
    SELECT
      ac.id,
      ac.article_id AS articleId,
      ac.object_key AS objectKey,
      ac.public_evidence_allowed AS publicEvidenceAllowed
    FROM article_contents ac
    JOIN articles a ON a.id = ac.article_id
    WHERE
      a.published_at >= ? AND a.published_at < ?
      AND ac.status = 'active'
      AND ac.analysis_allowed = 1
      AND (ac.usage_expires_at IS NULL OR ac.usage_expires_at > ?)
      AND ac.acquired_at = (
        SELECT MAX(latest.acquired_at)
        FROM article_contents latest
        WHERE latest.article_id = ac.article_id
          AND latest.status = 'active'
          AND latest.analysis_allowed = 1
          AND (latest.usage_expires_at IS NULL OR latest.usage_expires_at > ?)
      )
  `).bind(start, end, now, now).all();
  const loaded = await mapWithConcurrency(metadata.results ?? [], 8, async (entry) => {
    try {
      const object = await bucket.get(entry.objectKey);
      if (!object) return null;
      return [entry.articleId, {
        bodyText: await object.text(),
        contentVersionId: entry.id,
        publicEvidenceAllowed: Number(entry.publicEvidenceAllowed) === 1,
      }];
    } catch (error) {
      console.error("AgendaFrame authorized content could not be loaded", { contentId: entry.id, error });
      return null;
    }
  });
  return new Map(loaded.filter(Boolean));
}

function kstDateFromMilliseconds(value) {
  const date = new Date(Number(value) + 9 * 60 * 60 * 1000);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : "";
}

async function resolveAnalysisDate(db, requestedDate) {
  if (requestedDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(requestedDate) || !Number.isFinite(Date.parse(`${requestedDate}T00:00:00+09:00`))) {
      throw new Error("분석 날짜를 YYYY-MM-DD 형식으로 입력해 주세요.");
    }
    return requestedDate;
  }
  const latest = await db.prepare("SELECT MAX(published_at) AS published_at FROM articles").first();
  const resolved = kstDateFromMilliseconds(latest?.published_at);
  if (!resolved) throw new Error("분석할 기사가 없습니다.");
  return resolved;
}

async function handleAnalyze(request, env, { contentOverrides = new Map(), includeStoredContents = true, includeDerivedSignals = true } = {}) {
  if (!env?.DB) return jsonResponse({ error: "데이터 저장소가 아직 준비되지 않았습니다." }, 503);
  if (!(await adminAuthorized(request, env))) return jsonResponse({ error: "관리자 토큰이 올바르지 않습니다." }, 401);

  let payload = {};
  try {
    const text = await request.text();
    if (text) payload = JSON.parse(text);
  } catch {
    return jsonResponse({ error: "분석 요청 형식을 확인해 주세요." }, 400);
  }

  const db = env.DB;
  let targetDate;
  try {
    targetDate = await resolveAnalysisDate(db, String(payload.date ?? "").trim());
  } catch (error) {
    return jsonResponse({ error: error.message }, 400);
  }
  const start = Date.parse(`${targetDate}T00:00:00+09:00`);
  const end = start + 86_400_000;
  const [articleResult, placementResult, authorizedContents, transientSignals] = await Promise.all([
    db.prepare(`
      SELECT
        a.id,
        a.source_id AS sourceId,
        s.name AS source,
        a.title,
        a.canonical_url AS url,
        a.section,
        a.published_at AS publishedAt,
        a.collected_at AS collectedAt,
        a.homepage_placement AS homepagePlacement,
        a.homepage_rank AS homepageRank
      FROM articles a
      JOIN media_sources s ON s.id = a.source_id
      WHERE a.published_at >= ? AND a.published_at < ?
      ORDER BY a.published_at DESC, a.id DESC
      LIMIT 2500
    `).bind(start, end).all(),
    db.prepare(`
      SELECT
        po.article_id AS articleId,
        po.zone,
        po.page_rank AS pageRank,
        po.above_fold AS aboveFold,
        hs.observed_at AS observedAt
      FROM placement_observations po
      JOIN homepage_snapshots hs ON hs.id = po.snapshot_id
      WHERE po.article_id IS NOT NULL AND hs.observed_at >= ? AND hs.observed_at < ?
      ORDER BY hs.observed_at ASC, po.page_rank ASC
    `).bind(start, end).all(),
    includeStoredContents ? loadAuthorizedArticleContents(db, env.CONTENT, start, end) : Promise.resolve(new Map()),
    includeDerivedSignals ? loadTransientBodySignals(db, start, end) : Promise.resolve(new Map()),
  ]);
  const analysisContents = new Map();
  for (const contents of [transientSignals, authorizedContents, contentOverrides]) {
    for (const [articleId, content] of contents) {
      analysisContents.set(articleId, { ...(analysisContents.get(articleId) ?? {}), ...content });
    }
  }
  const placementByArticle = new Map();
  for (const observation of placementResult.results ?? []) {
    const values = placementByArticle.get(observation.articleId) ?? [];
    values.push({
      zone: observation.zone,
      pageRank: Number(observation.pageRank),
      aboveFold: Number(observation.aboveFold) === 1,
      observedAt: Number(observation.observedAt),
    });
    placementByArticle.set(observation.articleId, values);
  }
  const sourcePolicyById = new Map(sourcePanel.sources.map((source) => [source.id, source]));
  const articles = (articleResult.results ?? []).map((article) => {
    const sourcePolicy = sourcePolicyById.get(article.sourceId);
    return {
      ...article,
      mediaGroupId: sourcePolicy?.mediaGroupId ?? article.sourceId,
      sourceType: sourcePolicy?.sourceType ?? "unclassified",
      placementObservations: placementByArticle.get(article.id) ?? [],
      ...(analysisContents.get(article.id) ?? {}),
    };
  });
  if (!articles.length) return jsonResponse({ error: `${targetDate}에 분석할 기사가 없습니다.` }, 400);

  const runId = crypto.randomUUID();
  const startedAt = Date.now();
  await db.prepare(`
    INSERT INTO analysis_runs
      (id, target_date, provider, model_version, status, started_at, article_count, issue_count)
    VALUES (?, ?, ?, ?, 'running', ?, ?, 0)
  `).bind(runId, targetDate, ANALYSIS_PROVIDER, ANALYSIS_MODEL_VERSION, startedAt, articles.length).run();

  try {
    const activeSources = sourcePanel.sources.filter((source) => source.active);
    const analyzed = analysisProvider.analyze(articles, {
      configuredSourceCount: activeSources.length,
      configuredSourceGroupCount: new Set(activeSources.map((source) => source.mediaGroupId ?? source.id)).size,
      maxIssues: 80,
    });
    const issueIds = await Promise.all(analyzed.map((issue, index) => sha256Hex(`${runId}:${index}:${issue.title}`)));
    const statements = [];
    analyzed.forEach((issue, index) => {
      const issueId = issueIds[index];
      statements.push(db.prepare(`
        INSERT INTO issues
          (id, run_id, issue_date, title, summary, category, article_count, source_count, agenda_score, diversity_score, placement_score, volume_score, repetition_score, confidence)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        issueId,
        runId,
        targetDate,
        issue.title,
        issue.summary,
        issue.category,
        issue.articleCount,
        issue.sourceCount,
        issue.agendaScore,
        issue.diversityScore,
        issue.placementScore ?? 0,
        issue.volumeScore,
        issue.repetitionScore,
        issue.confidence ?? 0,
      ));
      issue.articles.forEach((article) => {
        statements.push(db.prepare(`
          INSERT INTO issue_articles (id, issue_id, article_id, similarity, representative)
          VALUES (?, ?, ?, ?, ?)
        `).bind(crypto.randomUUID(), issueId, article.id, article.similarity, article.representative ? 1 : 0));
      });
      issue.frames.forEach((frame) => {
        statements.push(db.prepare(`
          INSERT INTO frame_analyses
            (id, issue_id, frame, score, confidence, evidence_basis, evidence_text, evidence_start, evidence_end, content_version_id, article_id, source_id, provider, model_version)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          crypto.randomUUID(),
          issueId,
          frame.frame,
          frame.score,
          frame.confidence ?? 0,
          frame.evidenceBasis ?? "headline",
          frame.evidenceText,
          frame.evidenceStart ?? null,
          frame.evidenceEnd ?? null,
          frame.contentVersionId ?? null,
          frame.articleId,
          frame.sourceId,
          ANALYSIS_PROVIDER,
          ANALYSIS_MODEL_VERSION,
        ));
      });
      statements.push(db.prepare(`
        INSERT INTO ai_reports
          (id, issue_id, summary, missing_perspective, caution, provider, model_version, generated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        crypto.randomUUID(),
        issueId,
        issue.report.summary,
        issue.report.missingPerspective,
        issue.report.caution,
        ANALYSIS_PROVIDER,
        ANALYSIS_MODEL_VERSION,
        Date.now(),
      ));
    });
    await runBatches(db, statements);
    const finishedAt = Date.now();
    await db.prepare(`
      UPDATE analysis_runs
      SET status = 'success', finished_at = ?, issue_count = ?
      WHERE id = ?
    `).bind(finishedAt, analyzed.length, runId).run();
    return jsonResponse({
      runId,
      date: targetDate,
      provider: ANALYSIS_PROVIDER,
      modelVersion: ANALYSIS_MODEL_VERSION,
      articleCount: articles.length,
      authorizedBodyCount: authorizedContents.size,
      transientBodyCount: new Set([
        ...transientSignals.keys(),
        ...[...contentOverrides].filter(([, content]) => content?.transientContent).map(([articleId]) => articleId),
      ]).size,
      bodyEvidenceCount: [...analysisContents.values()].filter((content) => Boolean(content?.bodyText) || content?.bodyAnalysisAvailable === true).length,
      issueCount: analyzed.length,
      paidServicesUsed: false,
    }, 201);
  } catch (error) {
    await db.prepare(`
      UPDATE analysis_runs
      SET status = 'failed', finished_at = ?, error_message = ?
      WHERE id = ?
    `).bind(Date.now(), String(error?.message ?? "Analysis failed").slice(0, 500), runId).run();
    console.error("AgendaFrame analysis failed", error);
    return jsonResponse({ error: "분석을 완료하지 못했습니다." }, 500);
  }
}

async function latestAnalysisRun(db, requestedDate = "") {
  if (requestedDate) {
    return db.prepare(`
      SELECT id, target_date AS targetDate, provider, model_version AS modelVersion, finished_at AS finishedAt, article_count AS articleCount, issue_count AS issueCount
      FROM analysis_runs
      WHERE status = 'success' AND target_date = ?
      ORDER BY finished_at DESC
      LIMIT 1
    `).bind(requestedDate).first();
  }
  return db.prepare(`
    SELECT id, target_date AS targetDate, provider, model_version AS modelVersion, finished_at AS finishedAt, article_count AS articleCount, issue_count AS issueCount
    FROM analysis_runs
    WHERE status = 'success'
    ORDER BY target_date DESC, finished_at DESC
    LIMIT 1
  `).first();
}

export function enumerateKstDates(startDate, endDate, maxDays = 31) {
  const pattern = /^\d{4}-\d{2}-\d{2}$/;
  if (!pattern.test(startDate) || !pattern.test(endDate)) throw new Error("시작일과 종료일을 YYYY-MM-DD 형식으로 입력해 주세요.");
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || new Date(start).toISOString().slice(0, 10) !== startDate || new Date(end).toISOString().slice(0, 10) !== endDate) {
    throw new Error("유효한 분석 기간을 입력해 주세요.");
  }
  if (end < start) throw new Error("종료일은 시작일보다 빠를 수 없습니다.");
  const dayCount = Math.floor((end - start) / 86_400_000) + 1;
  if (dayCount > maxDays) throw new Error(`한 번에 최대 ${maxDays}일의 상태를 확인할 수 있습니다.`);
  return Array.from({ length: dayCount }, (_, index) => new Date(start + index * 86_400_000).toISOString().slice(0, 10));
}

async function handleAnalysisRuns(request, env) {
  if (!env?.DB) return jsonResponse({ error: "데이터 저장소가 아직 준비되지 않았습니다." }, 503);
  if (!(await adminAuthorized(request, env))) return jsonResponse({ error: "관리자 토큰이 올바르지 않습니다." }, 401);
  const url = new URL(request.url);
  const startDate = String(url.searchParams.get("start") ?? "").trim();
  const endDate = String(url.searchParams.get("end") ?? "").trim();
  let dates;
  try {
    dates = enumerateKstDates(startDate, endDate, 31);
  } catch (error) {
    return jsonResponse({ error: error.message }, 400);
  }

  const start = Date.parse(`${startDate}T00:00:00+09:00`);
  const endExclusive = Date.parse(`${endDate}T00:00:00+09:00`) + 86_400_000;
  const [runResult, articleResult] = await Promise.all([
    env.DB.prepare(`
      SELECT id, target_date AS targetDate, status, provider, model_version AS modelVersion,
        started_at AS startedAt, finished_at AS finishedAt, article_count AS analyzedArticleCount,
        issue_count AS issueCount, error_message AS errorMessage
      FROM (
        SELECT *, ROW_NUMBER() OVER (PARTITION BY target_date ORDER BY started_at DESC, created_at DESC) AS rowNumber
        FROM analysis_runs
        WHERE target_date >= ? AND target_date <= ?
      )
      WHERE rowNumber = 1
      ORDER BY targetDate
    `).bind(startDate, endDate).all(),
    env.DB.prepare(`
      SELECT date(published_at / 1000, 'unixepoch', '+9 hours') AS targetDate, COUNT(*) AS articleCount
      FROM articles
      WHERE published_at >= ? AND published_at < ?
      GROUP BY targetDate
      ORDER BY targetDate
    `).bind(start, endExclusive).all(),
  ]);
  const runsByDate = new Map((runResult.results ?? []).map((run) => [run.targetDate, run]));
  const articleCountByDate = new Map((articleResult.results ?? []).map((entry) => [entry.targetDate, Number(entry.articleCount) || 0]));
  const days = dates.map((date) => {
    const run = runsByDate.get(date) ?? null;
    const articleCount = articleCountByDate.get(date) ?? 0;
    return {
      date,
      articleCount,
      status: run?.status ?? (articleCount ? "pending" : "empty"),
      runId: run?.id ?? null,
      analyzedArticleCount: Number(run?.analyzedArticleCount ?? 0),
      issueCount: Number(run?.issueCount ?? 0),
      provider: run?.provider ?? null,
      modelVersion: run?.modelVersion ?? null,
      startedAt: run?.startedAt ?? null,
      finishedAt: run?.finishedAt ?? null,
      errorMessage: run?.errorMessage ?? null,
    };
  });
  return jsonResponse({ startDate, endDate, days, maxBatchDays: 7, resumable: true });
}

async function handleAnalysisRollback(request, runId, env) {
  if (request.method !== "POST") return jsonResponse({ error: "POST 요청만 허용합니다." }, 405, { request });
  if (!env?.DB) return jsonResponse({ error: "데이터 저장소가 아직 준비되지 않았습니다." }, 503, { request });
  if (!(await adminAuthorized(request, env))) return jsonResponse({ error: "관리자 토큰이 올바르지 않습니다." }, 401, { request });
  if (!runId || runId.length > 128) return jsonResponse({ error: "롤백할 실행 ID를 확인해 주세요." }, 400, { request });

  const run = await env.DB.prepare(`
    SELECT id, target_date AS targetDate, status
    FROM analysis_runs
    WHERE id = ?
  `).bind(runId).first();
  if (!run) return jsonResponse({ error: "롤백할 분석 실행을 찾지 못했습니다." }, 404, { request });
  if (run.status !== "success") return jsonResponse({ error: "성공 상태의 분석 실행만 롤백할 수 있습니다." }, 409, { request });

  const fallback = await env.DB.prepare(`
    SELECT id, target_date AS targetDate, finished_at AS finishedAt
    FROM analysis_runs
    WHERE target_date = ? AND status = 'success' AND id != ?
    ORDER BY finished_at DESC
    LIMIT 1
  `).bind(run.targetDate, runId).first();
  if (!fallback) return jsonResponse({ error: "같은 기준일의 직전 성공 스냅샷이 없어 롤백하지 않았습니다." }, 409, { request });

  await env.DB.prepare(`
    UPDATE analysis_runs
    SET status = 'rolled_back', error_message = ?
    WHERE id = ? AND status = 'success'
  `).bind(`Rolled back at ${new Date().toISOString()}`, runId).run();
  return jsonResponse({ rolledBackRunId: runId, fallbackRunId: fallback.id, targetDate: run.targetDate }, 200, { request });
}

async function handleIssues(request, env) {
  if (!env?.DB) return jsonResponse({ issues: [], total: 0, run: null, categories: [], meta: responseMeta(null, "demo") }, 200, { request, etag: true, cacheControl: "public, max-age=30, must-revalidate" });
  const url = new URL(request.url);
  const date = String(url.searchParams.get("date") ?? "").trim();
  const category = String(url.searchParams.get("category") ?? "").trim().slice(0, 40);
  const limitValue = Number(url.searchParams.get("limit") ?? 30);
  const limit = Number.isInteger(limitValue) ? Math.min(Math.max(limitValue, 1), 50) : 30;
  const run = await latestAnalysisRun(env.DB, date);
  if (!run) return jsonResponse({ issues: [], total: 0, run: null, categories: [], meta: responseMeta(null, "live_metadata") }, 200, { request, etag: true, cacheControl: "public, max-age=30, must-revalidate" });

  const clauses = ["run_id = ?"];
  const parameters = [run.id];
  if (category) {
    clauses.push("category = ?");
    parameters.push(category);
  }
  const where = clauses.join(" AND ");
  const [count, result, categoryResult] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) AS total FROM issues WHERE ${where}`).bind(...parameters).first(),
    env.DB.prepare(`
      SELECT
        id, issue_date AS issueDate, title, summary, category, article_count AS articleCount, source_count AS sourceCount,
        agenda_score AS agendaScore, diversity_score AS diversityScore, placement_score AS placementScore,
        volume_score AS volumeScore, repetition_score AS repetitionScore, confidence,
        (SELECT COUNT(*) FROM issue_articles ia JOIN articles a ON a.id = ia.article_id WHERE ia.issue_id = issues.id AND (a.homepage_placement IS NOT NULL OR EXISTS(SELECT 1 FROM placement_observations po WHERE po.article_id = a.id))) AS placementObservedCount,
        (SELECT COUNT(*) FROM issue_articles ia WHERE ia.issue_id = issues.id) AS placementTotalCount,
         (SELECT COUNT(*) FROM issue_articles ia WHERE ia.issue_id = issues.id AND (
           EXISTS(
             SELECT 1 FROM article_contents ac
             WHERE ac.article_id = ia.article_id
               AND ac.status = 'active'
               AND ac.analysis_allowed = 1
               AND (ac.usage_expires_at IS NULL OR ac.usage_expires_at > (unixepoch() * 1000))
           ) OR EXISTS(
             SELECT 1 FROM frame_analyses fa
             WHERE fa.issue_id = issues.id
               AND fa.article_id = ia.article_id
               AND fa.evidence_basis = 'body_transient'
           )
         )) AS contentAvailableCount
      FROM issues
      WHERE ${where}
      ORDER BY agenda_score DESC, article_count DESC
      LIMIT ?
    `).bind(...parameters, limit).all(),
    env.DB.prepare(`SELECT category, COUNT(*) AS count FROM issues WHERE run_id = ? GROUP BY category ORDER BY count DESC, category`).bind(run.id).all(),
  ]);
  return jsonResponse({
    run,
    issues: (result.results ?? []).map((issue) => publicIssue(issue, run)),
    total: Number(count?.total ?? 0),
    categories: categoryResult.results ?? [],
    analysisDisclosure: "기사 제목·메타데이터 기준 규칙 분석. 확률·사실성·편향 판정이 아닙니다.",
    meta: responseMeta(run, "live_metadata"),
  }, 200, { request, etag: true, cacheControl: "public, max-age=60, must-revalidate" });
}

async function handleIssueDetail(request, issueId, env) {
  if (!env?.DB) return jsonResponse({ error: "분석 데이터가 없습니다." }, 404, { request });
  const issue = await env.DB.prepare(`
    SELECT
      i.id, i.issue_date AS issueDate, i.title, i.summary, i.category, i.article_count AS articleCount, i.source_count AS sourceCount,
      i.agenda_score AS agendaScore, i.diversity_score AS diversityScore, i.placement_score AS placementScore,
      i.volume_score AS volumeScore, i.repetition_score AS repetitionScore, i.confidence,
      r.id AS runId, r.target_date AS targetDate, r.provider, r.model_version AS modelVersion, r.finished_at AS analyzedAt,
      (SELECT COUNT(*) FROM issue_articles observed_ia JOIN articles observed_a ON observed_a.id = observed_ia.article_id WHERE observed_ia.issue_id = i.id AND (observed_a.homepage_placement IS NOT NULL OR EXISTS(SELECT 1 FROM placement_observations po WHERE po.article_id = observed_a.id))) AS placementObservedCount,
      (SELECT COUNT(*) FROM issue_articles total_ia WHERE total_ia.issue_id = i.id) AS placementTotalCount,
      (SELECT COUNT(*) FROM issue_articles content_ia WHERE content_ia.issue_id = i.id AND (
        EXISTS(
          SELECT 1 FROM article_contents ac
          WHERE ac.article_id = content_ia.article_id
            AND ac.status = 'active'
            AND ac.analysis_allowed = 1
            AND (ac.usage_expires_at IS NULL OR ac.usage_expires_at > (unixepoch() * 1000))
        ) OR EXISTS(
          SELECT 1 FROM frame_analyses fa
          WHERE fa.issue_id = i.id
            AND fa.article_id = content_ia.article_id
            AND fa.evidence_basis = 'body_transient'
        )
      )) AS contentAvailableCount
    FROM issues i
    JOIN analysis_runs r ON r.id = i.run_id
    WHERE i.id = ? AND r.status = 'success'
  `).bind(issueId).first();
  if (!issue) return jsonResponse({ error: "이슈를 찾지 못했습니다." }, 404, { request });
  const [articles, frames, report, outlets] = await Promise.all([
    env.DB.prepare(`
      SELECT
        a.id, s.name AS source, a.title, a.canonical_url AS url, a.section, a.published_at AS publishedAt,
        a.homepage_placement AS homepagePlacement, a.homepage_rank AS homepageRank,
        ia.similarity, ia.representative,
        CASE WHEN EXISTS(
          SELECT 1 FROM article_contents ac
          WHERE ac.article_id = a.id
            AND ac.status = 'active'
            AND ac.analysis_allowed = 1
            AND (ac.usage_expires_at IS NULL OR ac.usage_expires_at > (unixepoch() * 1000))
        ) OR EXISTS(
          SELECT 1 FROM frame_analyses fa
          WHERE fa.issue_id = ia.issue_id
            AND fa.article_id = a.id
            AND fa.evidence_basis = 'body_transient'
        ) THEN 1 ELSE 0 END AS contentAvailable
      FROM issue_articles ia
      JOIN articles a ON a.id = ia.article_id
      JOIN media_sources s ON s.id = a.source_id
      WHERE ia.issue_id = ?
      ORDER BY ia.representative DESC, a.published_at DESC
    `).bind(issueId).all(),
    env.DB.prepare(`
      SELECT fa.frame, fa.score, fa.confidence, fa.evidence_basis AS evidenceBasis,
        fa.evidence_text AS evidenceText, fa.evidence_start AS evidenceStart, fa.evidence_end AS evidenceEnd,
        s.name AS source, fa.article_id AS articleId, a.canonical_url AS sourceUrl,
        ac.status AS contentStatus, ac.analysis_allowed AS contentAnalysisAllowed,
        ac.public_evidence_allowed AS publicEvidenceAllowed, ac.usage_expires_at AS usageExpiresAt
      FROM frame_analyses fa
      LEFT JOIN media_sources s ON s.id = fa.source_id
      LEFT JOIN articles a ON a.id = fa.article_id
      LEFT JOIN article_contents ac ON ac.id = fa.content_version_id
      WHERE fa.issue_id = ?
      ORDER BY fa.score DESC
    `).bind(issueId).all(),
    env.DB.prepare(`
      SELECT summary, missing_perspective AS missingPerspective, caution, provider, model_version AS modelVersion, generated_at AS generatedAt
      FROM ai_reports
      WHERE issue_id = ?
    `).bind(issueId).first(),
    env.DB.prepare(`
      SELECT s.name AS source, COUNT(*) AS articleCount,
        MAX(CASE a.homepage_placement WHEN 'top' THEN 4 WHEN 'main' THEN 3 WHEN 'section' THEN 2 WHEN 'list' THEN 1 ELSE 0 END) AS placementWeight
      FROM issue_articles ia
      JOIN articles a ON a.id = ia.article_id
      JOIN media_sources s ON s.id = a.source_id
      WHERE ia.issue_id = ?
      GROUP BY s.id, s.name
      ORDER BY articleCount DESC, s.name
    `).bind(issueId).all(),
  ]);
  const run = { id: issue.runId, targetDate: issue.targetDate, provider: issue.provider, modelVersion: issue.modelVersion, finishedAt: issue.analyzedAt };
  const publicArticles = articles.results ?? [];
  const currentAnalysis = COMPATIBLE_ANALYSIS_MODELS.has(issue.modelVersion);
  const publicFrames = currentAnalysis ? (frames.results ?? []).map((row) => {
    const frame = { ...row };
    const publicBodyEvidenceIsActive = frame.evidenceBasis === "body_public"
      && frame.contentStatus === "active"
      && Number(frame.contentAnalysisAllowed) === 1
      && Number(frame.publicEvidenceAllowed) === 1
      && (frame.usageExpiresAt == null || Number(frame.usageExpiresAt) > Date.now());
    if (frame.evidenceBasis === "body_transient") {
      frame.evidenceText = "기사 본문을 메모리에서 임시 분석해 감지한 표현 단서입니다. 전문과 원문 문장은 저장하지 않았습니다.";
      frame.evidenceStart = null;
      frame.evidenceEnd = null;
    }
    if (frame.evidenceBasis === "body_private" || (frame.evidenceBasis === "body_public" && !publicBodyEvidenceIsActive)) {
      frame.evidenceBasis = "body_private";
      frame.evidenceText = "승인된 본문에서 감지한 신호입니다. 원문은 공개하지 않습니다.";
      frame.evidenceStart = null;
      frame.evidenceEnd = null;
    }
    delete frame.confidence;
    delete frame.contentStatus;
    delete frame.contentAnalysisAllowed;
    delete frame.publicEvidenceAllowed;
    delete frame.usageExpiresAt;
    return { ...frame, calibrationStatus: "not_calibrated" };
  }) : [];
  const placementByWeight = { 4: "TOP", 3: "MAIN", 2: "SECTION", 1: "LIST", 0: "미확인" };
  const publicReport = currentAnalysis && report ? {
    ...report,
    evidenceRefs: publicArticles.map((article) => ({ articleId: article.id, source: article.source, sourceUrl: article.url })),
  } : null;
  return jsonResponse({
    issue: publicIssue(issue, run),
    articles: publicArticles,
    frames: publicFrames,
    report: publicReport,
    outlets: (outlets.results ?? []).map((outlet) => ({ ...outlet, placement: placementByWeight[outlet.placementWeight] ?? "미확인" })),
    comparison: evidenceFirstComparison(issue, publicArticles),
    meta: responseMeta(run, "live_metadata"),
  }, 200, { request, etag: true, cacheControl: "public, max-age=300, immutable" });
}

function roundedPercent(numerator, denominator) {
  if (!denominator) return null;
  return Math.round((Number(numerator) / Number(denominator)) * 1000) / 10;
}

export function calculateQualityMetrics(rows, { configuredSources = 5, minimumSample = 30, targetSample = 50 } = {}) {
  const reviewed = (Array.isArray(rows) ? rows : []).filter((row) => row.reviewId);
  const totals = reviewed.reduce((summary, row) => {
    const articleCount = Math.max(0, Number(row.articleCount) || 0);
    const misplacedCount = Math.min(articleCount, Math.max(0, Number(row.misplacedCount) || 0));
    summary.predictedArticles += articleCount;
    summary.relatedArticles += articleCount - misplacedCount;
    summary.missingArticles += Math.max(0, Number(row.missingCount) || 0);
    summary.clusterAgreement += { correct: 1, partial: 0.5, incorrect: 0 }[row.clusterVerdict] ?? 0;
    summary.agendaAgreement += row.agendaVerdict === "appropriate" ? 1 : 0;
    summary.frameAgreement += { appropriate: 1, partial: 0.5, inappropriate: 0, uncertain: 0 }[row.frameVerdict] ?? 0;
    summary.sourceDiversity += Math.min(Math.max(0, Number(row.sourceCount) || 0) / Math.max(1, configuredSources), 1);
    return summary;
  }, { predictedArticles: 0, relatedArticles: 0, missingArticles: 0, clusterAgreement: 0, agendaAgreement: 0, frameAgreement: 0, sourceDiversity: 0 });

  const reviewedIssueCount = reviewed.length;
  return {
    reviewedIssueCount,
    minimumSample,
    targetSample,
    progressPercent: roundedPercent(Math.min(reviewedIssueCount, targetSample), targetSample) ?? 0,
    sampleStatus: reviewedIssueCount >= minimumSample ? "ready" : "collecting",
    estimatedPrecision: roundedPercent(totals.relatedArticles, totals.predictedArticles),
    estimatedRecall: roundedPercent(totals.relatedArticles, totals.relatedArticles + totals.missingArticles),
    overmergeRate: roundedPercent(totals.predictedArticles - totals.relatedArticles, totals.predictedArticles),
    undermergeRate: roundedPercent(totals.missingArticles, totals.relatedArticles + totals.missingArticles),
    pairwiseF1: null,
    hardNegativeAccuracy: null,
    clusterAgreement: roundedPercent(totals.clusterAgreement, reviewedIssueCount),
    agendaAgreement: roundedPercent(totals.agendaAgreement, reviewedIssueCount),
    frameAgreement: roundedPercent(totals.frameAgreement, reviewedIssueCount),
    sourceDiversityCoverage: roundedPercent(totals.sourceDiversity, reviewedIssueCount),
    reviewedArticleCount: totals.predictedArticles,
    misplacedArticleCount: totals.predictedArticles - totals.relatedArticles,
    missingArticleCount: totals.missingArticles,
  };
}

async function handleQualityQueue(request, env) {
  if (!env?.DB) return jsonResponse({ error: "데이터 저장소가 아직 준비되지 않았습니다." }, 503);
  if (!(await adminAuthorized(request, env))) return jsonResponse({ error: "관리자 토큰이 올바르지 않습니다." }, 401);
  const url = new URL(request.url);
  const date = String(url.searchParams.get("date") ?? "").trim();
  const limitValue = Number(url.searchParams.get("limit") ?? 50);
  const limit = Number.isInteger(limitValue) ? Math.min(Math.max(limitValue, 1), 50) : 50;
  const run = await latestAnalysisRun(env.DB, date);
  const emptyMetrics = calculateQualityMetrics([], { configuredSources: sourcePanel.sources.filter((source) => source.active).length });
  if (!run) return jsonResponse({ run: null, issues: [], metrics: emptyMetrics });

  const result = await env.DB.prepare(`
    SELECT
      i.id, i.title, i.category, i.article_count AS articleCount, i.source_count AS sourceCount,
      i.agenda_score AS agendaScore, i.confidence,
      qr.id AS reviewId, qr.cluster_verdict AS clusterVerdict, qr.agenda_verdict AS agendaVerdict,
      qr.frame_verdict AS frameVerdict, qr.reviewed_at AS reviewedAt, qr.updated_at AS updatedAt,
      COALESCE((SELECT COUNT(*) FROM quality_review_article_flags f WHERE f.review_id = qr.id), 0) AS misplacedCount,
      COALESCE((SELECT COUNT(*) FROM quality_review_missing_articles m WHERE m.review_id = qr.id), 0) AS missingCount
    FROM issues i
    LEFT JOIN quality_reviews qr ON qr.issue_id = i.id
    WHERE i.run_id = ?
    ORDER BY i.agenda_score DESC, i.article_count DESC
    LIMIT ?
  `).bind(run.id, limit).all();
  const issues = result.results ?? [];
  return jsonResponse({
    run,
    issues,
    metrics: calculateQualityMetrics(issues, { configuredSources: sourcePanel.sources.filter((source) => source.active).length }),
    methodology: {
      label: "사람 검토 기반 추정치",
      precision: "검토한 묶음 기사 중 관련 있다고 판단한 기사 비율",
      recall: "관련 기사와 직접 등록한 누락 기사를 합친 값 중 시스템이 묶은 관련 기사 비율",
      pairwiseF1: "라벨된 기사 쌍 데이터셋이 없어 산출 보류",
      hardNegativeAccuracy: "locked holdout hard-negative 라벨이 없어 산출 보류",
    },
  });
}

async function loadQualityReview(issueId, env) {
  const issue = await env.DB.prepare(`
    SELECT i.id, i.title, i.issue_date AS issueDate, i.article_count AS articleCount, i.source_count AS sourceCount,
      i.agenda_score AS agendaScore, i.confidence, r.target_date AS targetDate
    FROM issues i
    JOIN analysis_runs r ON r.id = i.run_id
    WHERE i.id = ?
  `).bind(issueId).first();
  if (!issue) return null;
  const review = await env.DB.prepare(`
    SELECT id, issue_id AS issueId, cluster_verdict AS clusterVerdict, agenda_verdict AS agendaVerdict,
      frame_verdict AS frameVerdict, notes, reviewed_at AS reviewedAt, updated_at AS updatedAt
    FROM quality_reviews
    WHERE issue_id = ?
  `).bind(issueId).first();
  if (!review) return { issue, review: null, flaggedArticleIds: [], missingArticles: [] };
  const [flags, missing] = await Promise.all([
    env.DB.prepare("SELECT article_id AS articleId FROM quality_review_article_flags WHERE review_id = ? ORDER BY created_at").bind(review.id).all(),
    env.DB.prepare(`
      SELECT m.id, m.title, m.canonical_url AS url, m.note, s.name AS source
      FROM quality_review_missing_articles m
      JOIN media_sources s ON s.id = m.source_id
      WHERE m.review_id = ?
      ORDER BY m.created_at
    `).bind(review.id).all(),
  ]);
  return {
    issue,
    review,
    flaggedArticleIds: (flags.results ?? []).map((entry) => entry.articleId),
    missingArticles: missing.results ?? [],
  };
}

async function saveQualityReview(request, issueId, env) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ error: "검토 요청 형식을 확인해 주세요." }, 400);
  }
  const clusterVerdict = String(payload?.clusterVerdict ?? "");
  const agendaVerdict = String(payload?.agendaVerdict ?? "");
  const frameVerdict = String(payload?.frameVerdict ?? "");
  if (!["correct", "partial", "incorrect"].includes(clusterVerdict)) return jsonResponse({ error: "기사 묶음 평가를 선택해 주세요." }, 400);
  if (!["appropriate", "overstated", "understated", "uncertain"].includes(agendaVerdict)) return jsonResponse({ error: "의제 점수 평가를 선택해 주세요." }, 400);
  if (!["appropriate", "partial", "inappropriate", "uncertain"].includes(frameVerdict)) return jsonResponse({ error: "프레임 평가를 선택해 주세요." }, 400);
  const notes = String(payload?.notes ?? "").trim();
  if (notes.length > 2000) return jsonResponse({ error: "검토 메모는 2,000자 이하여야 합니다." }, 400);

  const issue = await env.DB.prepare("SELECT id, article_count AS articleCount FROM issues WHERE id = ?").bind(issueId).first();
  if (!issue) return jsonResponse({ error: "검토할 이슈를 찾지 못했습니다." }, 404);
  const flaggedArticleIds = [...new Set((Array.isArray(payload?.flaggedArticleIds) ? payload.flaggedArticleIds : []).map((value) => String(value).trim()).filter(Boolean))];
  if (flaggedArticleIds.length > Number(issue.articleCount)) return jsonResponse({ error: "잘못 묶인 기사 수를 확인해 주세요." }, 400);
  if (flaggedArticleIds.length) {
    const placeholders = flaggedArticleIds.map(() => "?").join(", ");
    const allowed = await env.DB.prepare(`SELECT COUNT(*) AS count FROM issue_articles WHERE issue_id = ? AND article_id IN (${placeholders})`).bind(issueId, ...flaggedArticleIds).first();
    if (Number(allowed?.count ?? 0) !== flaggedArticleIds.length) return jsonResponse({ error: "해당 이슈에 포함되지 않은 기사가 선택되었습니다." }, 400);
  }

  const missingInput = Array.isArray(payload?.missingArticles) ? payload.missingArticles : [];
  if (missingInput.length > 20) return jsonResponse({ error: "누락 기사는 이슈당 최대 20건까지 기록할 수 있습니다." }, 400);
  const sourceByName = new Map(sourcePanel.sources.filter((source) => source.active).map((source) => [source.name, source]));
  const missingArticles = [];
  const seenUrls = new Set();
  for (const [index, entry] of missingInput.entries()) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return jsonResponse({ error: `${index + 1}번째 누락 기사 형식을 확인해 주세요.` }, 400);
    const source = sourceByName.get(String(entry.source ?? "").trim());
    const title = String(entry.title ?? "").trim();
    const note = String(entry.note ?? "").trim();
    if (!source) return jsonResponse({ error: `${index + 1}번째 누락 기사의 언론사를 확인해 주세요.` }, 400);
    if (!title || title.length > 500) return jsonResponse({ error: `${index + 1}번째 누락 기사 제목은 1~500자여야 합니다.` }, 400);
    if (note.length > 500) return jsonResponse({ error: `${index + 1}번째 누락 기사 메모는 500자 이하여야 합니다.` }, 400);
    let canonicalUrl;
    try {
      canonicalUrl = canonicalizeArticleUrl(entry.url);
    } catch {
      return jsonResponse({ error: `${index + 1}번째 누락 기사 URL을 확인해 주세요.` }, 400);
    }
    if (!matchesSourceDomain(new URL(canonicalUrl).hostname.toLowerCase(), source.domains ?? [])) {
      return jsonResponse({ error: `${index + 1}번째 누락 기사는 ${source.name} 공식 도메인 URL이어야 합니다.` }, 400);
    }
    if (seenUrls.has(canonicalUrl)) return jsonResponse({ error: "같은 누락 기사 URL을 두 번 기록할 수 없습니다." }, 400);
    seenUrls.add(canonicalUrl);
    missingArticles.push({ source, title, canonicalUrl, note });
  }

  const existing = await env.DB.prepare("SELECT id FROM quality_reviews WHERE issue_id = ?").bind(issueId).first();
  const reviewId = existing?.id ?? crypto.randomUUID();
  const now = Date.now();
  const statements = [
    env.DB.prepare(`
      INSERT INTO quality_reviews
        (id, issue_id, cluster_verdict, agenda_verdict, frame_verdict, notes, reviewed_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(issue_id) DO UPDATE SET
        cluster_verdict = excluded.cluster_verdict,
        agenda_verdict = excluded.agenda_verdict,
        frame_verdict = excluded.frame_verdict,
        notes = excluded.notes,
        reviewed_at = excluded.reviewed_at,
        updated_at = excluded.updated_at
    `).bind(reviewId, issueId, clusterVerdict, agendaVerdict, frameVerdict, notes, now, now),
    env.DB.prepare("DELETE FROM quality_review_article_flags WHERE review_id = ?").bind(reviewId),
    env.DB.prepare("DELETE FROM quality_review_missing_articles WHERE review_id = ?").bind(reviewId),
    ...flaggedArticleIds.map((articleId) => env.DB.prepare(`
      INSERT INTO quality_review_article_flags (id, review_id, article_id, note)
      VALUES (?, ?, ?, '')
    `).bind(crypto.randomUUID(), reviewId, articleId)),
    ...missingArticles.map((article) => env.DB.prepare(`
      INSERT INTO quality_review_missing_articles (id, review_id, source_id, title, canonical_url, note)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(crypto.randomUUID(), reviewId, article.source.id, article.title, article.canonicalUrl, article.note)),
  ];
  await env.DB.batch(statements);
  return jsonResponse({
    saved: true,
    reviewId,
    issueId,
    misplacedCount: flaggedArticleIds.length,
    missingCount: missingArticles.length,
    reviewedAt: now,
  }, existing ? 200 : 201);
}

async function handleQualityReview(request, issueId, env) {
  if (!env?.DB) return jsonResponse({ error: "데이터 저장소가 아직 준비되지 않았습니다." }, 503);
  if (!(await adminAuthorized(request, env))) return jsonResponse({ error: "관리자 토큰이 올바르지 않습니다." }, 401);
  if (!issueId || issueId.length > 128) return jsonResponse({ error: "검토할 이슈를 확인해 주세요." }, 400);
  if (request.method === "GET") {
    const result = await loadQualityReview(issueId, env);
    return result ? jsonResponse(result) : jsonResponse({ error: "검토할 이슈를 찾지 못했습니다." }, 404);
  }
  if (request.method === "PUT") return saveQualityReview(request, issueId, env);
  return jsonResponse({ error: "GET 또는 PUT 요청만 허용됩니다." }, 405);
}

export async function handleApiRequest(request, env = {}) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/")) return null;

  if (url.pathname === "/api/health" && request.method === "GET") {
    if (!env.DB) {
      const freshness = classifySnapshotStatus();
      return jsonResponse({
        status: "ok",
        mode: "demo",
        dataAsOf: null,
        collection: { method: sourcePanel.collectionProvider, directCrawling: false, configuredSources: sourcePanel.sources.length, articleCount: 0, authorizedContentCount: 0, transientEvidenceCount: 0, bodyEvidenceCount: 0, latestSourceCount: 0, latestInserted: 0, latestDuplicates: 0, latestStatus: "awaiting_import" },
        analysis: null,
        freshness,
        timestamps: { collectedAt: null, analyzedAt: null, publishedAt: null, nextScheduledAt: null },
        meta: responseMeta(null, "demo"),
      }, 200, { request });
    }
    try {
      const health = await collectionHealth(env.DB);
      let analysis = null;
      try {
        analysis = await latestAnalysisRun(env.DB);
      } catch {
        analysis = null;
      }
      const freshness = classifySnapshotStatus({
        targetDate: analysis?.targetDate,
        dataAsOf: health.dataAsOf,
        collectionStatus: health.collection.latestStatus,
        latestSourceCount: health.collection.latestSourceCount,
        configuredSources: health.collection.configuredSources,
      });
      return jsonResponse({
        ...health,
        mode: "live_metadata",
        analysis,
        freshness,
        timestamps: { collectedAt: health.dataAsOf, analyzedAt: analysis?.finishedAt ?? null, publishedAt: analysis?.finishedAt ?? null, nextScheduledAt: null },
        meta: responseMeta(analysis, "live_metadata"),
      }, 200, { request });
    } catch (error) {
      console.error("AgendaFrame health query failed", error);
      return jsonResponse({ status: "degraded", mode: "unavailable", dataAsOf: null, collection: { method: sourcePanel.collectionProvider, directCrawling: false, configuredSources: sourcePanel.sources.length, articleCount: 0, authorizedContentCount: 0, transientEvidenceCount: 0, bodyEvidenceCount: 0, latestSourceCount: 0, latestInserted: 0, latestDuplicates: 0, latestStatus: "storage_unavailable" }, analysis: null, freshness: { status: "analysis_pending", label: "분석 보류", staleDays: null }, timestamps: { collectedAt: null, analyzedAt: null, publishedAt: null, nextScheduledAt: null }, meta: responseMeta(null, "unavailable") }, 503, { request });
    }
  }
  if (url.pathname === "/api/sources" && request.method === "GET") {
    const publicSources = sourcePanel.sources.map((entry) => {
      const source = { ...entry };
      delete source.domains;
      delete source.providerOutletName;
      delete source.samplePosition;
      return source;
    });
    return jsonResponse({ panelVersion: sourcePanel.panelVersion, panelLabel: sourcePanel.panelLabel, excludedMediaTypes: sourcePanel.excludedMediaTypes, method: sourcePanel.collectionProvider, directCrawling: false, sources: publicSources, meta: responseMeta(null, env?.DB ? "live_metadata" : "demo") }, 200, { request, etag: true, cacheControl: "public, max-age=3600, must-revalidate" });
  }
  if (url.pathname === "/api/articles" && request.method === "GET") return handleArticles(request, env);
  const rollbackMatch = url.pathname.match(/^\/api\/analysis\/runs\/([^/]+)\/rollback$/);
  if (rollbackMatch) return handleAnalysisRollback(request, decodeURIComponent(rollbackMatch[1]), env);
  if (url.pathname === "/api/analysis/runs" && request.method === "GET") return handleAnalysisRuns(request, env);
  if (url.pathname === "/api/quality" && request.method === "GET") return handleQualityQueue(request, env);
  if (url.pathname.startsWith("/api/quality/reviews/")) return handleQualityReview(request, decodeURIComponent(url.pathname.slice("/api/quality/reviews/".length)), env);
  if (url.pathname === "/api/issues" && request.method === "GET") return handleIssues(request, env);
  if (url.pathname.startsWith("/api/issues/") && request.method === "GET") return handleIssueDetail(request, decodeURIComponent(url.pathname.slice("/api/issues/".length)), env);
  if (url.pathname === "/api/observations/homepage") {
    if (request.method !== "POST") return jsonResponse({ error: "POST 요청만 허용됩니다." }, 405);
    return handleHomepageObservation(request, env);
  }
  if (url.pathname === "/api/content") {
    if (request.method !== "POST") return jsonResponse({ error: "POST 요청만 허용됩니다." }, 405);
    return handleContentUpload(request, env);
  }
  if (url.pathname === "/api/analyze/transient") {
    if (request.method === "GET") return handleTransientAnalysisStatus(request, env);
    if (request.method !== "POST") return jsonResponse({ error: "GET 또는 POST 요청만 허용됩니다." }, 405);
    return handleTransientAnalyze(request, env);
  }
  if (url.pathname === "/api/import") {
    if (request.method !== "POST") return jsonResponse({ error: "POST 요청만 허용됩니다." }, 405);
    return handleImport(request, env);
  }
  if (url.pathname === "/api/analyze") {
    if (request.method !== "POST") return jsonResponse({ error: "POST 요청만 허용됩니다." }, 405);
    return handleAnalyze(request, env);
  }
  return jsonResponse({ error: "API 경로를 찾지 못했습니다." }, 404);
}

const worker = {
  async fetch(request, env = {}) {
    const url = new URL(request.url);
    const apiResponse = await handleApiRequest(request, env);
    if (apiResponse) return apiResponse;

    if (!["GET", "HEAD"].includes(request.method)) {
      return new Response("Method not allowed", { status: 405, headers: { ...securityHeaders, allow: "GET, HEAD", "content-type": "text/plain; charset=utf-8" } });
    }
    const asset = assets[url.pathname];
    if (!asset) {
      return new Response("Not found", { status: 404, headers: { ...securityHeaders, "content-type": "text/plain; charset=utf-8" } });
    }
    return new Response(request.method === "HEAD" ? null : asset.body, {
      status: 200,
      headers: { ...securityHeaders, "content-type": asset.type, "cache-control": asset.cache },
    });
  },
};

export default worker;
