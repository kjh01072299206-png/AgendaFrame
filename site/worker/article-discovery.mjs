const ALLOWED_SOURCE_TYPES = new Set(["general_daily", "broadcaster"]);
const ALLOWED_METHODS = new Set(["rss", "atom", "sitemap", "latest", "section", "homepage"]);
const ALLOWED_TOPICS = new Set(["politics", "economy", "society", "international", "mixed"]);
const TRACKING_PARAMETERS = new Set([
  "fbclid",
  "gclid",
  "igshid",
  "mc_cid",
  "mc_eid",
  "cooper",
  "plink",
  "ref",
  "spm",
]);
const EXCLUDED_URL_PATTERNS = [
  /\/(?:opinion|column|editorial)(?:\/|$)/iu,
  /\/(?:photo|photos|video|videos|gallery|cartoon)(?:\/|$)/iu,
  /\/(?:sports|sport|entertainment|culture|life|lifestyle)(?:\/|$)/iu,
  /\/(?:comment|comments|advertising|advertorial)(?:\/|$)/iu,
];
const EXCLUDED_TITLE_PATTERNS = [
  /(?:사설|칼럼|기고|오피니언|데스크칼럼|취재수첩|편집국에서|독자마당)/u,
  /(?:포토|사진뉴스|영상뉴스|다시보기|하이라이트)/u,
  /(?:광고|협찬|브랜드콘텐츠)/u,
];
const TOPIC_PATH_PATTERNS = Object.freeze({
  politics: /\/(?:politics|politic|assembly|president|government|청와대|국회|정치)(?:\/|$)/iu,
  economy: /\/(?:economy|economic|finance|industry|business|market|경제|금융|산업)(?:\/|$)/iu,
  society: /\/(?:society|social|national|local|education|health|법조|사회|전국)(?:\/|$)/iu,
  international: /\/(?:international|world|foreign|global|국제|세계)(?:\/|$)/iu,
});

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object.`);
  return value;
}

function requireDate(value, label) {
  const text = String(value ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) {
    throw new TypeError(`${label} must be an ISO date.`);
  }
  return text;
}

function matchesDomain(hostname, domains) {
  const normalized = String(hostname).toLowerCase();
  return domains.some((domain) => normalized === domain || normalized.endsWith(`.${domain}`));
}

function assertApprovedHttpsUrl(value, domains, label) {
  const url = new URL(String(value));
  if (url.protocol !== "https:") throw new TypeError(`${label} must use HTTPS.`);
  if (!matchesDomain(url.hostname, domains)) throw new TypeError(`${label} is outside the source allowlist.`);
  if (url.username || url.password) throw new TypeError(`${label} must not contain credentials.`);
  return url;
}

export function validateDiscoveryPolicy(input) {
  const policy = requireObject(input, "policy");
  if (policy.schemaVersion !== 1) throw new TypeError("Unsupported discovery policy schemaVersion.");
  const startDate = requireDate(policy.collectionWindow?.startDate, "collectionWindow.startDate");
  const endDate = requireDate(policy.collectionWindow?.endDate, "collectionWindow.endDate");
  if (startDate > endDate) throw new TypeError("The collection window is reversed.");
  if (policy.collectionWindow?.timezone !== "Asia/Seoul") throw new TypeError("The collection timezone must be Asia/Seoul.");
  if (Date.parse(policy.collectionWindow?.rawContentDeleteAfter) !== Date.parse("2026-10-31T23:59:59+09:00")) {
    throw new TypeError("The raw-content deletion deadline must be fixed to service end.");
  }
  if (policy.outletWeight !== "equal") throw new TypeError("Every outlet must have equal weight.");
  if (!["endpoint_review_required", "active"].includes(policy.activationState)) {
    throw new TypeError("The discovery activationState is invalid.");
  }
  if (JSON.stringify(policy.topics) !== JSON.stringify(["politics", "economy", "society", "international"])) {
    throw new TypeError("The discovery topics must be politics, economy, society, and international.");
  }
  if (policy.polling?.intervalMinutes !== 360
    || policy.polling?.runsPerDay !== 4
    || JSON.stringify(policy.polling?.scheduledHoursKst) !== JSON.stringify([0, 6, 12, 18])
    || policy.polling?.reconciliationLookbackDays !== 3) {
    throw new TypeError("Polling must run four times daily at 00:00, 06:00, 12:00, and 18:00 KST with a three-day reconciliation window.");
  }
  if (policy.polling?.concurrency !== 1) throw new TypeError("Discovery concurrency must remain 1.");
  if (!Number.isSafeInteger(policy.polling?.maxRecordsPerSourcePerRun)
    || policy.polling.maxRecordsPerSourcePerRun < 1
    || policy.polling.maxRecordsPerSourcePerRun > 500) {
    throw new TypeError("maxRecordsPerSourcePerRun must be an integer from 1 to 500.");
  }
  if (policy.polling?.minimumDelayMilliseconds < 3000) throw new TypeError("Source requests must be at least three seconds apart.");
  if (!Number.isSafeInteger(policy.polling?.requestTimeoutMilliseconds)
    || policy.polling.requestTimeoutMilliseconds < 1000
    || policy.polling.requestTimeoutMilliseconds > 60_000) {
    throw new TypeError("Source requests must time out between one and sixty seconds.");
  }
  if (!Array.isArray(policy.sources) || policy.sources.length !== 12) throw new TypeError("Exactly 12 sources are required.");

  const ids = new Set();
  const names = new Set();
  let dailies = 0;
  let broadcasters = 0;
  for (const source of policy.sources) {
    requireObject(source, "source");
    const id = String(source.id ?? "").trim();
    const name = String(source.name ?? "").trim();
    if (!id || ids.has(id)) throw new TypeError(`Invalid or duplicate source id: ${id}`);
    if (!name || names.has(name)) throw new TypeError(`Invalid or duplicate source name: ${name}`);
    ids.add(id);
    names.add(name);
    if (!ALLOWED_SOURCE_TYPES.has(source.sourceType)) throw new TypeError(`${id} has an unsupported sourceType.`);
    if (source.sourceType === "general_daily") dailies += 1;
    if (source.sourceType === "broadcaster") broadcasters += 1;
    if (!Array.isArray(source.domains) || !source.domains.length) throw new TypeError(`${id} needs an allowlist domain.`);
    const domains = source.domains.map((domain) => String(domain).trim().toLowerCase());
    if (domains.some((domain) => !/^[a-z0-9.-]+$/.test(domain))) throw new TypeError(`${id} has an invalid domain.`);
    assertApprovedHttpsUrl(source.homepageUrl, domains, `${id}.homepageUrl`);
    if (!Array.isArray(source.articlePathPatterns) || !source.articlePathPatterns.length) {
      throw new TypeError(`${id} needs an article-path pattern.`);
    }
    for (const pattern of source.articlePathPatterns) new RegExp(pattern, "iu");
    if (!Array.isArray(source.endpoints) || !source.endpoints.length) throw new TypeError(`${id} needs a discovery endpoint.`);
    const endpointIds = new Set();
    for (const endpoint of source.endpoints) {
      const endpointId = String(endpoint.id ?? "").trim();
      if (!endpointId || endpointIds.has(endpointId)) throw new TypeError(`${id} has an invalid endpoint id.`);
      endpointIds.add(endpointId);
      if (!ALLOWED_METHODS.has(endpoint.method)) throw new TypeError(`${id}.${endpointId} has an unsupported method.`);
      if (!ALLOWED_TOPICS.has(endpoint.topic)) throw new TypeError(`${id}.${endpointId} has an unsupported topic.`);
      assertApprovedHttpsUrl(endpoint.url, domains, `${id}.${endpointId}.url`);
      if (endpoint.allowDeferredTopic !== undefined && typeof endpoint.allowDeferredTopic !== "boolean") {
        throw new TypeError(`${id}.${endpointId}.allowDeferredTopic must be boolean.`);
      }
      if (typeof endpoint.enabled !== "boolean") throw new TypeError(`${id}.${endpointId}.enabled must be boolean.`);
    }
    if (policy.activationState === "active" && !source.endpoints.some((endpoint) => endpoint.enabled)) {
      throw new TypeError(`${id} has no reviewed endpoint enabled.`);
    }
  }
  if (dailies !== 10 || broadcasters !== 2) throw new TypeError("The panel must contain 10 dailies and 2 broadcasters.");
  return { sourceCount: policy.sources.length, dailies, broadcasters, startDate, endDate };
}

function decodeEntities(value) {
  return String(value ?? "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&");
}

function normalizeText(value) {
  return decodeEntities(value)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .normalize("NFC");
}

function firstXmlTag(block, names) {
  for (const name of names) {
    const match = block.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, "i"));
    if (match) return normalizeText(match[1]);
  }
  return "";
}

function xmlLink(block) {
  const atom = block.match(/<link\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/i);
  if (atom) return decodeEntities(atom[1]).trim();
  return firstXmlTag(block, ["link", "guid"]);
}

function normalizePublishedAt(value) {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function parseXmlEntries(document) {
  const blocks = [
    ...(String(document).match(/<item\b[\s\S]*?<\/item>/gi) ?? []),
    ...(String(document).match(/<entry\b[\s\S]*?<\/entry>/gi) ?? []),
  ];
  return blocks.map((block) => ({
    title: firstXmlTag(block, ["title"]),
    url: xmlLink(block),
    publishedAt: normalizePublishedAt(firstXmlTag(block, ["pubDate", "published", "updated", "dc:date"])),
  }));
}

function parseSitemapEntries(document) {
  const blocks = String(document).match(/<url\b[\s\S]*?<\/url>/gi) ?? [];
  return blocks.map((block) => ({
    title: firstXmlTag(block, ["news:title"]),
    url: firstXmlTag(block, ["loc"]),
    publishedAt: normalizePublishedAt(firstXmlTag(block, ["news:publication_date", "lastmod"])),
  }));
}

function attributeValue(attributes, name) {
  const match = String(attributes).match(new RegExp(`\\b${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "i"));
  return match ? decodeEntities(match[2]).trim() : "";
}

