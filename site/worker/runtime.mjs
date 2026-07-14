const assets = globalThis.__AGENDAFRAME_ASSETS__ ?? {};
const sourcePanel = globalThis.__AGENDAFRAME_SOURCE_PANEL__ ?? {
  collectionProvider: "bigkinds_export",
  activationState: "ready_for_admin_import",
  directCrawling: false,
  sources: [],
};

const securityHeaders = {
  "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
};

function jsonResponse(value, status = 200) {
  return Response.json(value, {
    status,
    headers: { ...securityHeaders, "cache-control": "no-store" },
  });
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

async function handleArticles(request, env) {
  if (!env?.DB) return jsonResponse({ articles: [], total: 0 });
  const url = new URL(request.url);
  const limitValue = Number(url.searchParams.get("limit") ?? 50);
  const limit = Number.isInteger(limitValue) ? Math.min(Math.max(limitValue, 1), 100) : 50;
  const offsetValue = Number(url.searchParams.get("offset") ?? 0);
  const offset = Number.isInteger(offsetValue) ? Math.min(Math.max(offsetValue, 0), 100_000) : 0;
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
  return jsonResponse({ articles, total, limit, offset, hasMore: offset + articles.length < total });
}

const worker = {
  async fetch(request, env = {}) {
    const url = new URL(request.url);

    if (url.pathname === "/api/health" && request.method === "GET") {
      if (!env.DB) {
        return jsonResponse({
          status: "ok",
          mode: "demo",
          dataAsOf: null,
          collection: {
            method: sourcePanel.collectionProvider,
            directCrawling: false,
            configuredSources: sourcePanel.sources.length,
            articleCount: 0,
            latestSourceCount: 0,
            latestStatus: "awaiting_import",
          },
        });
      }
      try {
        return jsonResponse(await collectionHealth(env.DB));
      } catch (error) {
        console.error("AgendaFrame health query failed", error);
        return jsonResponse({ status: "degraded", mode: "demo", dataAsOf: null, collection: { method: sourcePanel.collectionProvider, directCrawling: false, configuredSources: sourcePanel.sources.length, articleCount: 0, latestSourceCount: 0, latestStatus: "storage_unavailable" } }, 503);
      }
    }

    if (url.pathname === "/api/sources" && request.method === "GET") {
      const publicSources = sourcePanel.sources.map((entry) => {
        const source = { ...entry };
        delete source.domains;
        delete source.providerOutletName;
        return source;
      });
      return jsonResponse({ panelVersion: sourcePanel.panelVersion, method: sourcePanel.collectionProvider, directCrawling: false, sources: publicSources });
    }
    if (url.pathname === "/api/articles" && request.method === "GET") {
      try {
        return await handleArticles(request, env);
      } catch (error) {
        console.error("AgendaFrame article query failed", error);
        return jsonResponse({ error: "기사 목록을 불러오지 못했습니다." }, 500);
      }
    }
    if (url.pathname === "/api/import") {
      if (request.method !== "POST") return jsonResponse({ error: "POST 요청만 허용됩니다." }, 405);
      return handleImport(request, env);
    }

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
