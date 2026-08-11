import { extractArticleBody, extractArticleTopic, ArticleExtractionError } from "./article-extractor.mjs";

const PROVIDER = "authorized_crawl";
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 20;
const MAX_HTML_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const MAX_COLLECTION_ATTEMPTS = 5;
const RETRY_BASE_MS = 15 * 60_000;
const RETRY_CAP_MS = 24 * 60 * 60_000;

async function fetchWithTimeout(fetchImpl, url, init, timeoutMilliseconds) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMilliseconds);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) {
      const timeout = new Error("The article request timed out.");
      timeout.code = "REQUEST_TIMEOUT";
      throw timeout;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function readTextWithByteLimit(response, maximumBytes) {
  if (!response.body || typeof response.body.getReader !== "function") {
    const text = await response.text();
    return new TextEncoder().encode(text).byteLength > maximumBytes ? null : text;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maximumBytes) {
        await reader.cancel();
        return null;
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

function matchesDomain(hostname, domains) {
  const normalized = String(hostname).toLowerCase();
  return domains.some((domain) => normalized === domain || normalized.endsWith(`.${domain}`));
}

function approvedUrl(value, source, baseUrl = source.homepageUrl) {
  const url = new URL(String(value), baseUrl);
  if (url.protocol === "http:") url.protocol = "https:";
  if (url.protocol !== "https:" || url.username || url.password) throw new TypeError("Only credential-free HTTPS URLs are allowed.");
  if (!matchesDomain(url.hostname, source.domains)) throw new TypeError("The article URL is outside the source allowlist.");
  url.hash = "";
  return url.toString();
}

function normalizeLimit(value) {
  const limit = value === undefined ? DEFAULT_LIMIT : Number(value);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new TypeError(`limit must be an integer from 1 to ${MAX_LIMIT}.`);
  }
  return limit;
}

function normalizeNow(value) {
  const timestamp = value === undefined ? Date.now() : Number(value);
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) throw new TypeError("now must be a non-negative integer timestamp.");
  return timestamp;
}

function requireBindings(env) {
  if (!env?.DB || typeof env.DB.prepare !== "function") throw new TypeError("A D1-compatible DB binding is required.");
  if (!env?.CONTENT || typeof env.CONTENT.put !== "function" || typeof env.CONTENT.delete !== "function") {
    throw new TypeError("An R2 CONTENT binding with put() and delete() is required.");
  }
}

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value)));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function fetchHtml(fetchImpl, article, source, options) {
  let currentUrl = approvedUrl(article.canonicalUrl, source);
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    await options.beforeRequest();
    if (options.nowImpl() >= options.deadlineTimestamp) {
      const deadline = new Error("The collection run deadline was reached.");
      deadline.code = "RUN_DEADLINE_EXCEEDED";
      throw deadline;
    }
    const response = await fetchWithTimeout(fetchImpl, currentUrl, {
      method: "GET",
      redirect: "manual",
      headers: {
        accept: "text/html,application/xhtml+xml;q=0.9",
        "user-agent": options.userAgent,
      },
    }, options.requestTimeoutMilliseconds);
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location || redirects === MAX_REDIRECTS) return { status: response.status, code: "REDIRECT_REJECTED" };
      try {
        currentUrl = approvedUrl(location, source, currentUrl);
      } catch {
        return { status: response.status, code: "REDIRECT_REJECTED" };
      }
      continue;
    }
    if (response.status === 403 || response.status === 429) return { status: response.status, code: "SOURCE_STOPPED" };
    if (!response.ok) return { status: response.status, code: "HTTP_ERROR" };
    const contentType = String(response.headers.get("content-type") ?? "").toLowerCase();
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
      return { status: response.status, code: "NOT_HTML" };
    }
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_HTML_BYTES) {
      return { status: response.status, code: "DOCUMENT_TOO_LARGE" };
    }
    const html = await readTextWithByteLimit(response, MAX_HTML_BYTES);
    if (html === null) return { status: response.status, code: "DOCUMENT_TOO_LARGE" };
    return { status: response.status, code: "OK", html };
  }
  return { status: 0, code: "REDIRECT_REJECTED" };
}

