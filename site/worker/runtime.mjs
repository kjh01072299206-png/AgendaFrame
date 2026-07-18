import { getAnalysisProvider } from "./analysis-provider.mjs";
import { CLUSTERING_VERSION, FRAME_TAXONOMY_VERSION, SCORE_VERSION } from "./analysis.mjs";
import publicApiSchema from "../docs/public-api.schema.json" with { type: "json" };

const analysisProvider = getAnalysisProvider();
const ANALYSIS_PROVIDER = analysisProvider.provider;
const ANALYSIS_MODEL_VERSION = analysisProvider.modelVersion;
const PUBLIC_API_SCHEMA_VERSION = publicApiSchema["x-api-version"];
const PROMPT_VERSION = "not_applicable_rules";
const EVALUATION_DATASET_VERSION = "not_configured";

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
  return ({ 400: "INVALID_REQUEST", 401: "UNAUTHORIZED", 404: "NOT_FOUND", 405: "METHOD_NOT_ALLOWED", 409: "CONFLICT", 413: "PAYLOAD_TOO_LARGE", 429: "RATE_LIMITED", 500: "INTERNAL_ERROR", 503: "UNAVAILABLE" })[status] ?? "REQUEST_FAILED";
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
  const current = !run?.modelVersion || run.modelVersion === ANALYSIS_MODEL_VERSION;
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
  const legacy = run?.modelVersion !== ANALYSIS_MODEL_VERSION;
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
    evidenceBasis: "headline_metadata_only",
  };
}