function parseHtmlEntries(document) {
  const entries = [];
  const anchorPattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = anchorPattern.exec(String(document)))) {
    const href = attributeValue(match[1], "href");
    const title = normalizeText(attributeValue(match[1], "data-title") || attributeValue(match[1], "title") || match[2]);
    if (href && title) entries.push({ title, url: href, publishedAt: null });
  }
  return entries;
}

export function canonicalizeDiscoveredUrl(value, source, baseUrl = source.homepageUrl) {
  const url = new URL(String(value), baseUrl);
  if (url.protocol === "http:") url.protocol = "https:";
  if (url.protocol !== "https:") throw new TypeError("Only HTTPS article URLs are allowed.");
  if (url.username || url.password) throw new TypeError("Article URLs must not contain credentials.");
  if (!matchesDomain(url.hostname, source.domains)) throw new TypeError("Article URL is outside the source allowlist.");
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    const normalized = key.toLowerCase();
    if (normalized.startsWith("utm_") || TRACKING_PARAMETERS.has(normalized)) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  return url.toString();
}

function looksLikeArticle(url, source) {
  const candidate = `${url.pathname}${url.search}`;
  return source.articlePathPatterns.some((pattern) => new RegExp(pattern, "iu").test(candidate));
}

function isExcluded(entry, url) {
  const candidate = `${url.pathname}${url.search}`;
  return EXCLUDED_URL_PATTERNS.some((pattern) => pattern.test(candidate))
    || EXCLUDED_TITLE_PATTERNS.some((pattern) => pattern.test(entry.title));
}