async function storeBody(env, article, body, options) {
  const normalizedBody = String(body).normalize("NFC").replace(/\r\n?/g, "\n").trim();
  const bodyHash = await sha256(normalizedBody);
  const contentId = crypto.randomUUID();
  const objectKey = `article-content/${article.id}/${bodyHash}.txt`;
  await env.CONTENT.put(objectKey, normalizedBody, {
    httpMetadata: { contentType: "text/plain; charset=utf-8" },
    customMetadata: { articleId: article.id, acquisitionMethod: PROVIDER },
  });
  try {
    await env.DB.prepare(`
      INSERT INTO article_contents
        (id, article_id, object_key, body_hash, body_characters, acquired_at, acquisition_method, usage_basis, usage_expires_at, analysis_allowed, public_evidence_allowed, extractor_version, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, 'active')
      ON CONFLICT(article_id, body_hash) DO UPDATE SET
        acquired_at = excluded.acquired_at,
        usage_basis = excluded.usage_basis,
        usage_expires_at = excluded.usage_expires_at,
        analysis_allowed = 1,
        public_evidence_allowed = 0,
        extractor_version = excluded.extractor_version,
        status = 'active'
    `).bind(
      contentId,
      article.id,
      objectKey,
      bodyHash,
      normalizedBody.length,
      options.now,
      PROVIDER,
      options.usageBasis,
      options.usageExpiresAt,
      options.extractorVersion,
    ).run();
  } catch (error) {
    try {
      await env.CONTENT.delete(objectKey);
    } catch {
      // The primary D1 failure is retained; orphan cleanup requires an operations review.
    }
    throw error;
  }
  return { contentId, objectKey, bodyHash, bodyCharacters: normalizedBody.length };
}

function failureCode(error) {
  if (error instanceof ArticleExtractionError) return error.code;
  return "COLLECTION_FAILED";
}

async function recordCollectionFailure(env, article, code, httpStatus, now) {
  await env.DB.prepare(`
    INSERT INTO article_collection_attempts
      (article_id, source_id, attempt_count, next_attempt_at, last_failure_code,
       last_http_status, status, created_at, updated_at)
    VALUES (?, ?, 1, ?, ?, ?, 'retry_wait', ?, ?)
    ON CONFLICT(article_id) DO UPDATE SET
      source_id = excluded.source_id,
      attempt_count = article_collection_attempts.attempt_count + 1,
      next_attempt_at = ? + MIN(?, ? * (1 << MIN(article_collection_attempts.attempt_count, 6))),
      last_failure_code = excluded.last_failure_code,
      last_http_status = excluded.last_http_status,
      status = CASE
        WHEN article_collection_attempts.attempt_count + 1 >= ? THEN 'terminal'
        ELSE 'retry_wait'
      END,
      updated_at = excluded.updated_at
  `).bind(
    article.id,
    article.sourceId,
    now + RETRY_BASE_MS,
    String(code).slice(0, 128),
    Number.isInteger(httpStatus) && httpStatus > 0 ? httpStatus : null,
    now,
    now,
    now,
    RETRY_CAP_MS,
    RETRY_BASE_MS,
    MAX_COLLECTION_ATTEMPTS,
  ).run();
}

async function clearCollectionFailure(env, articleId) {
  await env.DB.prepare("DELETE FROM article_collection_attempts WHERE article_id = ?")
    .bind(articleId)
    .run();
}