function evidenceFirstComparison(issue, articles) {
  return {
    status: "withheld_insufficient_evidence",
    evidenceBasis: "headline_metadata_only",
    reason: "기사 본문과 독립 출처 관계를 확인할 수 없어 공통 사실·설명 차이·취재원·추천을 생성하지 않았습니다.",
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
      (SELECT COUNT(*) FROM articles) AS article_count
  `).first();
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
      latestSourceCount,
      latestInserted: Number(latest?.article_count ?? 0),
      latestDuplicates: Number(latest?.duplicate_count ?? 0),
      latestStatus: latest?.status ?? "awaiting_import",
    },
  };
}

async function readImportPayload(request) {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 1024 * 1024) throw new Error("요청 크기는 1MB 이하여야 합니다.");
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > 1024 * 1024) throw new Error("요청 크기는 1MB 이하여야 합니다.");
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error("JSON 형식을 확인해 주세요.");
  }
  return payload;
}

async function handleImport(request, env) {
  if (!env?.DB) return jsonResponse({ error: "데이터 저장소가 아직 준비되지 않았습니다." }, 503);
  if (!env?.IMPORT_TOKEN) return jsonResponse({ error: "관리자 가져오기가 아직 활성화되지 않았습니다." }, 503);

  const requestUrl = new URL(request.url);
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if ((origin && origin !== requestUrl.origin) || (fetchSite && !["same-origin", "none"].includes(fetchSite))) {
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
      a.homepage_rank AS homepageRank
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

async function handleAnalyze(request, env) {
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
    LIMIT 2500
  `).bind(start, start + 86_400_000).all();
  const articles = articleResult.results ?? [];
  if (!articles.length) return jsonResponse({ error: `${targetDate}에 분석할 기사가 없습니다.` }, 400);

  const runId = crypto.randomUUID();
  const startedAt = Date.now();
  await db.prepare(`
    INSERT INTO analysis_runs
      (id, target_date, provider, model_version, status, started_at, article_count, issue_count)
    VALUES (?, ?, ?, ?, 'running', ?, ?, 0)
  `).bind(runId, targetDate, ANALYSIS_PROVIDER, ANALYSIS_MODEL_VERSION, startedAt, articles.length).run();

  try {
    const analyzed = analysisProvider.analyze(articles, { configuredSourceCount: sourcePanel.sources.filter((source) => source.active).length, maxIssues: 80 });
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
            (id, issue_id, frame, score, confidence, evidence_text, article_id, source_id, provider, model_version)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          crypto.randomUUID(),
          issueId,
          frame.frame,
          frame.score,
          frame.confidence ?? 0,
          frame.evidenceText,
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
        (SELECT COUNT(*) FROM issue_articles ia JOIN articles a ON a.id = ia.article_id WHERE ia.issue_id = issues.id AND a.homepage_placement IS NOT NULL) AS placementObservedCount,
        (SELECT COUNT(*) FROM issue_articles ia WHERE ia.issue_id = issues.id) AS placementTotalCount
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
      (SELECT COUNT(*) FROM issue_articles observed_ia JOIN articles observed_a ON observed_a.id = observed_ia.article_id WHERE observed_ia.issue_id = i.id AND observed_a.homepage_placement IS NOT NULL) AS placementObservedCount,
      (SELECT COUNT(*) FROM issue_articles total_ia WHERE total_ia.issue_id = i.id) AS placementTotalCount
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
        ia.similarity, ia.representative
      FROM issue_articles ia
      JOIN articles a ON a.id = ia.article_id
      JOIN media_sources s ON s.id = a.source_id
      WHERE ia.issue_id = ?
      ORDER BY ia.representative DESC, a.published_at DESC
    `).bind(issueId).all(),
    env.DB.prepare(`
      SELECT fa.frame, fa.score, fa.confidence, fa.evidence_text AS evidenceText, s.name AS source,
        fa.article_id AS articleId, a.canonical_url AS sourceUrl
      FROM frame_analyses fa
      LEFT JOIN media_sources s ON s.id = fa.source_id
      LEFT JOIN articles a ON a.id = fa.article_id
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
  const currentAnalysis = issue.modelVersion === ANALYSIS_MODEL_VERSION;
  const publicFrames = currentAnalysis ? (frames.results ?? []).map((row) => {
    const frame = { ...row };
    delete frame.confidence;
    return { ...frame, calibrationStatus: "not_calibrated", evidenceBasis: "headline" };
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
        collection: { method: sourcePanel.collectionProvider, directCrawling: false, configuredSources: sourcePanel.sources.length, articleCount: 0, latestSourceCount: 0, latestInserted: 0, latestDuplicates: 0, latestStatus: "awaiting_import" },
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
      return jsonResponse({ status: "degraded", mode: "unavailable", dataAsOf: null, collection: { method: sourcePanel.collectionProvider, directCrawling: false, configuredSources: sourcePanel.sources.length, articleCount: 0, latestSourceCount: 0, latestInserted: 0, latestDuplicates: 0, latestStatus: "storage_unavailable" }, analysis: null, freshness: { status: "analysis_pending", label: "분석 보류", staleDays: null }, timestamps: { collectedAt: null, analyzedAt: null, publishedAt: null, nextScheduledAt: null }, meta: responseMeta(null, "unavailable") }, 503, { request });
    }
  }
  if (url.pathname === "/api/sources" && request.method === "GET") {
    const publicSources = sourcePanel.sources.map((entry) => {
      const source = { ...entry };
      delete source.domains;
      delete source.providerOutletName;
      return source;
    });
    return jsonResponse({ panelVersion: sourcePanel.panelVersion, method: sourcePanel.collectionProvider, directCrawling: false, sources: publicSources, meta: responseMeta(null, env?.DB ? "live_metadata" : "demo") }, 200, { request, etag: true, cacheControl: "public, max-age=3600, must-revalidate" });
  }
  if (url.pathname === "/api/articles" && request.method === "GET") return handleArticles(request, env);
  const rollbackMatch = url.pathname.match(/^\/api\/analysis\/runs\/([^/]+)\/rollback$/);
  if (rollbackMatch) return handleAnalysisRollback(request, decodeURIComponent(rollbackMatch[1]), env);
  if (url.pathname === "/api/analysis/runs" && request.method === "GET") return handleAnalysisRuns(request, env);
  if (url.pathname === "/api/quality" && request.method === "GET") return handleQualityQueue(request, env);
  if (url.pathname.startsWith("/api/quality/reviews/")) return handleQualityReview(request, decodeURIComponent(url.pathname.slice("/api/quality/reviews/".length)), env);
  if (url.pathname === "/api/issues" && request.method === "GET") return handleIssues(request, env);
  if (url.pathname.startsWith("/api/issues/") && request.method === "GET") return handleIssueDetail(request, decodeURIComponent(url.pathname.slice("/api/issues/".length)), env);
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