function inferTopic(endpointTopic, url) {
  if (endpointTopic !== "mixed") return endpointTopic;
  for (const [topic, pattern] of Object.entries(TOPIC_PATH_PATTERNS)) {
    if (pattern.test(url.pathname)) return topic;
  }
  return null;
}

function kstDate(instant) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(instant));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function resolveDiscoveryEndpointUrl({ policy, source, endpoint, discoveredAt }) {
  const observedAt = new Date(discoveredAt);
  if (Number.isNaN(observedAt.getTime())) throw new TypeError("discoveredAt must be a valid instant.");
  void policy;
  return canonicalizeDiscoveredUrl(endpoint.url, source, source.homepageUrl);
}

function insideWindow(publishedAt, discoveredAt, collectionWindow) {
  const date = kstDate(publishedAt ?? discoveredAt);
  return date >= collectionWindow.startDate && date <= collectionWindow.endDate;
}

function insideReconciliationWindow(publishedAt, discoveredAt, lookbackDays) {
  if (!publishedAt) return true;
  const observedDate = kstDate(discoveredAt);
  const observedStart = Date.parse(`${observedDate}T00:00:00+09:00`);
  const earliest = observedStart - (Math.max(1, Number(lookbackDays)) - 1) * 86_400_000;
  return Date.parse(publishedAt) >= earliest;
}

function richerEntry(left, right) {
  return {
    ...left,
    title: right.title.length > left.title.length ? right.title : left.title,
    publishedAt: left.publishedAt ?? right.publishedAt,
    topic: left.topic ?? right.topic,
  };
}