export async function collectAuthorizedArticleBodies(env, policy, options = {}) {
  requireBindings(env);
  const now = normalizeNow(options.now);
  const usageExpiresAt = Date.parse(policy.collectionWindow.rawContentDeleteAfter);
  const start = Date.parse(`${policy.collectionWindow.startDate}T00:00:00+09:00`);
  const end = Date.parse(`${policy.collectionWindow.endDate}T23:59:59.999+09:00`);
  if (now < start || now >= usageExpiresAt) {
    return { status: "outside_collection_window", selected: 0, stored: 0, failed: 0, results: [] };
  }
  if (policy.activationState !== "active") {
    return { status: "endpoint_review_required", selected: 0, stored: 0, failed: 0, results: [] };
  }
  const limit = normalizeLimit(options.limit);
  const approvedSourceIds = policy.sources.map((source) => source.id);
  const selected = await env.DB.prepare(`
    SELECT a.id, a.source_id AS sourceId, a.title, a.canonical_url AS canonicalUrl, a.section
    FROM articles AS a
    LEFT JOIN article_contents AS content
      ON content.article_id = a.id
      AND content.status = 'active'
      AND (content.usage_expires_at IS NULL OR content.usage_expires_at > ?)
    LEFT JOIN article_collection_attempts AS attempt
      ON attempt.article_id = a.id
    WHERE a.provider = ?
      AND a.source_id IN (${approvedSourceIds.map(() => "?").join(", ")})
      AND a.published_at >= ?
      AND a.published_at <= ?
      AND a.collected_at >= ?
      AND a.collected_at <= ?
      AND a.section IN ('politics', 'economy', 'society', 'international', 'pending')
      AND content.id IS NULL
      AND (
        attempt.article_id IS NULL
        OR (attempt.status = 'retry_wait' AND attempt.next_attempt_at <= ?)
      )
    ORDER BY a.collected_at ASC, a.id ASC
    LIMIT ?
  `).bind(now, PROVIDER, ...approvedSourceIds, start, end, start, now, now, limit).all();
  const articles = Array.isArray(selected?.results) ? selected.results : [];
  const fetchImpl = options.fetchImpl
    ?? (env?.ARTICLE_FETCHER?.fetch ? env.ARTICLE_FETCHER.fetch.bind(env.ARTICLE_FETCHER) : fetch);
  if (typeof fetchImpl !== "function") throw new TypeError("An article fetch implementation is required.");
  const requestDelay = Math.max(3000, Number(policy.polling.minimumDelayMilliseconds));
  const { createSerialRequestGate } = await import("./request-limiter.mjs");
  const beforeRequest = options.beforeRequest ?? createSerialRequestGate({
    minimumDelayMilliseconds: requestDelay,
    sleepImpl: options.sleepImpl,
  });
  const requestTimeoutMilliseconds = Number.isSafeInteger(options.requestTimeoutMilliseconds)
    ? options.requestTimeoutMilliseconds
    : policy.polling.requestTimeoutMilliseconds;
  if (requestTimeoutMilliseconds < 1 || requestTimeoutMilliseconds > 60_000) {
    throw new TypeError("requestTimeoutMilliseconds must be between 1 and 60000.");
  }
  const haltedSources = new Set();
  const results = [];
  const nowImpl = typeof options.nowImpl === "function" ? options.nowImpl : Date.now;
  const deadlineTimestamp = Number(options.deadlineTimestamp ?? Number.MAX_SAFE_INTEGER);
  if (!Number.isSafeInteger(deadlineTimestamp) || deadlineTimestamp < 0) {
    throw new TypeError("deadlineTimestamp must be a non-negative integer.");
  }
  let deadlineExceeded = false;
  for (const article of articles) {
    const source = policy.sources.find((entry) => entry.id === article.sourceId);
    if (!source) {
      results.push({ articleId: article.id, sourceId: article.sourceId, status: "failed", code: "SOURCE_NOT_APPROVED" });
      continue;
    }
    if (haltedSources.has(source.id)) {
      results.push({ articleId: article.id, sourceId: source.id, status: "skipped", code: "SOURCE_STOPPED" });
      continue;
    }
    if (nowImpl() >= deadlineTimestamp) {
      results.push({ articleId: article.id, sourceId: source.id, status: "skipped", code: "RUN_DEADLINE_EXCEEDED" });
      deadlineExceeded = true;
      break;
    }
    let fetched;
    try {
      fetched = await fetchHtml(fetchImpl, article, source, {
        userAgent: String(options.userAgent ?? "AgendaFrame-Academic-Research/1.0 (+https://agendaframe-capstone.vercel.app/)").slice(0, 300),
        requestTimeoutMilliseconds,
        beforeRequest,
        nowImpl,
        deadlineTimestamp,
      });
    } catch (error) {
      fetched = {
        status: 0,
        code: error?.code === "REQUEST_TIMEOUT"
          ? "REQUEST_TIMEOUT"
          : (error?.code === "RUN_DEADLINE_EXCEEDED" ? "RUN_DEADLINE_EXCEEDED" : "NETWORK_ERROR"),
      };
    }
    if (fetched.code === "RUN_DEADLINE_EXCEEDED") deadlineExceeded = true;
    if (deadlineExceeded) {
      results.push({ articleId: article.id, sourceId: source.id, status: "skipped", code: "RUN_DEADLINE_EXCEEDED" });
      break;
    }
    if (fetched.code === "SOURCE_STOPPED") haltedSources.add(source.id);
    if (fetched.code !== "OK") {
      await recordCollectionFailure(env, article, fetched.code, fetched.status, now);
      results.push({ articleId: article.id, sourceId: source.id, status: "failed", code: fetched.code, httpStatus: fetched.status });
      continue;
    }
    if (article.section === "pending") {
      const topic = extractArticleTopic(fetched.html);
      if (topic === "excluded") {
        await env.DB.prepare("UPDATE articles SET section = 'excluded' WHERE id = ?").bind(article.id).run();
        results.push({ articleId: article.id, sourceId: source.id, status: "skipped", code: "TOPIC_OUT_OF_SCOPE" });
        continue;
      }
      if (!topic) {
        await recordCollectionFailure(env, article, "TOPIC_UNAVAILABLE", null, now);
        results.push({ articleId: article.id, sourceId: source.id, status: "failed", code: "TOPIC_UNAVAILABLE" });
        continue;
      }
      await env.DB.prepare("UPDATE articles SET section = ? WHERE id = ?").bind(topic, article.id).run();
      article.section = topic;
    }
    try {
      const extraction = extractArticleBody(fetched.html, {
        hostname: new URL(article.canonicalUrl).hostname,
        sourceId: source.id,
      });
      if (nowImpl() >= usageExpiresAt) {
        results.push({ articleId: article.id, sourceId: source.id, status: "skipped", code: "COLLECTION_WINDOW_CLOSED" });
        continue;
      }
      const stored = await storeBody(env, article, extraction.bodyText, {
        now,
        usageBasis: "AgendaFrame academic framing research; private analysis only until 2026-10-31",
        usageExpiresAt,
        extractorVersion: "authorized-public-news-v1",
      });
      await clearCollectionFailure(env, article.id);
      results.push({
        articleId: article.id,
        sourceId: source.id,
        status: "stored",
        contentId: stored.contentId,
        bodyHash: stored.bodyHash,
        bodyCharacters: stored.bodyCharacters,
        extractionStrategy: extraction.strategy,
      });
    } catch (error) {
      const code = failureCode(error);
      await recordCollectionFailure(env, article, code, null, now);
      results.push({ articleId: article.id, sourceId: source.id, status: "failed", code });
    }
  }
  const stored = results.filter((result) => result.status === "stored").length;
  const failed = results.filter((result) => result.status === "failed").length;
  return {
    status: deadlineExceeded ? "partial" : (failed ? (stored ? "partial" : "failed") : "success"),
    deadlineExceeded,
    selected: articles.length,
    stored,
    failed,
    results,
  };
}
