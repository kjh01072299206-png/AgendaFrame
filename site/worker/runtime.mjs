import { getAnalysisProvider } from "./analysis-provider.mjs";
import { CLUSTERING_VERSION, FRAME_TAXONOMY_VERSION, PUBLIC_AGENDA_CATEGORIES, SCORE_VERSION, cleanHeadlineToIssueTitle, extractBodyFrameSignals } from "./analysis.mjs";
import { ArticleExtractionError, extractArticleBody } from "./article-extractor.mjs";
import {
  AI_ARTICLE_FRAME_PROFILE_SCHEMA,
  ARTICLE_FRAME_PROFILE_SCHEMA,
  FRAMING_ENGINE_VERSION,
  ISSUE_FRAME_COMPARISON_SCHEMA,
  analyzeArticleFraming,
  buildIssueFrameComparison,
  validateArticleFrameProfile,
} from "./framing-engine.mjs";
import publicApiSchema from "../docs/public-api.schema.json" with { type: "json" };
import { handleCommunityRequest } from "./community.mjs";
import { handleEvidenceChat } from "./evidence-chat.mjs";
import { handleReleaseAdminRequest } from "./release-admin.mjs";

const analysisProvider = getAnalysisProvider();
const ANALYSIS_PROVIDER = analysisProvider.provider;
const ANALYSIS_MODEL_VERSION = analysisProvider.modelVersion;
const PUBLIC_API_SCHEMA_VERSION = publicApiSchema["x-api-version"];
const PROMPT_VERSION = "framing-codebook-v5";
const EVALUATION_DATASET_VERSION = "not_configured";
const COMPATIBLE_ANALYSIS_MODELS = new Set([ANALYSIS_MODEL_VERSION, "agenda-rules-v4", "agenda-rules-v3", "agenda-rules-v2"]);
const PUBLIC_AGENDA_CATEGORY_SET = new Set(PUBLIC_AGENDA_CATEGORIES);
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/;
const SEMANTIC_TEXT_SCOPES = new Set(["provider_export", "provider_excerpt", "transient_public_page_extract"]);

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

const ISSUE_SCOPE_KEYS = new Set(["all", "general_daily_10"]);

function resolveIssueScope(request) {
  const value = new URL(request.url).searchParams.get("scope");
  const key = value?.trim() || "all";
  if (!ISSUE_SCOPE_KEYS.has(key)) return null;
  if (key === "all") {
    const configuredCount = sourcePanel.sources.filter((source) => source.active).length || 22;
    return { key, sourceType: null, label: "전체 온라인 뉴스 표본", configuredCount, sourceNames: null };
  }
  const scopedSources = sourcePanel.sources.filter((source) => source.active && source.sourceType === "general_daily");
  return {
    key,
    sourceType: "general_daily",
    label: "국내 10대 종합일간지",
    configuredCount: scopedSources.length || 10,
    sourceNames: new Set(scopedSources.map((source) => source.name)),
  };
}

function comparisonOnlyUsesSources(value, allowedSources) {
  if (!allowedSources || !value || typeof value !== "object") return true;
  const seen = new Set();
  const visit = (node, key = "") => {
    if (typeof node === "string" && (key === "source" || key === "supportingOutlets")) seen.add(node);
    if (Array.isArray(node)) {
      for (const item of node) visit(item, key);
      return;
    }
    if (node && typeof node === "object") {
      for (const [childKey, child] of Object.entries(node)) visit(child, childKey);
    }
  };
  visit(value);
  return [...seen].every((source) => allowedSources.has(source));
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

function analysisVersions(run, comparisonLineage = null) {
  const modelVersion = run?.modelVersion ?? ANALYSIS_MODEL_VERSION;
  const current = modelVersion === ANALYSIS_MODEL_VERSION;
  const versionFour = modelVersion === "agenda-rules-v4";
  const approval = comparisonLineage?.approval ?? null;
  return {
    sourcePolicyVersion: sourcePanel.panelVersion ?? "unknown",
    clusteringVersion: current ? CLUSTERING_VERSION : versionFour ? "event-anchors-complete-link-v2" : "legacy-v1-unverified",
    scoreVersion: current ? SCORE_VERSION : versionFour ? "observed-agenda-v3" : "legacy-v1-unverified",
    frameTaxonomyVersion: current ? FRAME_TAXONOMY_VERSION : versionFour ? "frame-signals-v4" : "legacy-v1-unverified",
    modelId: comparisonLineage?.modelId ?? modelVersion,
    promptVersion: comparisonLineage?.promptVersion ?? (current ? PROMPT_VERSION : versionFour ? "not_applicable_rules" : "legacy-unverified"),
    analysisSchemaVersion: comparisonLineage?.analysisSchemaVersion ?? null,
    comparisonEngineVersion: comparisonLineage?.comparisonEngineVersion ?? null,
    authorizationId: approval?.authorizationId ?? null,
    approvalFingerprint: approval?.fingerprint ?? null,
    clusterId: approval?.clusterId ?? null,
    reviewer: approval?.reviewer ?? null,
    approvalReviewedAt: approval?.reviewedAt ?? null,
    approvedUrlsSha256: approval?.approvedUrlsSha256 ?? null,
    evaluationDatasetVersion: EVALUATION_DATASET_VERSION,
  };
}

function responseMeta(run = null, runtimeMode = "demo", comparisonLineage = null) {
  return {
    schemaVersion: PUBLIC_API_SCHEMA_VERSION,
    runtimeMode,
    snapshotId: run?.id ?? null,
    runId: run?.id ?? null,
    basisDate: run?.targetDate ?? null,
    publishedAt: run?.finishedAt ?? null,
    ...analysisVersions(run, comparisonLineage),
  };
}

function publicIssue(row, run, configuredSources = 22, preserveScore = false) {
  const placementObservedCount = Number(row.placementObservedCount ?? 0);
  const contentAvailableCount = Number(row.contentAvailableCount ?? 0);
  const structuredProfileCount = Number(row.structuredProfileCount ?? 0);
  const legacy = !COMPATIBLE_ANALYSIS_MODELS.has(run?.modelVersion);
  const issue = { ...row };
  delete issue.confidence;

  const cleanedTitle = cleanHeadlineToIssueTitle(row.representativeTitle || row.title);
  delete issue.representativeTitle;
  const sourceCount = Number(row.sourceCount ?? 1);
  const coverageRatio = sourceCount / Math.max(1, configuredSources);
  const coverageFactor = Math.min(1.0, 0.45 + coverageRatio * 0.8);
  const adjustedAgendaScore = preserveScore
    ? Math.round(Number(row.agendaScore ?? 0) * 10) / 10
    : Math.round(Number(row.agendaScore ?? 0) * coverageFactor * 10) / 10;
  const scoreUnavailable = legacy && !preserveScore;

  return {
    ...issue,
    title: cleanedTitle,
    agendaScore: scoreUnavailable ? null : adjustedAgendaScore,
    placementScore: placementObservedCount ? Number(row.placementScore) : null,
    placementObservedCount,
    placementTotalCount: Number(row.placementTotalCount ?? row.articleCount ?? 0),
    followUpVolumeScore: Number(row.repetitionScore ?? 0),
    scoreStatus: scoreUnavailable ? "legacy_reanalysis_required" : (preserveScore ? "scope_observed_components" : (placementObservedCount ? "observed_components" : "placement_excluded")),
    calibrationStatus: "not_calibrated",
    clusterQuality: scoreUnavailable ? "review_required" : "not_human_reviewed",
    contentAvailableCount,
    structuredProfileCount,
    evidenceBasis: structuredProfileCount
      ? "structured_body_profiles_and_metadata"
      : contentAvailableCount
        ? "body_signals_and_metadata"
        : "headline_metadata_only",
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
          AND taxonomy_version = ?
        UNION
        SELECT article_id
        FROM article_frame_profiles
        WHERE status IN ('analyzed', 'partial')
      )) AS body_evidence_count
  `).bind(
    FRAME_TAXONOMY_VERSION,
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

async function handleImport(
  request,
  env,
  { provider = "bigkinds_export", trigger = "manual" } = {},
) {
  if (!env?.DB) return jsonResponse({ error: "데이터 저장소가 아직 준비되지 않았습니다." }, 503);
  if (!env?.IMPORT_TOKEN && !env?.CODEX_IMPORT_TOKEN) return jsonResponse({ error: "관리자 가져오기가 아직 활성화되지 않았습니다." }, 503);

  if (!isSameSiteRequest(request, env)) {
    return jsonResponse({ error: "같은 사이트에서 보낸 요청만 허용됩니다." }, 403);
  }

  if (!(await adminAuthorized(request, env))) {
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
      VALUES (?, ?, ?, 'running', ?, 0, 0, 0)
    `).bind(runId, provider, trigger, startedAt).run();

    const articleIds = await Promise.all(rows.map((row) => sha256Hex(row.canonicalUrl)));
    const statements = rows.map((row, index) => db.prepare(`
      INSERT INTO articles
        (id, provider, external_id, source_id, title, canonical_url, section, published_at, collected_at, homepage_placement, homepage_rank)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      provider,
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
const ARTICLE_EXTRACTOR_VERSION = "public-news-body-v2";
const BIGKINDS_EXCERPT_EXTRACTOR_VERSION = "bigkinds-export-excerpt-v1";
const STRUCTURED_IMPORT_BATCH_LIMIT = 100;
const ANALYZED_IMPORT_BATCH_LIMIT = 50;
const GCP_ANALYZED_EXTRACTOR_VERSION = "gcp-authorized-body-v1";

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

export function validateStructuredImportRows(inputRows, panel = sourcePanel, now = new Date().toISOString()) {
  if (!Array.isArray(inputRows) || inputRows.length === 0) throw new Error("가져올 기사 행이 없습니다.");
  if (inputRows.length > STRUCTURED_IMPORT_BATCH_LIMIT) {
    throw new Error(`본문 발췌 분석은 한 번에 최대 ${STRUCTURED_IMPORT_BATCH_LIMIT}행까지 처리할 수 있습니다.`);
  }
  const metadataRows = inputRows.map((row) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) return row;
    const metadata = { ...row };
    delete metadata.excerpt;
    delete metadata.body_excerpt;
    delete metadata.text_scope;
    return metadata;
  });
  const validatedMetadata = validateImportRows(metadataRows, panel, now);
  return validatedMetadata.map((metadata, index) => {
    const input = inputRows[index];
    const excerpt = normalizeArticleBody(input.excerpt ?? input.body_excerpt);
    if (excerpt.length < 40 || excerpt.length > 5_000) {
      throw new Error(`${index + 1}행: 분석용 본문 발췌는 40~5,000자여야 합니다.`);
    }
    const textScope = String(input.text_scope ?? input.textScope ?? "provider_excerpt").trim();
    if (!["provider_excerpt", "transient_public_page_extract"].includes(textScope)) {
      throw new Error(`${index + 1}행: 본문 처리 범위를 확인해 주세요.`);
    }
    return {
      ...metadata,
      excerpt,
      textScope,
    };
  });
}

export function validateAnalyzedImportRows(inputRows, panel = sourcePanel, now = new Date().toISOString()) {
  if (!Array.isArray(inputRows) || inputRows.length === 0) throw new Error("가져올 분석 결과가 없습니다.");
  if (inputRows.length > ANALYZED_IMPORT_BATCH_LIMIT) {
    throw new Error(`GCP 분석 결과는 한 번에 최대 ${ANALYZED_IMPORT_BATCH_LIMIT}행까지 처리할 수 있습니다.`);
  }
  const metadata = validateImportRows(inputRows.map((row) => ({
    source: row?.article?.source_id,
    title: row?.article?.title,
    url: row?.article?.canonical_url,
    published_at: row?.article?.published_at,
    collected_at: row?.article?.collected_at,
    section: row?.article?.section,
  })), panel, now);
  return inputRows.map((row, index) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error(`${index + 1}행 형식이 올바르지 않습니다.`);
    const profile = structuredClone(row.profile);
    const bodyHash = String(row.article?.body_hash ?? "").toLowerCase();
    const bodyCharacters = Number(row.article?.body_characters);
    if (!/^[a-f0-9]{64}$/.test(bodyHash)) throw new Error(`${index + 1}행: 본문 해시를 확인해 주세요.`);
    if (!Number.isInteger(bodyCharacters) || bodyCharacters < 1 || bodyCharacters > 200_000) {
      throw new Error(`${index + 1}행: 본문 문자 수를 확인해 주세요.`);
    }
    if (profile?.schema_version !== AI_ARTICLE_FRAME_PROFILE_SCHEMA) {
      throw new Error(`${index + 1}행: 지원하지 않는 AI 분석 스키마입니다.`);
    }
    validateSemanticProfileLineage(profile, `${index + 1}번째 분석 프로필`);
    validateSemanticExtraction(profile, bodyCharacters, `${index + 1}번째 분석 프로필`);
    const upstreamArticleId = String(row.article?.article_id ?? "").trim();
    if (
      !upstreamArticleId
      || profile?.article?.article_id !== upstreamArticleId
      || profile?.article?.upstream_article_id !== upstreamArticleId
    ) {
      throw new Error(`${index + 1}행: 상류 기사 식별자와 분석 프로필이 일치하지 않습니다.`);
    }
    if (profile?.article?.body_sha256 !== bodyHash || Number(profile?.article?.body_character_count) !== bodyCharacters) {
      throw new Error(`${index + 1}행: 기사 정보와 분석 프로필의 본문 식별값이 다릅니다.`);
    }
    const validation = validateArticleFrameProfile(profile);
    if (!validation.valid) throw new Error(`${index + 1}행: 분석 프로필 검증 실패: ${validation.errors.join("; ")}`);
    return {
      metadata: metadata[index],
      bodyHash,
      bodyCharacters,
      profile,
    };
  });
}

async function handleAnalyzedImport(request, env) {
  if (!env?.DB) return jsonResponse({ error: "데이터 저장소가 아직 준비되지 않았습니다." }, 503, { request });
  if (!env?.IMPORT_TOKEN && !env?.CODEX_IMPORT_TOKEN) return jsonResponse({ error: "관리자 가져오기가 아직 활성화되지 않았습니다." }, 503, { request });
  if (request.headers.get("x-agendaframe-source") !== "gcp-batch-v1") {
    return jsonResponse({ error: "허용된 배치 게시자 요청이 아닙니다." }, 403, { request });
  }
  if (!(await adminAuthorized(request, env))) {
    return jsonResponse({ error: "관리자 토큰이 올바르지 않습니다." }, 401, { request });
  }

  let rows;
  try {
    const payload = await readJsonPayload(request, 4 * 1024 * 1024);
    rows = validateAnalyzedImportRows(payload.rows);
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "GCP 분석 결과 형식을 확인해 주세요." }, 400, { request });
  }

  const origin = new URL(request.url).origin;
  const metadataRequest = new Request(new URL("/api/import", request.url), {
    method: "POST",
    headers: {
      authorization: request.headers.get("authorization") ?? "",
      "content-type": "application/json",
      origin,
      "sec-fetch-site": "same-origin",
    },
    body: JSON.stringify({
      rows: rows.map(({ metadata }) => ({
        source: metadata.source.name,
        title: metadata.title,
        url: metadata.canonicalUrl,
        published_at: new Date(metadata.publishedAt).toISOString(),
        collected_at: new Date(metadata.collectedAt).toISOString(),
        section: metadata.section,
      })),
    }),
  });
  const metadataResponse = await handleImport(metadataRequest, env, {
    provider: "gcp_batch",
    trigger: "gcp_publish",
  });
  const metadataResult = await metadataResponse.json();
  if (!metadataResponse.ok) return jsonResponse(metadataResult, metadataResponse.status, { request });

  try {
    const lookups = await env.DB.batch(rows.map(({ metadata }) => env.DB.prepare(`
      SELECT id FROM articles WHERE canonical_url = ? LIMIT 1
    `).bind(metadata.canonicalUrl)));
    const analyzedAt = Date.now();
    const statements = rows.map((row, index) => {
      const articleId = lookups[index]?.results?.[0]?.id;
      if (!articleId) throw new Error("저장한 기사 식별자를 찾지 못했습니다.");
      const validation = validateArticleFrameProfile(row.profile);
      if (!validation.valid) throw new Error(`게시 직전 분석 프로필 검증 실패: ${validation.errors.join("; ")}`);
      const modelVersion = String(row.profile.engine?.version ?? "").slice(0, 120);
      const promptVersion = String(row.profile.engine?.prompt_version ?? "").slice(0, 120);
      if (!modelVersion || !promptVersion) throw new Error("모델과 프롬프트 버전이 필요합니다.");
      return env.DB.prepare(`
        INSERT INTO article_frame_profiles
          (id, article_id, body_hash, body_characters, profile_json, status, failure_code, extractor_version, provider, model_version, prompt_version, schema_version, review_status, analyzed_at)
        VALUES (?, ?, ?, ?, ?, 'analyzed', NULL, ?, 'vertex_ai', ?, ?, ?, 'automatic_draft', ?)
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
        articleId,
        row.bodyHash,
        row.bodyCharacters,
        JSON.stringify(row.profile),
        GCP_ANALYZED_EXTRACTOR_VERSION,
        modelVersion,
        promptVersion,
        AI_ARTICLE_FRAME_PROFILE_SCHEMA,
        analyzedAt,
      );
    });
    await runBatches(env.DB, statements);
    return jsonResponse({
      received: rows.length,
      saved: statements.length,
      metadata: metadataResult,
      bodyStorageCount: 0,
      schemaVersion: AI_ARTICLE_FRAME_PROFILE_SCHEMA,
      reviewStatus: "automatic_draft",
    }, 201, { request });
  } catch (error) {
    console.error("AgendaFrame analyzed import failed", error);
    return jsonResponse({ error: "분석 결과를 저장하지 못했습니다." }, 500, { request });
  }
}