export function discoverArticlesFromDocument({ policy, source, endpoint, document, contentType = "", discoveredAt }) {
  const observedAt = new Date(discoveredAt);
  if (Number.isNaN(observedAt.getTime())) throw new TypeError("discoveredAt must be a valid instant.");
  const type = String(contentType).toLowerCase();
  const entries = endpoint.method === "sitemap"
    ? parseSitemapEntries(document)
    : endpoint.method === "rss" || endpoint.method === "atom" || type.includes("xml")
      ? parseXmlEntries(document)
      : parseHtmlEntries(document);
  const deduplicated = new Map();
  for (const entry of entries) {
    if (!entry.url || !entry.title || entry.title.length > 500) continue;
    let canonicalUrl;
    try {
      canonicalUrl = canonicalizeDiscoveredUrl(entry.url, source, endpoint.url);
    } catch {
      continue;
    }
    const url = new URL(canonicalUrl);
    if (!looksLikeArticle(url, source) || isExcluded(entry, url)) continue;
    if (!insideWindow(entry.publishedAt, observedAt, policy.collectionWindow)) continue;
    if (!insideReconciliationWindow(entry.publishedAt, observedAt, policy.polling.reconciliationLookbackDays)) continue;
    const pathTopic = inferTopic("mixed", url);
    if (endpoint.topic !== "mixed" && pathTopic && pathTopic !== endpoint.topic) continue;
    const topic = inferTopic(endpoint.topic, url);
    if (!topic && !endpoint.allowDeferredTopic) continue;
    const record = {
      sourceId: source.id,
      sourceName: source.name,
      sourceType: source.sourceType,
      title: entry.title,
      canonicalUrl,
      publishedAt: entry.publishedAt,
      discoveredAt: observedAt.toISOString(),
      discoveryMethod: endpoint.method,
      discoveryEndpointId: endpoint.id,
      topic: topic ?? "pending",
    };
    const current = deduplicated.get(canonicalUrl);
    deduplicated.set(canonicalUrl, current ? richerEntry(current, record) : record);
  }
  return [...deduplicated.values()];
}

async function fetchWithTimeout(fetchImpl, url, init, timeoutMilliseconds) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMilliseconds);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) {
      const timeout = new Error("The source request timed out.");
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

async function fetchEndpointDocument(fetchImpl, source, endpoint, options) {
  let currentUrl = options.resolvedUrl;
  for (let redirects = 0; redirects <= options.maxRedirects; redirects += 1) {
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
        accept: "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/html;q=0.8, */*;q=0.1",
        "user-agent": options.userAgent,
      },
    }, options.requestTimeoutMilliseconds);
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location || redirects === options.maxRedirects) return { status: response.status, code: "REDIRECT_REJECTED" };
      try {
        currentUrl = canonicalizeDiscoveredUrl(location, source, currentUrl);
      } catch {
        return { status: response.status, code: "REDIRECT_REJECTED" };
      }
      continue;
    }
    if (response.status === 403 || response.status === 429) return { status: response.status, code: "SOURCE_STOPPED" };
    if (!response.ok) return { status: response.status, code: "HTTP_ERROR" };
    const length = Number(response.headers.get("content-length"));
    if (Number.isFinite(length) && length > options.maxDocumentBytes) return { status: response.status, code: "DOCUMENT_TOO_LARGE" };
    const document = await readTextWithByteLimit(response, options.maxDocumentBytes);
    if (document === null) return { status: response.status, code: "DOCUMENT_TOO_LARGE" };
    return { status: response.status, code: "OK", document, contentType: response.headers.get("content-type") ?? "" };
  }
  return { status: 0, code: "REDIRECT_REJECTED" };
}