async function handleStructuredImport(request, env) {
  if (!env?.DB) return jsonResponse({ error: "데이터 저장소가 아직 준비되지 않았습니다." }, 503, { request });
  if (!env?.IMPORT_TOKEN && !env?.CODEX_IMPORT_TOKEN) return jsonResponse({ error: "관리자 가져오기가 아직 활성화되지 않았습니다." }, 503, { request });
  if (!isSameSiteRequest(request, env)) return jsonResponse({ error: "같은 사이트에서 보낸 요청만 허용됩니다." }, 403, { request });
  if (!(await adminAuthorized(request, env))) return jsonResponse({ error: "관리자 토큰이 올바르지 않습니다." }, 401, { request });

  let rows;
  try {
    const payload = await readJsonPayload(request, 4 * 1024 * 1024);
    rows = validateStructuredImportRows(payload.rows);
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "본문 발췌 가져오기 형식을 확인해 주세요." }, 400, { request });
  }

  const forwardedHeaders = new Headers({ "content-type": "application/json" });
  for (const name of ["authorization", "origin", "sec-fetch-site"]) {
    const value = request.headers.get(name);
    if (value) forwardedHeaders.set(name, value);
  }
  const metadataRequest = new Request(new URL("/api/import", request.url), {
    method: "POST",
    headers: forwardedHeaders,
    body: JSON.stringify({
      rows: rows.map((row) => ({
        source: row.source.name,
        title: row.title,
        url: row.canonicalUrl,
        published_at: new Date(row.publishedAt).toISOString(),
        collected_at: new Date(row.collectedAt).toISOString(),
        section: row.section,
        homepage_placement: row.homepagePlacement,
        homepage_rank: row.homepageRank,
      })),
    }),
  });
  const metadataResponse = await handleImport(metadataRequest, env);
  const metadataResult = await metadataResponse.json();
  if (!metadataResponse.ok) return jsonResponse(metadataResult, metadataResponse.status, { request });

  try {
    const lookups = await env.DB.batch(rows.map((row) => env.DB.prepare(`
      SELECT id FROM articles WHERE canonical_url = ? LIMIT 1
    `).bind(row.canonicalUrl)));
    const analyzedAt = Date.now();
    const results = await mapWithConcurrency(rows, 6, async (row, index) => {
      const articleId = lookups[index]?.results?.[0]?.id;
      if (!articleId) throw new Error("저장한 기사 식별자를 찾지 못했습니다.");
      const signals = extractBodyFrameSignals(row.excerpt);
      const profile = await analyzeArticleFraming({
        articleId,
        title: row.title,
        bodyText: row.excerpt,
        publishedAt: new Date(row.publishedAt).toISOString(),
      });
      profile.extraction = {
        strategy: "bigkinds-export",
        quality: 1,
        text_scope: row.textScope,
        source_characters: row.excerpt.length,
        extractor_version: BIGKINDS_EXCERPT_EXTRACTOR_VERSION,
      };
      const validation = validateArticleFrameProfile(profile);
      if (!validation.valid) throw new Error(`구조화 분석 검증 실패: ${validation.errors.join("; ")}`);
      return {
        articleId,
        bodyHash: await sha256Hex(row.excerpt),
        bodyCharacters: signals.bodyCharacters,
        detectedFrames: signals.detectedFrames,
        profile,
      };
    });

    const statements = [];
    for (const result of results) {
      statements.push(env.DB.prepare(`
        INSERT INTO article_body_signals
          (id, article_id, body_hash, body_characters, detected_frames, status, failure_code, extractor_version, taxonomy_version, analyzed_at)
        VALUES (?, ?, ?, ?, ?, 'analyzed', NULL, ?, ?, ?)
        ON CONFLICT(article_id, extractor_version, taxonomy_version) DO UPDATE SET
          body_hash = excluded.body_hash,
          body_characters = excluded.body_characters,
          detected_frames = excluded.detected_frames,
          status = 'analyzed',
          failure_code = NULL,
          analyzed_at = excluded.analyzed_at
      `).bind(
        crypto.randomUUID(),
        result.articleId,
        result.bodyHash,
        result.bodyCharacters,
        JSON.stringify(result.detectedFrames),
        BIGKINDS_EXCERPT_EXTRACTOR_VERSION,
        FRAME_TAXONOMY_VERSION,
        analyzedAt,
      ));
      statements.push(env.DB.prepare(`
        INSERT INTO article_frame_profiles
          (id, article_id, body_hash, body_characters, profile_json, status, failure_code, extractor_version, provider, model_version, prompt_version, schema_version, review_status, analyzed_at)
        VALUES (?, ?, ?, ?, ?, 'analyzed', NULL, ?, 'structured_extractive', ?, ?, ?, 'automatic_draft', ?)
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
        result.articleId,
        result.bodyHash,
        result.bodyCharacters,
        JSON.stringify(result.profile),
        BIGKINDS_EXCERPT_EXTRACTOR_VERSION,
        FRAMING_ENGINE_VERSION,
        PROMPT_VERSION,
        ARTICLE_FRAME_PROFILE_SCHEMA,
        analyzedAt,
      ));
    }
    await runBatches(env.DB, statements);
    const textScope = rows.every((row) => row.textScope === "transient_public_page_extract")
      ? "transient_public_page_extract"
      : "provider_excerpt";
    return jsonResponse({
      ...metadataResult,
      analyzedExcerpts: results.length,
      textScope,
      rawTextStored: false,
      extractorVersion: BIGKINDS_EXCERPT_EXTRACTOR_VERSION,
      framingEngineVersion: FRAMING_ENGINE_VERSION,
    }, 201, { request });
  } catch (error) {
    console.error("AgendaFrame structured import failed", error);
    return jsonResponse({ error: "기사 메타데이터는 저장했지만 본문 발췌 구조화 분석을 완료하지 못했습니다." }, 500, { request });
  }
}

export function extractArticleBodyFromHtml(html) {
  return extractArticleBody(html).bodyText;
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
  if (error instanceof ArticleExtractionError) return error.code;
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

function parseFrameProfile(value) {
  try {
    const profile = JSON.parse(String(value ?? "{}"));
    if (!validateArticleFrameProfile(profile).valid) return null;
    if (profile.schema_version === AI_ARTICLE_FRAME_PROFILE_SCHEMA) {
      validateSemanticProfileLineage(profile, "저장된 분석 프로필");
      validateSemanticExtraction(profile, Number(profile.article?.body_character_count), "저장된 분석 프로필");
    }
    return profile;
  } catch {
    return null;
  }
}

async function loadArticleFrameProfiles(db, start, end) {
  const result = await db.prepare(`
    SELECT profiles.article_id AS articleId, profiles.profile_json AS profileJson
    FROM article_frame_profiles profiles
    JOIN articles a ON a.id = profiles.article_id
    WHERE a.published_at >= ? AND a.published_at < ?
      AND profiles.status IN ('analyzed', 'partial')
      AND profiles.review_status != 'rejected'
    ORDER BY
      profiles.article_id ASC,
      CASE profiles.provider WHEN 'vertex_ai' THEN 0 ELSE 1 END,
      profiles.analyzed_at DESC
  `).bind(start, end).all();
  const profiles = new Map();
  for (const row of result.results ?? []) {
    if (profiles.has(row.articleId)) continue;
    const profile = parseFrameProfile(row.profileJson);
    if (profile) {
      profile.article.upstream_article_id ??= profile.article.article_id;
      profile.article.article_id = row.articleId;
      profiles.set(row.articleId, profile);
    }
  }
  return profiles;
}

export function clusterArticleSignature(values) {
  if (!Array.isArray(values) || values.length < 2) return "";
  try {
    const normalized = uniqueStrings(values.map((value) => canonicalizeArticleUrl(value))).sort();
    return normalized.length >= 2 ? normalized.join("\n") : "";
  } catch {
    return "";
  }
}

export async function clusterArticleSetSha256(values) {
  const signature = clusterArticleSignature(values);
  return signature ? sha256Hex(signature) : "";
}

function requireLineageString(value, field, context) {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized.length > 200) {
    throw new Error(`${context}의 ${field} 값이 없거나 너무 깁니다.`);
  }
  return normalized;
}

function requireLineageHash(value, field, context) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!SHA256_HEX_PATTERN.test(normalized)) {
    throw new Error(`${context}의 ${field} 값은 소문자 SHA-256이어야 합니다.`);
  }
  return normalized;
}

function normalizePublicApproval(value, context) {
  if (!isPlainObject(value)) throw new Error(`${context}의 approval 객체가 필요합니다.`);
  const reviewedAtValue = requireLineageString(value.reviewed_at, "reviewed_at", context);
  const reviewedAt = new Date(reviewedAtValue);
  if (!Number.isFinite(reviewedAt.getTime())) {
    throw new Error(`${context}의 reviewed_at 값은 ISO-8601 시각이어야 합니다.`);
  }
  return {
    authorizationId: requireLineageString(value.authorization_id, "authorization_id", context),
    fingerprint: requireLineageHash(value.fingerprint, "fingerprint", context),
    clusterId: requireLineageString(value.cluster_id, "cluster_id", context),
    reviewer: requireLineageString(value.reviewer, "reviewer", context),
    reviewedAt: reviewedAt.toISOString(),
    approvedUrlsSha256: requireLineageHash(value.approved_urls_sha256, "approved_urls_sha256", context),
  };
}

function validateSemanticExtraction(profile, bodyCharacters, context = "semantic profile") {
  const extraction = profile?.extraction;
  if (!isPlainObject(extraction)) throw new Error(`${context}의 extraction 객체가 필요합니다.`);
  const textScope = String(extraction.text_scope ?? "").trim();
  const analyzedCharacters = Number(extraction.analyzed_character_count);
  const inputTruncated = extraction.input_truncated;
  if (!SEMANTIC_TEXT_SCOPES.has(textScope)) {
    throw new Error(`${context}의 text_scope가 승인된 값이 아닙니다.`);
  }
  if (!Number.isInteger(analyzedCharacters) || analyzedCharacters < 1 || analyzedCharacters > bodyCharacters) {
    throw new Error(`${context}의 analyzed_character_count가 본문 범위를 벗어났습니다.`);
  }
  if (typeof inputTruncated !== "boolean") {
    throw new Error(`${context}의 input_truncated는 boolean이어야 합니다.`);
  }
  if (!inputTruncated && analyzedCharacters !== bodyCharacters) {
    throw new Error(`${context}가 미절단 입력이라면 분석 문자 수와 본문 문자 수가 같아야 합니다.`);
  }
  if (inputTruncated && analyzedCharacters >= bodyCharacters) {
    throw new Error(`${context}가 절단 입력이라면 분석 문자 수가 본문 문자 수보다 작아야 합니다.`);
  }
  return { textScope, analyzedCharacters, inputTruncated };
}

function validateSemanticProfileLineage(profile, context = "semantic profile") {
  if (!isPlainObject(profile?.lineage)) throw new Error(`${context}의 lineage 객체가 필요합니다.`);
  const modelId = requireLineageString(profile.lineage.model_id, "model_id", context);
  const promptVersion = requireLineageString(profile.lineage.prompt_version, "prompt_version", context);
  const analysisSchemaVersion = requireLineageString(
    profile.lineage.analysis_schema_version,
    "analysis_schema_version",
    context,
  );
  const comparisonEngineVersion = requireLineageString(
    profile.lineage.comparison_engine_version,
    "comparison_engine_version",
    context,
  );
  if (modelId !== String(profile.engine?.version ?? "")) {
    throw new Error(`${context}의 model_id가 engine.version과 일치하지 않습니다.`);
  }
  if (promptVersion !== String(profile.engine?.prompt_version ?? "")) {
    throw new Error(`${context}의 prompt_version이 engine.prompt_version과 일치하지 않습니다.`);
  }
  if (analysisSchemaVersion !== String(profile.schema_version ?? "")) {
    throw new Error(`${context}의 analysis_schema_version이 profile.schema_version과 일치하지 않습니다.`);
  }
  if (comparisonEngineVersion !== FRAMING_ENGINE_VERSION) {
    throw new Error(`${context}의 comparison_engine_version이 현재 비교 엔진과 일치하지 않습니다.`);
  }
  return {
    modelId,
    promptVersion,
    analysisSchemaVersion,
    comparisonEngineVersion,
    approval: normalizePublicApproval(profile.lineage.approval, context),
  };
}

function profileAnalysisLineage(profile) {
  if (profile?.schema_version === AI_ARTICLE_FRAME_PROFILE_SCHEMA) {
    return validateSemanticProfileLineage(profile);
  }
  return {
    modelId: String(profile?.engine?.version ?? FRAMING_ENGINE_VERSION),
    promptVersion: "not_applicable_rules",
    analysisSchemaVersion: String(profile?.schema_version ?? ARTICLE_FRAME_PROFILE_SCHEMA),
    comparisonEngineVersion: FRAMING_ENGINE_VERSION,
    approval: null,
  };
}

function equalApproval(left, right) {
  return Boolean(left && right)
    && left.authorizationId === right.authorizationId
    && left.fingerprint === right.fingerprint
    && left.clusterId === right.clusterId
    && left.reviewer === right.reviewer
    && left.reviewedAt === right.reviewedAt
    && left.approvedUrlsSha256 === right.approvedUrlsSha256;
}

export async function approvedClusterApprovals(payload) {
  const clusters = payload?.approved_same_event_clusters;
  if (clusters === undefined) return new Map();
  if (!Array.isArray(clusters) || clusters.length > 20) {
    throw new Error("승인된 동일 사건 클러스터는 최대 20개의 배열이어야 합니다.");
  }
  const approvals = new Map();
  const clusterIds = new Set();
  for (const [index, cluster] of clusters.entries()) {
    const context = `${index + 1}번째 동일 사건 승인`;
    if (!isPlainObject(cluster)) {
      throw new Error(`${context}은 승인 지문을 포함한 객체여야 하며 URL 배열만으로는 승인할 수 없습니다.`);
    }
    const approvedUrls = cluster.approved_urls;
    if (!Array.isArray(approvedUrls) || approvedUrls.length < 2 || approvedUrls.length > 50) {
      throw new Error(`${context}의 approved_urls는 2~50개의 URL이어야 합니다.`);
    }
    let canonicalUrls;
    try {
      canonicalUrls = approvedUrls.map((value) => canonicalizeArticleUrl(value));
    } catch {
      throw new Error(`${context}의 approved_urls에 올바르지 않은 URL이 있습니다.`);
    }
    if (new Set(canonicalUrls).size !== canonicalUrls.length) {
      throw new Error(`${context}의 approved_urls에 중복 URL이 있습니다.`);
    }
    const signature = clusterArticleSignature(canonicalUrls);
    if (!signature) throw new Error(`${context}의 URL 집합을 확인해 주세요.`);
    const approval = normalizePublicApproval(cluster, context);
    const expectedHash = await sha256Hex(signature);
    if (approval.approvedUrlsSha256 !== expectedHash) {
      throw new Error(`${context}의 approved_urls_sha256이 정확한 URL 집합과 일치하지 않습니다.`);
    }
    if (approvals.has(signature)) throw new Error(`${context}의 URL 집합이 중복 승인되었습니다.`);
    if (clusterIds.has(approval.clusterId)) throw new Error(`${context}의 cluster_id가 중복되었습니다.`);
    approvals.set(signature, { ...approval, approvedUrls: signature.split("\n") });
    clusterIds.add(approval.clusterId);
  }
  return approvals;
}

export function resolveClusterApproval(issueUrls, profiles, approvals) {
  const signature = clusterArticleSignature(issueUrls);
  const approval = signature && approvals instanceof Map ? approvals.get(signature) ?? null : null;
  const semanticProfiles = profiles.filter((profile) => profile?.schema_version === AI_ARTICLE_FRAME_PROFILE_SCHEMA);
  if (!approval && semanticProfiles.length) {
    throw new Error("Semantic analysis profiles require an approval object bound to the exact issue URL set.");
  }
  if (!approval) return null;
  if (!profiles.length) throw new Error("The approved issue URL set has no usable analysis profiles.");
  for (const profile of profiles) {
    const lineage = profileAnalysisLineage(profile);
    if (!equalApproval(lineage.approval, approval)) {
      throw new Error("The analysis profile approval lineage does not match the exact issue approval.");
    }
  }
  return approval;
}

function comparisonAnalysisLineage(profiles, approval = null) {
  if (!profiles.length) throw new Error("At least one analysis profile is required for comparison lineage.");
  const lineages = profiles.map(profileAnalysisLineage);
  const first = lineages[0];
  for (const lineage of lineages.slice(1)) {
    if (
      lineage.modelId !== first.modelId
      || lineage.promptVersion !== first.promptVersion
      || lineage.analysisSchemaVersion !== first.analysisSchemaVersion
      || lineage.comparisonEngineVersion !== first.comparisonEngineVersion
    ) {
      throw new Error("A comparison cannot publish mixed model, prompt, schema, or comparison-engine lineage.");
    }
  }
  return {
    modelId: first.modelId,
    promptVersion: first.promptVersion,
    analysisSchemaVersion: first.analysisSchemaVersion,
    comparisonEngineVersion: first.comparisonEngineVersion,
    approval: approval ? {
      authorizationId: approval.authorizationId,
      fingerprint: approval.fingerprint,
      clusterId: approval.clusterId,
      reviewer: approval.reviewer,
      reviewedAt: approval.reviewedAt,
      approvedUrlsSha256: approval.approvedUrlsSha256,
    } : null,
  };
}

function withheldClusterReviewComparison(profiles, issue, articleMetadata) {
  const outlets = new Set(articleMetadata.map((article) => article.sourceId ?? article.source));
  const mediaGroups = new Set(
    articleMetadata.map((article) => article.mediaGroupId ?? article.sourceId ?? article.source),
  );
  return {
    lineage: comparisonAnalysisLineage(profiles),
    status: "withheld_insufficient_evidence",
    divergenceDetected: false,
    evidenceBasis: profiles.length ? "evidence_spans" : "headline_metadata_only",
    reason: "자동 사건 군집의 동일성 검토가 끝나지 않아 매체 간 프레이밍 비교를 보류했습니다.",
    methodologyLabel: "동일 사건 확인 대기",
    reviewStatus: "cluster_review_required",
    summary: {
      commonGround: null,
      mainDifference: "서로 다른 사건이나 후속 반응이 섞였을 가능성을 먼저 확인해야 합니다.",
      whyItMatters: "사건 단위가 다르면 기사 내용의 차이를 언론사 프레임 차이로 잘못 읽을 수 있습니다.",
      sourceContext: null,
    },
    sample: {
      analyzedArticles: profiles.length,
      textScope: profiles.some((profile) => profile.extraction?.text_scope === "provider_excerpt")
        ? "provider_excerpt"
        : "article_body",
      outlets: outlets.size,
      independentMediaGroups: mediaGroups.size,
      excludedArticles: Math.max(0, Number(issue.articleCount ?? 0) - profiles.length),
      inputTruncatedArticles: profiles.filter((profile) => profile.extraction?.input_truncated === true).length,
    },
    axes: [],
    issueMap: {
      status: "withheld_review_required",
      reason: "동일 사건 검토가 끝나지 않아 쟁점 지도 계산을 보류했습니다.",
      axisId: null,
      dimension: "problem_definition",
      label: "문제 정의",
      leftAnchor: null,
      rightAnchor: null,
      selectionBasis: {
        minimumArticles: 4,
        minimumOutlets: 3,
        minimumIndependentMediaGroups: 2,
        minimumArticlesPerAnchor: 2,
        articleCount: profiles.length,
        outletCount: outlets.size,
        independentMediaGroups: mediaGroups.size,
        balancedCoverage: null,
        overlap: null,
        axisStrength: null,
        coveredArticleCount: 0,
        formula: null,
      },
      outlets: [],
    },
    narratives: [],
    readerQuestions: [],
    sourceLens: {
      sharedVoices: [],
      voicesPresentInSomeOutlets: [],
      byOutlet: [],
      caution: null,
    },
    contextGaps: [],
    limitations: [
      "동일 사건으로 사람 검토가 완료되기 전에는 매체 간 차이를 공개하지 않습니다.",
      "기사 메타데이터와 원문 링크는 계속 확인할 수 있습니다.",
    ],
  };
}

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.trim()).map((value) => value.trim()))];
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isStringArray(value, { nonEmpty = false } = {}) {
  return Array.isArray(value)
    && (!nonEmpty || value.length > 0)
    && value.every(isNonEmptyString);
}

function isFiniteRange(value, minimum, maximum) {
  return typeof value === "number"
    && Number.isFinite(value)
    && value >= minimum
    && value <= maximum;
}

function isPublicClaimEvidence(value) {
  return isPlainObject(value)
    && isNonEmptyString(value.claimId)
    && isNonEmptyString(value.articleId)
    && isNonEmptyString(value.source)
    && isNonEmptyString(value.sourceUrl)
    && (value.evidenceLocator === null || isNonEmptyString(value.evidenceLocator))
    && (value.evidenceHash === null || SHA256_HEX_PATTERN.test(String(value.evidenceHash)))
    && (value.voiceKind === null || isNonEmptyString(value.voiceKind));
}

function isPublicEvidenceList(value, claimIds, { nonEmpty = false } = {}) {
  return Array.isArray(value)
    && (!nonEmpty || value.length > 0)
    && value.every((evidence) => isPublicClaimEvidence(evidence) && claimIds.includes(evidence.claimId));
}

function isPublicNarrativeClause(value) {
  if (value === null) return true;
  if (!isPlainObject(value)
    || !isNonEmptyString(value.dimension)
    || !isNonEmptyString(value.label)
    || !isNonEmptyString(value.groupId)
    || !isNonEmptyString(value.summary)
    || !Number.isInteger(value.supportingArticleCount)
    || value.supportingArticleCount < 2
    || !Number.isInteger(value.observedArticleCount)
    || value.observedArticleCount < value.supportingArticleCount
    || !isFiniteRange(value.supportShare, 0.6, 1)
    || !isStringArray(value.claimIds, { nonEmpty: true })) return false;
  return isPublicEvidenceList(value.evidence, value.claimIds, { nonEmpty: true });
}

function isPublicIssueMapAnchor(value) {
  if (!isPlainObject(value)
    || !isNonEmptyString(value.groupId)
    || !isNonEmptyString(value.label)
    || !(value.frameFamily === null || isNonEmptyString(value.frameFamily))
    || !Number.isInteger(value.articleCount)
    || value.articleCount < 2
    || !Number.isInteger(value.outletCount)
    || value.outletCount < 1
    || !Number.isInteger(value.independentMediaGroups)
    || value.independentMediaGroups < 1
    || !isStringArray(value.claimIds, { nonEmpty: true })) return false;
  return isPublicEvidenceList(value.evidence, value.claimIds, { nonEmpty: true });
}

function isPublicIssueMap(value) {
  if (!isPlainObject(value)
    || !["available", "provisional", "withheld_insufficient_evidence", "withheld_source_dominated", "withheld_review_required"].includes(value.status)
    || !isNonEmptyString(value.reason)
    || !(value.axisId === null || isNonEmptyString(value.axisId))
    || value.dimension !== "problem_definition"
    || !isNonEmptyString(value.label)
    || !isPlainObject(value.selectionBasis)
    || !Array.isArray(value.outlets)) return false;
  const selection = value.selectionBasis;
  for (const field of ["minimumArticles", "minimumOutlets", "minimumIndependentMediaGroups", "minimumArticlesPerAnchor", "articleCount", "outletCount", "independentMediaGroups", "coveredArticleCount"]) {
    if (!Number.isInteger(selection[field]) || selection[field] < 0) return false;
  }
  for (const field of ["balancedCoverage", "overlap", "axisStrength"]) {
    if (!(selection[field] === null || isFiniteRange(selection[field], 0, 1))) return false;
  }
  if (!(selection.formula === null || isNonEmptyString(selection.formula))) return false;
  const available = ["available", "provisional"].includes(value.status);
  if (available) {
    if (!isNonEmptyString(value.axisId)
      || !isPublicIssueMapAnchor(value.leftAnchor)
      || !isPublicIssueMapAnchor(value.rightAnchor)) return false;
  } else if (value.axisId !== null || value.leftAnchor !== null || value.rightAnchor !== null || value.outlets.length) {
    return false;
  }
  return value.outlets.every((outlet) => {
    if (!isPlainObject(outlet)
      || !isNonEmptyString(outlet.sourceId)
      || !isNonEmptyString(outlet.source)
      || !["left", "mixed", "right", "insufficient"].includes(outlet.classification)
      || !(outlet.score === null || isFiniteRange(outlet.score, -1, 1))
      || !(outlet.displayPosition === null || isFiniteRange(outlet.displayPosition, 10, 90))
      || !["insufficient", "single_article_observation", "automatic_draft", "supported"].includes(outlet.evidenceStatus)
      || !isStringArray(outlet.claimIds)) return false;
    for (const field of ["articleCount", "eligibleArticleCount", "leftArticleCount", "mixedArticleCount", "rightArticleCount"]) {
      if (!Number.isInteger(outlet[field]) || outlet[field] < 0) return false;
    }
    return isPublicEvidenceList(outlet.evidence, outlet.claimIds);
  });
}

function isPublicNarrative(value) {
  if (!isPlainObject(value)
    || !isNonEmptyString(value.narrativeId)
    || !["automatic_draft", "supported"].includes(value.status)
    || !isNonEmptyString(value.summary)
    || !Number.isInteger(value.articleCount)
    || value.articleCount < 2
    || !Number.isInteger(value.outletCount)
    || value.outletCount < 1
    || !Number.isInteger(value.independentMediaGroups)
    || value.independentMediaGroups < 1
    || !isFiniteRange(value.completeness, 0.6, 1)
    || !isStringArray(value.supportingArticleIds, { nonEmpty: true })
    || !isStringArray(value.supportingOutlets, { nonEmpty: true })
    || !isStringArray(value.claimIds, { nonEmpty: true })
    || !isPublicEvidenceList(value.evidence, value.claimIds, { nonEmpty: true })
    || !isPublicNarrativeClause(value.problem)
    || value.problem === null) return false;
  return [value.cause, value.responsibility, value.evaluation, value.remedy]
    .every(isPublicNarrativeClause);
}

function isPublicReaderQuestion(value) {
  if (!isPlainObject(value)
    || !isNonEmptyString(value.questionId)
    || !["narrative_contrast", "issue_axis_contrast", "affected_voice_gap", "source_voice_gap", "context_gap"].includes(value.triggerType)
    || !isNonEmptyString(value.question)
    || !isStringArray(value.basisClaimIds, { nonEmpty: true })
    || !isStringArray(value.basisArticleIds, { nonEmpty: true })) return false;
  return isPublicEvidenceList(value.evidence, value.basisClaimIds, { nonEmpty: true });
}

function isStructuredComparisonPayload(value) {
  if (!isPlainObject(value)) return false;
  if (!isPlainObject(value.lineage)
    || !isNonEmptyString(value.lineage.modelId)
    || !isNonEmptyString(value.lineage.promptVersion)
    || !isNonEmptyString(value.lineage.analysisSchemaVersion)
    || !isNonEmptyString(value.lineage.comparisonEngineVersion)) return false;
  if (value.lineage.approval !== null) {
    const approval = value.lineage.approval;
    if (!isPlainObject(approval)
      || !isNonEmptyString(approval.authorizationId)
      || !isNonEmptyString(approval.clusterId)
      || !isNonEmptyString(approval.reviewer)
      || !isNonEmptyString(approval.reviewedAt)
      || !Number.isFinite(Date.parse(approval.reviewedAt))
      || !SHA256_HEX_PATTERN.test(String(approval.fingerprint ?? ""))
      || !SHA256_HEX_PATTERN.test(String(approval.approvedUrlsSha256 ?? ""))) return false;
  }
  if (!["available", "partial", "withheld_insufficient_evidence"].includes(value.status)) return false;
  if (typeof value.divergenceDetected !== "boolean" || !isPlainObject(value.summary) || !isPlainObject(value.sample)) return false;
  if (!["provider_excerpt", "article_body"].includes(value.sample.textScope)) return false;
  for (const field of ["analyzedArticles", "outlets", "independentMediaGroups", "excludedArticles", "inputTruncatedArticles"]) {
    if (!Number.isInteger(value.sample[field]) || value.sample[field] < 0) return false;
  }
  if (value.sample.inputTruncatedArticles > value.sample.analyzedArticles) return false;
  if (!Array.isArray(value.axes)
    || !isPublicIssueMap(value.issueMap)
    || !Array.isArray(value.narratives)
    || value.narratives.length > 2
    || !value.narratives.every(isPublicNarrative)
    || !Array.isArray(value.readerQuestions)
    || value.readerQuestions.length > 3
    || !value.readerQuestions.every(isPublicReaderQuestion)
    || !isPlainObject(value.sourceLens)
    || !Array.isArray(value.contextGaps)
    || !Array.isArray(value.limitations)) return false;
  if (!isStringArray(value.sourceLens.sharedVoices)
    || !isStringArray(value.sourceLens.voicesPresentInSomeOutlets)
    || !Array.isArray(value.sourceLens.byOutlet)
    || !(value.sourceLens.caution === null || isNonEmptyString(value.sourceLens.caution))) return false;
  if (!value.axes.every((axis) => isPlainObject(axis) && isNonEmptyString(axis.dimension) && isNonEmptyString(axis.label)
    && Array.isArray(axis.variants) && axis.variants.every((variant) => isPlainObject(variant)
      && isNonEmptyString(variant.groupId)
      && (variant.frameFamily === null || isNonEmptyString(variant.frameFamily))
      && isStringArray(variant.claimIds, { nonEmpty: true })
      && isNonEmptyString(variant.summary)
      && Array.isArray(variant.outlets)
      && variant.outlets.every((outlet) => isPlainObject(outlet)
        && isNonEmptyString(outlet.source)
        && isNonEmptyString(outlet.articleId)
        && isNonEmptyString(outlet.sourceUrl)
        && isNonEmptyString(outlet.claimId)
        && variant.claimIds.includes(outlet.claimId))))) return false;
  if (!value.sourceLens.byOutlet.every((entry) => {
    if (!isPlainObject(entry)
      || !isNonEmptyString(entry.source)
      || !Number.isInteger(entry.articleCount)
      || entry.articleCount < 0
      || !Number.isInteger(entry.sourceArticleCount)
      || entry.sourceArticleCount < 0
      || entry.sourceArticleCount > entry.articleCount
      || !isStringArray(entry.voices)
      || !Array.isArray(entry.roleCounts)
      || !(entry.officialShare === null || isFiniteRange(entry.officialShare, 0, 1))
      || typeof entry.affectedGroupVoice !== "boolean"
      || !isFiniteRange(entry.affectedGroupPresenceRate, 0, 1)) return false;
    return entry.roleCounts.every((role) => isPlainObject(role)
      && isNonEmptyString(role.role)
      && isNonEmptyString(role.roleLabel)
      && Number.isInteger(role.count)
      && role.count > 0
      && role.count === role.articleCount
      && isFiniteRange(role.presenceRate, 0, 1)
      && Number.isInteger(role.directQuoteArticleCount)
      && role.directQuoteArticleCount >= 0
      && Number.isInteger(role.indirectAttributionArticleCount)
      && role.indirectAttributionArticleCount >= 0
      && Number.isInteger(role.mentionCount)
      && role.mentionCount >= 0);
  })) return false;
  if (!value.contextGaps.every((gap) => isPlainObject(gap)
    && isNonEmptyString(gap.feature)
    && isStringArray(gap.presentInOutlets)
    && isStringArray(gap.notObservedInOutlets)
    && isNonEmptyString(gap.displayText))) return false;
  if (!value.limitations.every(isNonEmptyString)) return false;
  return !/"(?:raw_body|rawBody|body_text|bodyText|sentence_text|sentenceText|quote|quotation|excerpt|html|content)"\s*:/i.test(JSON.stringify(value));
}

function publicComparisonFromEngine(rawComparison, profiles, issueArticles, { issueArticleCount = issueArticles.length, approval = null } = {}) {
  const articleById = new Map(issueArticles.map((article) => [String(article.id), article]));
  const profileById = new Map(profiles.map((profile) => [String(profile.article.article_id), profile]));
  const publicEvidence = (entry) => {
    const article = articleById.get(String(entry?.article_id));
    if (!article) return null;
    const locator = entry?.locator;
    return {
      claimId: String(entry.claim_id ?? ""),
      articleId: String(article.id),
      source: String(article.source),
      sourceUrl: String(article.url ?? article.canonicalUrl),
      evidenceLocator: locator ? `${locator.paragraph}문단 ${locator.sentence}문장` : null,
      evidenceHash: entry?.sentence_sha256 ?? null,
      voiceKind: entry?.voice_kind ?? null,
    };
  };
  const publicEvidenceList = (entries) => {
    const seen = new Set();
    return (entries ?? []).flatMap((entry) => {
      const evidence = publicEvidence(entry);
      if (!evidence) return [];
      const key = `${evidence.articleId}:${evidence.claimId}:${evidence.evidenceHash}`;
      if (seen.has(key)) return [];
      seen.add(key);
      return [evidence];
    });
  };
  const publicAnchor = (anchor) => anchor ? {
    groupId: anchor.group_id,
    label: anchor.label,
    frameFamily: anchor.frame_family,
    articleCount: Number(anchor.article_count ?? 0),
    outletCount: Number(anchor.outlet_count ?? 0),
    independentMediaGroups: Number(anchor.independent_media_group_count ?? 0),
    claimIds: anchor.claim_ids ?? [],
    evidence: publicEvidenceList(anchor.evidence),
  } : null;
  const publicClause = (clause) => clause ? {
    dimension: clause.dimension,
    label: clause.label,
    groupId: clause.group_id,
    summary: clause.summary,
    supportingArticleCount: Number(clause.supporting_article_count ?? 0),
    observedArticleCount: Number(clause.observed_article_count ?? 0),
    supportShare: Number(clause.support_share ?? 0),
    claimIds: clause.claim_ids ?? [],
    evidence: publicEvidenceList(clause.evidence),
  } : null;
  const rawAxes = rawComparison.comparison_axes ?? [];
  const divergenceDetected = rawComparison.summary_30_seconds?.divergence_detected === true;
  const axes = rawAxes
    .map((axis) => ({
      dimension: axis.dimension,
      label: axis.label,
      variants: (axis.patterns ?? []).slice(0, 6).map((pattern) => {
        const outlets = [];
        const seen = new Set();
        for (const articleId of pattern.article_ids ?? []) {
          const article = articleById.get(String(articleId));
          if (!article) continue;
          const key = `${article.source}:${article.id}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const articleEvidence = (pattern.evidence ?? []).find((entry) => String(entry.article_id) === String(articleId));
          const locator = articleEvidence?.locator;
          outlets.push({
            source: article.source,
            articleId: article.id,
            sourceUrl: article.url,
            claimId: articleEvidence?.claim_id ?? null,
            evidenceLocator: locator ? `${locator.paragraph}문단 ${locator.sentence}문장` : null,
            evidenceHash: articleEvidence?.sentence_sha256 ?? null,
            voiceKind: articleEvidence?.voice_kind ?? null,
          });
        }
        return {
          groupId: pattern.variant_key,
          frameFamily: pattern.frame_family ?? null,
          claimIds: pattern.claim_ids ?? [],
          summary: pattern.public_paraphrase,
          outlets,
          commitment: pattern.voice_scope === "outlet_narration" ? "explicit" : "source_attributed",
          status: pattern.voice_scope === "outlet_narration" ? "supported" : "attributed_source",
          evidenceLocator: null,
          basis: "기사별 본문 위치·해시 확인 · 원문 문장 미저장",
        };
      }),
    }))
    .filter((axis) => axis.variants.length);

  const rawIssueMap = rawComparison.issue_map ?? {};
  const issueMap = {
    status: rawIssueMap.status ?? "withheld_insufficient_evidence",
    reason: rawIssueMap.reason ?? "쟁점 지도 계산 결과가 없습니다.",
    axisId: rawIssueMap.axis_id ?? null,
    dimension: rawIssueMap.dimension ?? "problem_definition",
    label: rawIssueMap.label ?? "문제 정의",
    leftAnchor: publicAnchor(rawIssueMap.left_anchor),
    rightAnchor: publicAnchor(rawIssueMap.right_anchor),
    selectionBasis: {
      minimumArticles: Number(rawIssueMap.selection_basis?.minimum_articles ?? 4),
      minimumOutlets: Number(rawIssueMap.selection_basis?.minimum_outlets ?? 3),
      minimumIndependentMediaGroups: Number(rawIssueMap.selection_basis?.minimum_independent_media_groups ?? 2),
      minimumArticlesPerAnchor: Number(rawIssueMap.selection_basis?.minimum_articles_per_anchor ?? 2),
      articleCount: Number(rawIssueMap.selection_basis?.article_count ?? profiles.length),
      outletCount: Number(rawIssueMap.selection_basis?.outlet_count ?? 0),
      independentMediaGroups: Number(rawIssueMap.selection_basis?.independent_media_group_count ?? 0),
      balancedCoverage: rawIssueMap.selection_basis?.balanced_coverage ?? null,
      overlap: rawIssueMap.selection_basis?.overlap ?? null,
      axisStrength: rawIssueMap.selection_basis?.axis_strength ?? null,
      coveredArticleCount: Number(rawIssueMap.selection_basis?.covered_article_count ?? 0),
      formula: rawIssueMap.selection_basis?.formula ?? null,
    },
    outlets: (rawIssueMap.outlets ?? []).map((outlet) => ({
      sourceId: outlet.source_id,
      source: outlet.source,
      classification: outlet.classification,
      score: outlet.score,
      displayPosition: outlet.display_position,
      articleCount: Number(outlet.article_count ?? 0),
      eligibleArticleCount: Number(outlet.eligible_article_count ?? 0),
      leftArticleCount: Number(outlet.left_article_count ?? 0),
      mixedArticleCount: Number(outlet.mixed_article_count ?? 0),
      rightArticleCount: Number(outlet.right_article_count ?? 0),
      evidenceStatus: outlet.evidence_status,
      claimIds: outlet.claim_ids ?? [],
      evidence: publicEvidenceList(outlet.evidence),
    })),
  };
  const narratives = (rawComparison.narratives ?? []).map((narrative) => ({
    narrativeId: narrative.narrative_id,
    status: narrative.status,
    summary: narrative.summary,
    articleCount: Number(narrative.article_count ?? 0),
    outletCount: Number(narrative.outlet_count ?? 0),
    independentMediaGroups: Number(narrative.independent_media_group_count ?? 0),
    completeness: Number(narrative.completeness ?? 0),
    supportingArticleIds: narrative.supporting_article_ids ?? [],
    supportingOutlets: narrative.supporting_outlets ?? [],
    claimIds: narrative.claim_ids ?? [],
    evidence: publicEvidenceList(narrative.evidence),
    problem: publicClause(narrative.problem),
    cause: publicClause(narrative.cause),
    responsibility: publicClause(narrative.responsibility),
    evaluation: publicClause(narrative.evaluation),
    remedy: publicClause(narrative.remedy),
  }));
  const readerQuestions = (rawComparison.reader_questions ?? []).map((question) => ({
    questionId: question.question_id,
    triggerType: question.trigger_type,
    question: question.question,
    basisClaimIds: question.basis_claim_ids ?? [],
    basisArticleIds: question.basis_article_ids ?? [],
    evidence: publicEvidenceList(question.evidence),
  }));

  const sample = rawComparison.sample ?? {};
  const analyzedOutletCount = Number(sample.outlet_count ?? 0);
  const sourceRoles = rawComparison.source_lens?.roles ?? [];
  const sharedVoices = sourceRoles
    .filter((role) => analyzedOutletCount >= 2 && Number(role.outlet_count) >= analyzedOutletCount)
    .map((role) => role.role_label);
  const voicesPresentInSomeOutlets = sourceRoles
    .filter((role) => Number(role.outlet_count) > 0 && Number(role.outlet_count) < Math.max(2, analyzedOutletCount))
    .map((role) => role.role_label);
  const rawByOutlet = new Map((rawComparison.source_lens?.by_outlet ?? []).map((entry) => [entry.outlet, entry]));
  const profileOutlets = uniqueStrings(profiles.map((profile) => {
    const article = articleById.get(String(profile.article.article_id));
    return article?.source;
  }));
  const byOutlet = profileOutlets.map((outlet) => {
    const entry = rawByOutlet.get(outlet) ?? { outlet, roles: [] };
    const counts = entry.roles ?? [];
    return {
      source: entry.outlet,
      articleCount: Number(entry.article_count ?? 0),
      sourceArticleCount: Number(entry.source_article_count ?? 0),
      voices: uniqueStrings(counts.map((role) => role.role_label)),
      roleCounts: counts
        .map((role) => ({
          role: String(role.role),
          roleLabel: String(role.role_label ?? role.role),
          count: Number(role.article_count ?? role.count ?? 0),
          articleCount: Number(role.article_count ?? role.count ?? 0),
          presenceRate: Number(role.presence_rate ?? 0),
          directQuoteArticleCount: Number(role.direct_quote_article_count ?? 0),
          indirectAttributionArticleCount: Number(role.indirect_attribution_article_count ?? 0),
          mentionCount: Number(role.mention_count ?? role.count ?? 0),
        }))
        .filter((role) => role.articleCount > 0)
        .sort((a, b) => b.articleCount - a.articleCount || a.role.localeCompare(b.role)),
      officialShare: entry.official_share ?? null,
      affectedGroupVoice: Number(entry.affected_group_presence_rate ?? 0) > 0,
      affectedGroupPresenceRate: Number(entry.affected_group_presence_rate ?? 0),
    };
  });

  const contextGaps = rawAxes.flatMap((axis) => {
    const presentInOutlets = [];
    const notObservedInOutlets = [];
    for (const article of issueArticles) {
      const result = profileById.get(String(article.id))?.dimensions?.[axis.dimension];
      if (!result) continue;
      const bucket = result.status === "not_observed" ? notObservedInOutlets : presentInOutlets;
      bucket.push(article.source);
    }
    const present = uniqueStrings(presentInOutlets);
    const absent = uniqueStrings(notObservedInOutlets);
    if (!present.length || !absent.length) return [];
    return [{
      feature: axis.label,
      presentInOutlets: present,
      notObservedInOutlets: absent,
      displayText: `${absent.join("·")}의 분석 대상 본문에서는 ${axis.label} 요소가 확인되지 않았습니다. 이는 의도적 누락을 뜻하지 않습니다.`,
    }];
  });

  const independentGroups = Number(sample.independent_media_group_count ?? 0);
  const usableProfiles = profiles.length;
  const hasComparableSample = usableProfiles >= 2 && independentGroups >= 2 && axes.some((axis) => axis.variants.length);
  const hasComparison = hasComparableSample && divergenceDetected;
  const status = hasComparison ? "available" : usableProfiles ? "partial" : "withheld_insufficient_evidence";
  const limitations = [
    "자동 구조화 분석이며 사람 검토 전입니다.",
    "규칙으로 명시적으로 관측된 설명만 표시하며, 문맥상 암시는 보수적으로 유보합니다.",
    "취재원 발언은 매체 자체의 주장과 분리해 표시합니다.",
    "표본 본문에서 확인되지 않은 요소는 실제 부재나 의도적 누락을 뜻하지 않습니다.",
  ];
  const providerExcerptCount = profiles.filter((profile) => profile.extraction?.text_scope === "provider_excerpt").length;
  const inputTruncatedCount = profiles.filter((profile) => profile.extraction?.input_truncated === true).length;
  if (providerExcerptCount) {
    limitations.unshift(`BigKinds가 제공한 본문 발췌 ${providerExcerptCount}건을 분석했습니다. 기사 전문 전체를 분석한 결과가 아닙니다.`);
  }
  if (inputTruncatedCount) {
    limitations.unshift(`모델 입력 한도로 본문 일부만 분석한 기사 ${inputTruncatedCount}건이 포함되었습니다.`);
  }
  const excluded = Math.max(0, Number(issueArticleCount) - usableProfiles);
  if (excluded) limitations.push(`본문을 확보·검증하지 못한 기사 ${excluded}건은 구조화 비교에서 제외했습니다.`);

  return {
    lineage: comparisonAnalysisLineage(profiles, approval),
    status,
    divergenceDetected,
    evidenceBasis: usableProfiles ? "evidence_spans" : "headline_metadata_only",
    reason: hasComparison
      ? "기사별 근거 위치를 먼저 확인한 뒤 같은 사건 안에서 서로 다른 미디어그룹의 설명 구조를 비교했습니다."
      : hasComparableSample
        ? "본문 구조는 비교했지만 서로 다른 미디어그룹의 설명이 갈렸다고 확정할 배타적 근거는 확인되지 않았습니다."
        : "서로 독립적인 매체의 본문 근거가 충분하지 않아 가능한 항목만 표시합니다.",
    methodologyLabel: "문제·원인·책임·평가·해법",
    reviewStatus: "automatic_draft",
    summary: {
      commonGround: rawComparison.summary_30_seconds?.common_ground ?? null,
      mainDifference: rawComparison.summary_30_seconds?.main_difference ?? null,
      whyItMatters: "문제 정의와 취재원 구성이 달라지면 같은 사건에서 주목하는 원인·책임·해법도 달라질 수 있습니다.",
      sourceContext: rawComparison.summary_30_seconds?.source_context ?? null,
    },
    sample: {
      analyzedArticles: Number(sample.body_evidence_article_count ?? usableProfiles),
      textScope: providerExcerptCount ? "provider_excerpt" : "article_body",
      outlets: Number(sample.outlet_count ?? new Set(issueArticles.map((article) => article.source)).size),
      independentMediaGroups: independentGroups,
      excludedArticles: excluded,
      inputTruncatedArticles: inputTruncatedCount,
    },
    axes,
    issueMap,
    narratives,
    readerQuestions,
    sourceLens: {
      sharedVoices: uniqueStrings(sharedVoices),
      voicesPresentInSomeOutlets: uniqueStrings(voicesPresentInSomeOutlets),
      byOutlet,
      caution: rawComparison.source_lens?.caution ?? null,
    },
    contextGaps,
    limitations,
  };
}

async function loadTransientBodySignals(db, start, end) {
  const result = await db.prepare(`
    SELECT signals.article_id AS articleId, signals.detected_frames AS detectedFrames
    FROM article_body_signals signals
    JOIN articles a ON a.id = signals.article_id
    WHERE a.published_at >= ? AND a.published_at < ?
      AND signals.status = 'analyzed'
      AND signals.taxonomy_version = ?
    ORDER BY signals.article_id ASC, signals.analyzed_at DESC
  `).bind(start, end, FRAME_TAXONOMY_VERSION).all();
  const signals = new Map();
  for (const row of result.results ?? []) {
    if (signals.has(row.articleId)) continue;
    signals.set(row.articleId, {
      bodyAnalysisAvailable: true,
      bodyFrameSignals: parseDetectedFrames(row.detectedFrames),
      contentVersionId: null,
      publicEvidenceAllowed: false,
      transientContent: true,
    });
  }
  return signals;
}

async function transientAnalysisProgress(db, start, end, canonicalUrls = []) {
  const targetClause = canonicalUrls.length
    ? ` AND a.canonical_url IN (${canonicalUrls.map(() => "?").join(", ")})`
    : "";
  const row = await db.prepare(`
    SELECT
      COUNT(*) AS total,
      COALESCE(SUM(CASE WHEN profiles.status IN ('analyzed', 'partial') THEN 1 ELSE 0 END), 0) AS analyzed,
      COALESCE(SUM(CASE WHEN profiles.status = 'failed' THEN 1 ELSE 0 END), 0) AS failed
    FROM articles a
    LEFT JOIN article_frame_profiles profiles
      ON profiles.article_id = a.id
      AND profiles.extractor_version = ?
      AND profiles.model_version = ?
      AND profiles.schema_version = ?
    WHERE a.published_at >= ? AND a.published_at < ?
      ${targetClause}
  `).bind(
    ARTICLE_EXTRACTOR_VERSION,
    FRAMING_ENGINE_VERSION,
    ARTICLE_FRAME_PROFILE_SCHEMA,
    start,
    end,
    ...canonicalUrls,
  ).first();
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
      profileSchemaVersion: ARTICLE_FRAME_PROFILE_SCHEMA,
      framingEngineVersion: FRAMING_ENGINE_VERSION,
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
    if (payload.canonical_urls !== undefined && !Array.isArray(payload.canonical_urls)) {
      throw new Error("canonical_urls는 원문 URL 배열이어야 합니다.");
    }
    const canonicalUrls = uniqueStrings(
      (payload.canonical_urls ?? []).map((value) => canonicalizeArticleUrl(value)),
    );
    if (canonicalUrls.length > 50) throw new Error("한 번에 지정할 수 있는 원문 URL은 최대 50개입니다.");
    const start = Date.parse(`${targetDate}T00:00:00+09:00`);
    const end = start + 86_400_000;
    const targetClause = canonicalUrls.length
      ? ` AND a.canonical_url IN (${canonicalUrls.map(() => "?").join(", ")})`
      : "";
    const selected = await env.DB.prepare(`
      SELECT
        a.id,
        a.title,
        a.canonical_url AS canonicalUrl,
        a.source_id AS sourceId,
        a.published_at AS publishedAt,
        s.name AS source
      FROM articles a
      JOIN media_sources s ON s.id = a.source_id
      LEFT JOIN article_frame_profiles profiles
        ON profiles.article_id = a.id
        AND profiles.extractor_version = ?
        AND profiles.model_version = ?
        AND profiles.schema_version = ?
      WHERE a.published_at >= ? AND a.published_at < ?
        ${targetClause}
        AND (profiles.article_id IS NULL OR (? = 1 AND profiles.status = 'failed'))
      ORDER BY
        CASE a.homepage_placement WHEN 'top' THEN 4 WHEN 'main' THEN 3 WHEN 'section' THEN 2 ELSE 1 END DESC,
        a.homepage_rank ASC,
        a.published_at DESC
      LIMIT ?
    `).bind(
      ARTICLE_EXTRACTOR_VERSION,
      FRAMING_ENGINE_VERSION,
      ARTICLE_FRAME_PROFILE_SCHEMA,
      start,
      end,
      ...canonicalUrls,
      retryFailed ? 1 : 0,
      limit,
    ).all();
    const articles = selected.results ?? [];
    const results = await mapWithConcurrency(articles, ARTICLE_FETCH_CONCURRENCY, async (article) => {
      try {
        const source = sourceForArticle(article);
        const { html } = await fetchArticleHtml(article.canonicalUrl, source, env);
        const extraction = extractArticleBody(html, {
          hostname: new URL(article.canonicalUrl).hostname,
          sourceId: article.sourceId,
        });
        const body = extraction.bodyText;
        const signals = extractBodyFrameSignals(body);
        const profile = await analyzeArticleFraming({
          articleId: article.id,
          title: article.title,
          bodyText: body,
          publishedAt: article.publishedAt ? new Date(Number(article.publishedAt)).toISOString() : null,
        });
        profile.extraction = {
          strategy: extraction.strategy,
          quality: extraction.quality,
          extractor_version: ARTICLE_EXTRACTOR_VERSION,
        };
        const validation = validateArticleFrameProfile(profile);
        if (!validation.valid) throw new Error(`구조화 분석 검증 실패: ${validation.errors.join("; ")}`);
        return {
          articleId: article.id,
          source: article.source,
          title: article.title,
          status: "analyzed",
          bodyHash: await sha256Hex(body),
          bodyCharacters: signals.bodyCharacters,
          detectedFrames: signals.detectedFrames,
          profile,
          observedDimensionCount: Object.values(profile.dimensions)
            .filter((dimension) => dimension.status !== "not_observed").length,
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
      const statements = [];
      for (const result of results) {
        statements.push(env.DB.prepare(`
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
        ));
        statements.push(env.DB.prepare(`
          INSERT INTO article_frame_profiles
            (id, article_id, body_hash, body_characters, profile_json, status, failure_code, extractor_version, provider, model_version, prompt_version, schema_version, review_status, analyzed_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'automatic_draft', ?)
          ON CONFLICT(article_id, extractor_version, model_version, schema_version) DO UPDATE SET
            body_hash = excluded.body_hash,
            body_characters = excluded.body_characters,
            profile_json = excluded.profile_json,
            status = excluded.status,
            failure_code = excluded.failure_code,
            provider = excluded.provider,
            prompt_version = excluded.prompt_version,
            review_status = 'automatic_draft',
            analyzed_at = excluded.analyzed_at
        `).bind(
          crypto.randomUUID(),
          result.articleId,
          result.status === "analyzed" ? result.bodyHash : null,
          result.status === "analyzed" ? result.bodyCharacters : null,
          JSON.stringify(result.status === "analyzed" ? result.profile : {}),
          result.status,
          result.status === "failed" ? result.failureCode : null,
          ARTICLE_EXTRACTOR_VERSION,
          "structured_extractive",
          FRAMING_ENGINE_VERSION,
          PROMPT_VERSION,
          ARTICLE_FRAME_PROFILE_SCHEMA,
          analyzedAt,
        ));
      }
      await runBatches(env.DB, statements);
    }

    const progress = await transientAnalysisProgress(env.DB, start, end, canonicalUrls);
    const ready = results.filter((result) => result.status === "analyzed");
    let analysis = null;
    if (progress.remaining === 0 && (ready.length || payload.refresh_analysis === true)) {
      const analysisHeaders = new Headers({ "content-type": "application/json" });
      for (const name of ["authorization", "origin", "sec-fetch-site"]) {
        const value = request.headers.get(name);
        if (value) analysisHeaders.set(name, value);
      }
      const analysisResponse = await handleAnalyze(new Request(new URL("/api/analyze", request.url), {
        method: "POST",
        headers: analysisHeaders,
        body: JSON.stringify({
          date: targetDate,
          approved_same_event_clusters: payload.approved_same_event_clusters,
        }),
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
      structuredDimensionCount: result.observedDimensionCount,
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
      targeted: canonicalUrls.length > 0,
      targetCount: canonicalUrls.length,
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
  const configuredTokens = [env?.IMPORT_TOKEN, env?.CODEX_IMPORT_TOKEN].filter(Boolean);
  if (!configuredTokens.length) return false;
  const requestUrl = new URL(request.url);
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if ((origin && origin !== requestUrl.origin) || (fetchSite && !["same-origin", "none"].includes(fetchSite))) return false;
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  const matches = await Promise.all(configuredTokens.map((configuredToken) => secureTokenMatches(token, configuredToken)));
  return matches.some(Boolean);
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
  let reviewedClusterApprovals;
  try {
    targetDate = await resolveAnalysisDate(db, String(payload.date ?? "").trim());
    reviewedClusterApprovals = await approvedClusterApprovals(payload);
  } catch (error) {
    return jsonResponse({ error: error.message }, 400);
  }
  const start = Date.parse(`${targetDate}T00:00:00+09:00`);
  const end = start + 86_400_000;
  const articleResult = await db.prepare(`
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
      LIMIT 5000
    `).bind(start, end).all();
  const placementResult = await db.prepare(`
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
    `).bind(start, end).all();
  const authorizedContents = includeStoredContents
    ? await loadAuthorizedArticleContents(db, env.CONTENT, start, end)
    : new Map();
  const transientSignals = includeDerivedSignals
    ? await loadTransientBodySignals(db, start, end)
    : new Map();
  const frameProfiles = includeDerivedSignals
    ? await loadArticleFrameProfiles(db, start, end)
    : new Map();
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

  const analyzedArticleIds = new Set(articles.map((article) => article.id));
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
    const consumedClusterApprovals = new Set();
    analyzed.forEach((issue, index) => {
      const profiles = issue.articles
        .map((article) => frameProfiles.get(article.id))
        .filter(Boolean);
      if (!profiles.length) return;
      const issueSignature = clusterArticleSignature(
        issue.articles.map((article) => article.url ?? article.canonicalUrl),
      );
      const clusterApproval = resolveClusterApproval(
        issue.articles.map((article) => article.url ?? article.canonicalUrl),
        profiles,
        reviewedClusterApprovals,
      );
      const clusterNeedsReview = issue.clusterQuality === "review_required";
      const clusterWasReviewed = Boolean(clusterApproval);
      if (clusterApproval) consumedClusterApprovals.add(issueSignature);
      if (clusterNeedsReview && !clusterWasReviewed) {
        issue.structuredComparison = withheldClusterReviewComparison(
          profiles,
          issue,
          issue.articles,
        );
        return;
      }
      const rawComparison = buildIssueFrameComparison(profiles, issue.articles, {
        issueId: issueIds[index],
        issueTitle: issue.title,
      });
      rawComparison.review.cluster_status = clusterWasReviewed
        ? "approved_same_event"
        : "automatic_cohesive";
      rawComparison.review.cluster_approval = clusterApproval;
      issue.structuredComparison = publicComparisonFromEngine(rawComparison, profiles, issue.articles, {
        issueArticleCount: issue.articleCount,
        approval: clusterApproval,
      });
      if (!isStructuredComparisonPayload(issue.structuredComparison)) {
        throw new Error("공개 구조화 비교 계약 검증에 실패했습니다.");
      }
    });
    const unusedApprovalCount = [...reviewedClusterApprovals.keys()]
      .filter((signature) => !consumedClusterApprovals.has(signature))
      .length;
    if (unusedApprovalCount) {
      throw new Error(`${unusedApprovalCount} approved cluster(s) did not match an analyzed issue with usable profiles.`);
    }
    const statementGroups = [];
    for (let index = 0; index < analyzed.length; index += 1) {
      const issue = analyzed[index];
      const issueId = issueIds[index];
      const generatedAt = Date.now();
      const statements = [db.prepare(`
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
      )];
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
        generatedAt,
      ));
      if (issue.structuredComparison) {
        statements.push(db.prepare(`
          INSERT INTO issue_frame_comparisons
            (id, issue_id, comparison_json, profile_count, analyzed_article_count, provider, model_version, schema_version, generated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          crypto.randomUUID(),
          issueId,
          JSON.stringify(issue.structuredComparison),
          issue.structuredComparison.sample?.analyzedArticles ?? 0,
          issue.structuredComparison.sample?.analyzedArticles ?? 0,
          "structured_extractive",
          FRAMING_ENGINE_VERSION,
          ISSUE_FRAME_COMPARISON_SCHEMA,
          generatedAt,
        ));
      }
      const comparisonSchemaVersion = issue.structuredComparison ? ISSUE_FRAME_COMPARISON_SCHEMA : "none";
      const publicationPayload = JSON.stringify({
        schemaVersion: 1,
        issueId,
        runId,
        targetDate,
        publicApiVersion: PUBLIC_API_SCHEMA_VERSION,
        comparisonSchemaVersion,
      });
      const publicationPayloadHash = await sha256Hex(publicationPayload);
      statements.push(db.prepare(`
        INSERT INTO publication_outbox_events (
          id, destination, aggregate_type, aggregate_id, aggregate_version,
          event_type, payload, payload_hash, idempotency_key, status,
          attempt_count, available_at, claim_token, claimed_by, lease_expires_at,
          last_error_code, last_error_at, delivered_at, created_at, updated_at
        ) VALUES (?, 'public-site-local', 'issue', ?, 1, 'issue.published', ?, ?, ?, 'pending', 0, ?, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?)
      `).bind(
        crypto.randomUUID(),
        issueId,
        publicationPayload,
        publicationPayloadHash,
        `issue:${issueId}:published:v1`,
        generatedAt,
        generatedAt,
        generatedAt,
      ));
      if (statements.length > 100) {
        throw new Error("한 이슈의 원자적 게시 작업이 D1 안전 한도를 초과했습니다.");
      }
      statementGroups.push(statements);
    }
    for (const statements of statementGroups) await db.batch(statements);
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
      ].filter((articleId) => analyzedArticleIds.has(articleId))).size,
      bodyEvidenceCount: [...analysisContents.entries()]
        .filter(([articleId, content]) => analyzedArticleIds.has(articleId)
          && (Boolean(content?.bodyText) || content?.bodyAnalysisAvailable === true))
        .length,
      issueCount: analyzed.length,
      approvedClusterCount: consumedClusterApprovals.size,
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

function validKstDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}

async function handleIssueDates(request, env) {
  if (!env?.DB) return jsonResponse({ dates: [], meta: responseMeta(null, "demo") }, 200, { request, etag: true, cacheControl: "public, max-age=30, must-revalidate" });
  const url = new URL(request.url);
  const scope = resolveIssueScope(request);
  if (!scope) return jsonResponse({ error: "吏?먰븯吏 ?딅뒗 遺꾩꽍 ?쒕낯?낅땲??" }, 400, { request });
  const limitValue = Number(url.searchParams.get("limit") ?? 31);
  const limit = Number.isInteger(limitValue) ? Math.min(Math.max(limitValue, 1), 90) : 31;
  const categoryPlaceholders = PUBLIC_AGENDA_CATEGORIES.map(() => "?").join(", ");
  const scopeIssueClause = scope.key === "all" ? "" : `AND EXISTS (
          SELECT 1
          FROM issue_articles scoped_date_ia
          JOIN articles scoped_date_a ON scoped_date_a.id = scoped_date_ia.article_id
          JOIN media_sources scoped_date_s ON scoped_date_s.id = scoped_date_a.source_id
          WHERE scoped_date_ia.issue_id = public_issues.id
            AND scoped_date_s.source_type = ?
            AND scoped_date_s.active = 1
        )`;
  const result = await env.DB.prepare(`
    SELECT id, targetDate, analyzedAt, articleCount, issueCount
    FROM (
      SELECT
        ranked.id,
        ranked.targetDate,
        ranked.analyzedAt,
        ranked.articleCount,
        (SELECT COUNT(*) FROM issues public_issues WHERE public_issues.run_id = ranked.id AND public_issues.category IN (${categoryPlaceholders}) ${scopeIssueClause}) AS issueCount
      FROM (
        SELECT
          id,
          target_date AS targetDate,
          finished_at AS analyzedAt,
          article_count AS articleCount,
          ROW_NUMBER() OVER (PARTITION BY target_date ORDER BY finished_at DESC) AS dateRank
        FROM analysis_runs
        WHERE status = 'success'
      ) ranked
      WHERE ranked.dateRank = 1
    ) public_runs
    WHERE issueCount > 0
    ORDER BY targetDate DESC
    LIMIT ?
  `).bind(...PUBLIC_AGENDA_CATEGORIES, ...(scope.key === "all" ? [] : [scope.sourceType]), limit).all();
  const dates = (result.results ?? []).map((entry) => ({
    date: entry.targetDate,
    analyzedAt: Number(entry.analyzedAt ?? 0) || null,
    articleCount: Number(entry.articleCount ?? 0),
    issueCount: Number(entry.issueCount ?? 0),
  }));
  return jsonResponse({
    dates,
    scope: { key: scope.key, label: scope.label, configuredSources: scope.configuredCount },
    meta: responseMeta(null, "live_metadata"),
  }, 200, { request, etag: true, cacheControl: "public, max-age=300, must-revalidate" });
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

async function handleScopedIssues(request, env, scope, run, category, limit) {
  const categoryPlaceholders = PUBLIC_AGENDA_CATEGORIES.map(() => "?").join(", ");
  const clauses = ["i.run_id = ?", `i.category IN (${categoryPlaceholders})`];
  const parameters = [run.id, ...PUBLIC_AGENDA_CATEGORIES];
  if (category) {
    clauses.push("i.category = ?");
    parameters.push(category);
  }
  const where = clauses.join(" AND ");
  const scopeExists = `EXISTS (
    SELECT 1
    FROM issue_articles scoped_exists_ia
    JOIN articles scoped_exists_a ON scoped_exists_a.id = scoped_exists_ia.article_id
    JOIN media_sources scoped_exists_s ON scoped_exists_s.id = scoped_exists_a.source_id
    WHERE scoped_exists_ia.issue_id = i.id
      AND scoped_exists_s.source_type = ?
      AND scoped_exists_s.active = 1
  )`;
  const [count, result, categoryResult] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) AS total FROM issues i WHERE ${where} AND ${scopeExists}`).bind(...parameters, scope.sourceType).first(),
    env.DB.prepare(`
      WITH scoped_issue_metrics AS (
        SELECT
          ia.issue_id,
          COUNT(*) AS articleCount,
          COUNT(DISTINCT a.source_id) AS sourceCount,
          SUM(CASE WHEN (EXISTS(
            SELECT 1 FROM article_contents ac
            WHERE ac.article_id = ia.article_id
              AND ac.status = 'active'
              AND ac.analysis_allowed = 1
              AND (ac.usage_expires_at IS NULL OR ac.usage_expires_at > (unixepoch() * 1000))
          ) OR EXISTS(
            SELECT 1 FROM frame_analyses fa
            WHERE fa.issue_id = ia.issue_id
              AND fa.article_id = ia.article_id
              AND fa.evidence_basis = 'body_transient'
          )) THEN 1 ELSE 0 END) AS contentAvailableCount,
          SUM(CASE WHEN EXISTS(
            SELECT 1 FROM article_frame_profiles profiles
            WHERE profiles.article_id = ia.article_id
              AND profiles.status IN ('analyzed', 'partial')
          ) THEN 1 ELSE 0 END) AS structuredProfileCount,
          SUM(CASE WHEN a.homepage_placement IS NOT NULL OR EXISTS(
            SELECT 1 FROM placement_observations po WHERE po.article_id = a.id
          ) THEN 1 ELSE 0 END) AS placementObservedCount
        FROM issue_articles ia
        JOIN articles a ON a.id = ia.article_id
        JOIN media_sources s ON s.id = a.source_id
        WHERE s.source_type = ? AND s.active = 1
        GROUP BY ia.issue_id
      )
      SELECT
        i.id, i.issue_date AS issueDate, i.title, i.summary, i.category,
        (SELECT scoped_title_a.title
         FROM issue_articles scoped_title_ia
         JOIN articles scoped_title_a ON scoped_title_a.id = scoped_title_ia.article_id
         JOIN media_sources scoped_title_s ON scoped_title_s.id = scoped_title_a.source_id
         WHERE scoped_title_ia.issue_id = i.id AND scoped_title_s.source_type = ? AND scoped_title_s.active = 1
         ORDER BY scoped_title_ia.representative DESC, scoped_title_a.published_at DESC
         LIMIT 1) AS representativeTitle,
        m.articleCount, m.sourceCount,
        ROUND((m.sourceCount * 60.0 / ?) + (MIN(m.articleCount, 10) * 4.0), 1) AS agendaScore,
        ROUND(m.sourceCount * 100.0 / ?, 1) AS diversityScore,
        ROUND(m.placementObservedCount * 100.0 / MAX(m.articleCount, 1), 1) AS placementScore,
        ROUND(MIN(m.articleCount, 10) * 10.0, 1) AS volumeScore,
        i.repetition_score AS repetitionScore,
        NULL AS confidence,
        m.placementObservedCount,
        m.articleCount AS placementTotalCount,
        m.contentAvailableCount,
        m.structuredProfileCount
      FROM issues i
      JOIN scoped_issue_metrics m ON m.issue_id = i.id
      WHERE ${where}
      ORDER BY m.sourceCount DESC, m.articleCount DESC, i.title ASC
      LIMIT ?
    `).bind(scope.sourceType, scope.sourceType, scope.configuredCount, scope.configuredCount, ...parameters, limit).all(),
    env.DB.prepare(`SELECT i.category, COUNT(*) AS count FROM issues i WHERE i.run_id = ? AND i.category IN (${categoryPlaceholders}) AND ${scopeExists} GROUP BY i.category ORDER BY count DESC, i.category`).bind(run.id, ...PUBLIC_AGENDA_CATEGORIES, scope.sourceType).all(),
  ]);
  return jsonResponse({
    run,
    scope: { key: scope.key, label: scope.label, configuredSources: scope.configuredCount },
    issues: (result.results ?? []).map((issue) => publicIssue(issue, run, scope.configuredCount, true)),
    total: Number(count?.total ?? 0),
    categories: categoryResult.results ?? [],
    analysisDisclosure: "국내 10대 종합일간지 기사만으로 보도 확산과 설명 차이를 비교합니다. 이 점수는 사회적 중요도·사실성·여론을 뜻하지 않습니다.",
    meta: responseMeta(run, "live_metadata"),
  }, 200, { request, etag: true, cacheControl: "public, max-age=60, must-revalidate" });
}

async function handleIssues(request, env) {
  if (!env?.DB) return jsonResponse({ issues: [], total: 0, run: null, categories: [], meta: responseMeta(null, "demo") }, 200, { request, etag: true, cacheControl: "public, max-age=30, must-revalidate" });
  const url = new URL(request.url);
  const date = String(url.searchParams.get("date") ?? "").trim();
  if (date && !validKstDate(date)) return jsonResponse({ error: "의제 날짜를 YYYY-MM-DD 형식으로 입력해 주세요." }, 400, { request });
  const category = String(url.searchParams.get("category") ?? "").trim().slice(0, 40);
  if (category && !PUBLIC_AGENDA_CATEGORY_SET.has(category)) return jsonResponse({ error: `의제 분야는 ${PUBLIC_AGENDA_CATEGORIES.join("·")} 중에서 선택해 주세요.` }, 400, { request });
  const limitValue = Number(url.searchParams.get("limit") ?? 30);
  const limit = Number.isInteger(limitValue) ? Math.min(Math.max(limitValue, 1), 50) : 30;
  const scope = resolveIssueScope(request);
  if (!scope) return jsonResponse({ error: "지원하지 않는 분석 표본입니다." }, 400, { request });
  const run = await latestAnalysisRun(env.DB, date);
  if (!run) return jsonResponse({ issues: [], total: 0, run: null, categories: [], meta: responseMeta(null, "live_metadata") }, 200, { request, etag: true, cacheControl: "public, max-age=30, must-revalidate" });
  if (scope.key !== "all") return handleScopedIssues(request, env, scope, run, category, limit);

  const categoryPlaceholders = PUBLIC_AGENDA_CATEGORIES.map(() => "?").join(", ");
  const clauses = ["run_id = ?", `category IN (${categoryPlaceholders})`];
  const parameters = [run.id, ...PUBLIC_AGENDA_CATEGORIES];
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
        (SELECT a.title
         FROM issue_articles ia
         JOIN articles a ON a.id = ia.article_id
         WHERE ia.issue_id = issues.id
         ORDER BY ia.representative DESC, a.published_at DESC
         LIMIT 1) AS representativeTitle,
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
         )) AS contentAvailableCount,
         (SELECT COUNT(*) FROM issue_articles ia WHERE ia.issue_id = issues.id AND EXISTS(
           SELECT 1 FROM article_frame_profiles profiles
           WHERE profiles.article_id = ia.article_id
             AND profiles.status IN ('analyzed', 'partial')
         )) AS structuredProfileCount
      FROM issues
      WHERE ${where}
      ORDER BY
        CASE WHEN category IN ('스포츠', '생활·IT') THEN 1 ELSE 0 END,
        agenda_score DESC,
        article_count DESC
      LIMIT ?
    `).bind(...parameters, limit).all(),
    env.DB.prepare(`SELECT category, COUNT(*) AS count FROM issues WHERE run_id = ? AND category IN (${categoryPlaceholders}) GROUP BY category ORDER BY count DESC, category`).bind(run.id, ...PUBLIC_AGENDA_CATEGORIES).all(),
  ]);
  return jsonResponse({
    run,
    scope: { key: scope.key, label: scope.label, configuredSources: scope.configuredCount },
    issues: (result.results ?? []).map((issue) => publicIssue(issue, run, scope.configuredCount)),
    total: Number(count?.total ?? 0),
    categories: categoryResult.results ?? [],
    analysisDisclosure: "공개 본문을 저장하지 않고 근거 위치·해시와 구조화 프레임 요소를 추출한 자동 초안입니다. 사람 검토·사실성·편향 판정이 아닙니다.",
    meta: responseMeta(run, "live_metadata"),
  }, 200, { request, etag: true, cacheControl: "public, max-age=60, must-revalidate" });
}

async function handleIssueDetail(request, issueId, env) {
  if (!env?.DB) return jsonResponse({ error: "분석 데이터가 없습니다." }, 404, { request });
  const scope = resolveIssueScope(request);
  if (!scope) return jsonResponse({ error: "지원하지 않는 분석 표본입니다." }, 400, { request });
  let issue = await env.DB.prepare(`
    SELECT
      i.id, i.issue_date AS issueDate, i.title, i.summary, i.category, i.article_count AS articleCount, i.source_count AS sourceCount,
      (SELECT a.title
       FROM issue_articles representative_ia
       JOIN articles a ON a.id = representative_ia.article_id
       WHERE representative_ia.issue_id = i.id
       ORDER BY representative_ia.representative DESC, a.published_at DESC
       LIMIT 1) AS representativeTitle,
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
      )) AS contentAvailableCount,
      (SELECT COUNT(*) FROM issue_articles profile_ia WHERE profile_ia.issue_id = i.id AND EXISTS(
        SELECT 1 FROM article_frame_profiles profiles
        WHERE profiles.article_id = profile_ia.article_id
          AND profiles.status IN ('analyzed', 'partial')
      )) AS structuredProfileCount
    FROM issues i
    JOIN analysis_runs r ON r.id = i.run_id
    WHERE i.id = ? AND r.status = 'success'
  `).bind(issueId).first();
  if (!issue) return jsonResponse({ error: "이슈를 찾지 못했습니다." }, 404, { request });
  if (!PUBLIC_AGENDA_CATEGORY_SET.has(issue.category)) return jsonResponse({ error: "제공 범위에 포함되지 않는 의제입니다." }, 404, { request });
  if (scope.key !== "all") {
    const scopedMetrics = await env.DB.prepare(`
      SELECT
        COUNT(*) AS articleCount,
        COUNT(DISTINCT a.source_id) AS sourceCount,
        SUM(CASE WHEN (EXISTS(
          SELECT 1 FROM article_contents ac
          WHERE ac.article_id = ia.article_id
            AND ac.status = 'active'
            AND ac.analysis_allowed = 1
            AND (ac.usage_expires_at IS NULL OR ac.usage_expires_at > (unixepoch() * 1000))
        ) OR EXISTS(
          SELECT 1 FROM frame_analyses fa
          WHERE fa.issue_id = ia.issue_id
            AND fa.article_id = ia.article_id
            AND fa.evidence_basis = 'body_transient'
        )) THEN 1 ELSE 0 END) AS contentAvailableCount,
        SUM(CASE WHEN EXISTS(
          SELECT 1 FROM article_frame_profiles profiles
          WHERE profiles.article_id = ia.article_id
            AND profiles.status IN ('analyzed', 'partial')
        ) THEN 1 ELSE 0 END) AS structuredProfileCount,
        SUM(CASE WHEN a.homepage_placement IS NOT NULL OR EXISTS(
          SELECT 1 FROM placement_observations po WHERE po.article_id = a.id
        ) THEN 1 ELSE 0 END) AS placementObservedCount
      FROM issue_articles ia
      JOIN articles a ON a.id = ia.article_id
      JOIN media_sources s ON s.id = a.source_id
      WHERE ia.issue_id = ? AND s.source_type = ? AND s.active = 1
    `).bind(issueId, scope.sourceType).first();
    if (!scopedMetrics || Number(scopedMetrics.articleCount ?? 0) < 1) return jsonResponse({ error: "해당 표본에 포함된 기사가 없습니다." }, 404, { request });
    issue = {
      ...issue,
      articleCount: Number(scopedMetrics.articleCount ?? 0),
      sourceCount: Number(scopedMetrics.sourceCount ?? 0),
      contentAvailableCount: Number(scopedMetrics.contentAvailableCount ?? 0),
      structuredProfileCount: Number(scopedMetrics.structuredProfileCount ?? 0),
      placementObservedCount: Number(scopedMetrics.placementObservedCount ?? 0),
      placementTotalCount: Number(scopedMetrics.articleCount ?? 0),
      agendaScore: Math.round(((Number(scopedMetrics.sourceCount ?? 0) * 60) / scope.configuredCount + Math.min(Number(scopedMetrics.articleCount ?? 0), 10) * 4) * 10) / 10,
      diversityScore: Math.round((Number(scopedMetrics.sourceCount ?? 0) * 1000) / scope.configuredCount) / 10,
      placementScore: Number(scopedMetrics.placementObservedCount ?? 0) ? Math.round((Number(scopedMetrics.placementObservedCount ?? 0) * 1000) / Number(scopedMetrics.articleCount ?? 1)) / 10 : null,
      volumeScore: Math.min(Number(scopedMetrics.articleCount ?? 0), 10) * 10,
    };
  }
  const articleScopeClause = scope.key === "all" ? "" : " AND s.source_type = ? AND s.active = 1";
  const articleScopeParameters = scope.key === "all" ? [issueId] : [issueId, scope.sourceType];
  const frameScopeClause = scope.key === "all" ? "" : " AND s.source_type = ? AND s.active = 1";
  const frameScopeParameters = scope.key === "all" ? [issueId] : [issueId, scope.sourceType];
  const outletScopeClause = scope.key === "all" ? "" : " AND s.source_type = ? AND s.active = 1";
  const outletScopeParameters = scope.key === "all" ? [issueId] : [issueId, scope.sourceType];
  const [articles, frames, report, outlets, comparisonRow] = await Promise.all([
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
      WHERE ia.issue_id = ?${articleScopeClause}
      ORDER BY ia.representative DESC, a.published_at DESC
    `).bind(...articleScopeParameters).all(),
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
      WHERE fa.issue_id = ?${frameScopeClause}
      ORDER BY fa.score DESC
    `).bind(...frameScopeParameters).all(),
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
      WHERE ia.issue_id = ?${outletScopeClause}
      GROUP BY s.id, s.name
      ORDER BY articleCount DESC, s.name
    `).bind(...outletScopeParameters).all(),
    env.DB.prepare(`
      SELECT comparison_json AS comparisonJson
      FROM issue_frame_comparisons
      WHERE issue_id = ?
    `).bind(issueId).first(),
  ]);
  const run = { id: issue.runId, targetDate: issue.targetDate, provider: issue.provider, modelVersion: issue.modelVersion, finishedAt: issue.analyzedAt };
  const publicArticles = articles.results ?? [];
  if (scope.key !== "all") {
    issue.representativeTitle = publicArticles.find((article) => Number(article.representative) === 1)?.title ?? publicArticles[0]?.title ?? issue.representativeTitle;
  }
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
  let structuredComparison = null;
  if (currentAnalysis && comparisonRow?.comparisonJson) {
    try {
      const parsed = JSON.parse(String(comparisonRow.comparisonJson));
      if (isStructuredComparisonPayload(parsed) && comparisonOnlyUsesSources(parsed, scope.sourceNames)) structuredComparison = parsed;
    } catch {
      structuredComparison = null;
    }
  }
  return jsonResponse({
    scope: { key: scope.key, label: scope.label, configuredSources: scope.configuredCount },
    issue: publicIssue(issue, run, scope.configuredCount, scope.key !== "all"),
    articles: publicArticles,
    frames: publicFrames,
    report: publicReport,
    outlets: (outlets.results ?? []).map((outlet) => ({ ...outlet, placement: placementByWeight[outlet.placementWeight] ?? "미확인" })),
    comparison: structuredComparison ?? evidenceFirstComparison(issue, publicArticles),
    meta: responseMeta(run, "live_metadata", structuredComparison?.lineage ?? null),
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

  if (url.pathname === "/api/chat") return handleEvidenceChat(request, env);
  if (url.pathname.startsWith("/api/issues/") && url.pathname.endsWith("/community")) return handleCommunityRequest(request, env);
  if (url.pathname.startsWith("/api/comments/") && url.pathname.endsWith("/report")) return handleCommunityRequest(request, env);
  if (url.pathname.startsWith("/api/admin/community/")) {
    return handleCommunityRequest(request, env, { isAdmin: await adminAuthorized(request, env) });
  }
  if (url.pathname === "/api/admin/release/evaluate") {
    return handleReleaseAdminRequest(request, env, { isAdmin: await adminAuthorized(request, env) });
  }

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
  if (url.pathname === "/api/issues/dates" && request.method === "GET") return handleIssueDates(request, env);
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
  if (url.pathname === "/api/import/structured") {
    if (request.method !== "POST") return jsonResponse({ error: "POST 요청만 허용됩니다." }, 405);
    return handleStructuredImport(request, env);
  }
  if (url.pathname === "/api/import/analyzed") {
    if (request.method !== "POST") return jsonResponse({ error: "POST 요청만 허용됩니다." }, 405);
    return handleAnalyzedImport(request, env);
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