export async function runDiscoveryCycle(policy, options = {}) {
  validateDiscoveryPolicy(policy);
  if (typeof options.fetchImpl !== "function") throw new TypeError("An explicit fetchImpl is required.");
  const discoveredAt = new Date(options.now ?? Date.now());
  if (Number.isNaN(discoveredAt.getTime())) throw new TypeError("now must be a valid instant.");
  if (!insideWindow(null, discoveredAt, policy.collectionWindow)) {
    return { status: "outside_collection_window", discoveredAt: discoveredAt.toISOString(), records: [], sources: [] };
  }
  const fetchOptions = {
    maxRedirects: Number.isInteger(options.maxRedirects) ? options.maxRedirects : 3,
    maxDocumentBytes: Number.isInteger(options.maxDocumentBytes) ? options.maxDocumentBytes : 2 * 1024 * 1024,
    userAgent: String(options.userAgent ?? "AgendaFrame-Academic-Research/1.0 (+https://agendaframe-capstone.vercel.app/)")
      .slice(0, 300),
    requestTimeoutMilliseconds: Number.isSafeInteger(options.requestTimeoutMilliseconds)
      ? options.requestTimeoutMilliseconds
      : policy.polling.requestTimeoutMilliseconds,
  };
  if (fetchOptions.requestTimeoutMilliseconds < 1 || fetchOptions.requestTimeoutMilliseconds > 60_000) {
    throw new TypeError("requestTimeoutMilliseconds must be between 1 and 60000.");
  }
  const { createSerialRequestGate } = await import("./request-limiter.mjs");
  const beforeRequest = options.beforeRequest ?? createSerialRequestGate({
    minimumDelayMilliseconds: policy.polling.minimumDelayMilliseconds,
    sleepImpl: options.sleepImpl,
  });
  const records = new Map();
  const sourceResults = [];
  const nowImpl = typeof options.nowImpl === "function" ? options.nowImpl : Date.now;
  const deadlineTimestamp = Number(options.deadlineTimestamp ?? Number.MAX_SAFE_INTEGER);
  if (!Number.isSafeInteger(deadlineTimestamp) || deadlineTimestamp < 0) {
    throw new TypeError("deadlineTimestamp must be a non-negative integer.");
  }
  let deadlineExceeded = false;
  for (const source of policy.sources) {
    const result = { sourceId: source.id, status: "success", endpointsRequested: 0, discovered: 0, truncated: false, diagnostics: [] };
    let sourceRecordCount = 0;
    const endpoints = source.endpoints.filter((endpoint) => endpoint.enabled);
    if (!endpoints.length) {
      result.status = "skipped_endpoint_review_required";
      sourceResults.push(result);
      continue;
    }
    for (const endpoint of endpoints.slice(0, policy.polling.maxRequestsPerSourcePerRun)) {
      if (nowImpl() >= deadlineTimestamp) {
        result.status = "partial";
        result.diagnostics.push({ endpointId: endpoint.id, status: 0, code: "RUN_DEADLINE_EXCEEDED" });
        deadlineExceeded = true;
        break;
      }
      result.endpointsRequested += 1;
      let fetched;
      try {
        const resolvedUrl = resolveDiscoveryEndpointUrl({ policy, source, endpoint, discoveredAt });
        fetched = await fetchEndpointDocument(options.fetchImpl, source, endpoint, {
          ...fetchOptions,
          resolvedUrl,
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
      result.diagnostics.push({ endpointId: endpoint.id, status: fetched.status, code: fetched.code });
      if (fetched.code === "SOURCE_STOPPED") {
        result.status = "stopped_access_restriction";
        break;
      }
      if (fetched.code !== "OK") {
        result.status = "partial";
        if (deadlineExceeded) break;
        continue;
      }
      const found = discoverArticlesFromDocument({
        policy,
        source,
        endpoint,
        document: fetched.document,
        contentType: fetched.contentType,
        discoveredAt,
      });
      const newestFirst = [...found].sort((left, right) => Date.parse(right.publishedAt ?? right.discoveredAt) - Date.parse(left.publishedAt ?? left.discoveredAt));
      for (const record of newestFirst) {
        const current = records.get(record.canonicalUrl);
        if (!current && sourceRecordCount >= policy.polling.maxRecordsPerSourcePerRun) {
          result.truncated = true;
          continue;
        }
        records.set(record.canonicalUrl, current ? richerEntry(current, record) : record);
        if (!current) sourceRecordCount += 1;
      }
      if (result.truncated) {
        result.diagnostics.push({ endpointId: endpoint.id, status: fetched.status, code: "RECORD_LIMIT_REACHED" });
        break;
      }
    }
    result.discovered = [...records.values()].filter((record) => record.sourceId === source.id).length;
    sourceResults.push(result);
    if (deadlineExceeded) break;
  }
  return {
    status: deadlineExceeded || sourceResults.some((result) => result.status === "stopped_access_restriction" || result.status === "partial") ? "partial" : "success",
    deadlineExceeded,
    discoveredAt: discoveredAt.toISOString(),
    records: [...records.values()],
    sources: sourceResults,
  };
}
