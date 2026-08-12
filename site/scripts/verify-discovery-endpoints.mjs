import { readFileSync } from "node:fs";

import {
  discoverArticlesFromDocument,
  resolveDiscoveryEndpointUrl,
  validateDiscoveryPolicy,
} from "../worker/article-discovery.mjs";
import { extractArticleBody, extractArticleTopic } from "../worker/article-extractor.mjs";

const LIVE_FLAG = "AGENDAFRAME_LIVE_TESTS";
const USER_AGENT = "AgendaFrame-Academic-Research/1.0 (+https://agendaframe-capstone.vercel.app/)";
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 3;

if (process.env[LIVE_FLAG] !== "1") {
  console.error(`Refusing live publisher requests unless ${LIVE_FLAG}=1.`);
  process.exit(2);
}

const policy = JSON.parse(readFileSync(new URL("../data/discovery-sources.json", import.meta.url), "utf8"));
validateDiscoveryPolicy(policy);

const requestedSource = process.argv.find((argument) => argument.startsWith("--source="))?.split("=")[1];
const requestedSources = new Set((requestedSource ?? "").split(",").map((value) => value.trim()).filter(Boolean));
const excludedSources = new Set(
  (process.argv.find((argument) => argument.startsWith("--exclude="))?.split("=")[1] ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);
const checkBodies = process.argv.includes("--check-bodies");
const bodyOnly = process.argv.includes("--body-only");
const diagnoseBodies = process.argv.includes("--diagnose-bodies");
const sources = requestedSources.size
  ? policy.sources.filter((source) => requestedSources.has(source.id))
  : policy.sources.filter((source) => !excludedSources.has(source.id));
const observedAt = new Date().toISOString();

if (!sources.length) {
  console.error(`Unknown source: ${requestedSource}`);
  process.exit(2);
}

function attributeValue(tag, name) {
  const match = String(tag).match(new RegExp(`\\b${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "i"));
  return match?.[2] ?? "";
}

function diagnoseHtmlStructure(html) {
  const markers = [];
  for (const match of String(html).matchAll(/<([a-z][a-z0-9:-]*)\b[^>]*>/gi)) {
    const tag = match[0];
    const marker = {
      tag: match[1].toLowerCase(),
      id: attributeValue(tag, "id"),
      class: attributeValue(tag, "class"),
      itemprop: attributeValue(tag, "itemprop"),
      role: attributeValue(tag, "role"),
    };
    const identity = Object.values(marker).join(" ");
    if (/(?:article|body|content|news|story|view)/i.test(identity)) {
      markers.push(Object.fromEntries(Object.entries(marker).filter(([, value]) => value).map(([key, value]) => [key, value.slice(0, 160)])));
    }
    if (markers.length >= 40) break;
  }
  const jsonLd = [];
  for (const match of String(html).matchAll(/<script\b[^>]*type=["']application\/ld\+json[^"']*["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const value = JSON.parse(match[1].trim());
      const values = Array.isArray(value) ? value : [value];
      for (const item of values) {
        if (!item || typeof item !== "object") continue;
        jsonLd.push({
          type: item["@type"] ?? null,
          keys: Object.keys(item).slice(0, 40),
          articleBodyCharacters: typeof item.articleBody === "string" ? item.articleBody.length : 0,
        });
      }
    } catch {
      jsonLd.push({ parseError: true });
    }
  }
  const stateScripts = [...String(html).matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .map((match) => ({
      id: attributeValue(match[1], "id"),
      type: attributeValue(match[1], "type"),
      characters: match[2].length,
      bodyKey: /(?:articleBody|article_body|articleContent|newsBody|bodyText)/i.test(match[2]),
      keyHints: [...new Set(
        [...match[2].matchAll(/["']([A-Za-z][A-Za-z0-9_]*)["']\s*:/g)]
          .map((item) => item[1])
          .filter((key) => /(?:article|body|content|element|story|text)/i.test(key)),
      )].slice(0, 30),
      assignmentHints: [...new Set(
        [...match[2].matchAll(/\b([A-Za-z][A-Za-z0-9_.]*)\s*=/g)].map((item) => item[1]),
      )].slice(0, 20),
    }))
    .filter((script) => script.id || script.type === "application/json" || script.bodyKey)
    .slice(0, 20);
  const topicMetadata = [...String(html).matchAll(/<meta\b[^>]*>/gi)]
    .map((match) => ({
      key: [attributeValue(match[0], "name"), attributeValue(match[0], "property"), attributeValue(match[0], "itemprop")]
        .filter(Boolean)
        .join(" ")
        .slice(0, 160),
      content: attributeValue(match[0], "content").slice(0, 160),
    }))
    .filter((item) => /(?:section|category|genre|article)/i.test(item.key))
    .slice(0, 30);
  const topicNavigation = [...String(html).matchAll(/<([a-z][a-z0-9:-]*)\b[^>]*>/gi)]
    .map((match) => ({
      tag: match[1].toLowerCase(),
      id: attributeValue(match[0], "id").slice(0, 120),
      class: attributeValue(match[0], "class").slice(0, 120),
      href: attributeValue(match[0], "href").slice(0, 180),
    }))
    .filter((item) => /(?:active|breadcrumb|category|current|depth|location|menu|section|selected)/i.test(`${item.id} ${item.class}`))
    .slice(0, 80);
  const topicSignals = Object.fromEntries(
    ["contentsCode", "ctcd", "menuName", "articleSection", "categoryName"]
      .map((key) => [key, String(html).split(key).length - 1]),
  );
  topicSignals.menuNameValues = [...new Set(
    [...String(html).matchAll(/menuName["']?\s*[:=]\s*["']([^"']{1,80})["']/gi)].map((match) => match[1]),
  )].slice(0, 20);
  topicSignals.ctcdValues = [...new Set(
    [...String(html).matchAll(/ctcd(?:=|%3D)([0-9]{4})/gi)].map((match) => match[1]),
  )].slice(0, 20);
  const articleIndex = String(html).search(/<div\b[^>]*\bid=["']article["'][^>]*>/i);
  const articleWindow = articleIndex < 0 ? null : (() => {
    const fragment = String(html).slice(articleIndex, articleIndex + 80_000);
    const identities = [...fragment.matchAll(/<([a-z][a-z0-9:-]*)\b([^>]*)>/gi)]
      .map((match) => ({
        tag: match[1].toLowerCase(),
        id: attributeValue(match[2], "id").slice(0, 120),
        class: attributeValue(match[2], "class").slice(0, 120),
      }))
      .filter((item) => item.id || item.class)
      .slice(0, 60);
    const visibleText = fragment
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return { charactersInspected: fragment.length, visibleCharacters: visibleText.length, identities };
  })();
  return { markers, jsonLd, stateScripts, topicMetadata, topicNavigation, topicSignals, articleWindow };
}

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
let previousRequestAt = 0;

async function pacedFetch(url, options = {}) {
  const elapsed = Date.now() - previousRequestAt;
  const delay = Math.max(0, policy.polling.minimumDelayMilliseconds - elapsed);
  if (delay) await sleep(delay);
  previousRequestAt = Date.now();
  return fetch(url, {
    ...options,
    redirect: "manual",
    headers: {
      accept: options.accept ?? "text/html,application/xhtml+xml,application/rss+xml,application/xml;q=0.9,*/*;q=0.1",
      "user-agent": USER_AGENT,
    },
  });
}

function matchesDomain(hostname, domains) {
  const normalized = String(hostname).toLowerCase();
  return domains.some((domain) => normalized === domain || normalized.endsWith(`.${domain}`));
}

function approvedUrl(value, source, baseUrl = source.homepageUrl) {
  const url = new URL(String(value), baseUrl);
  if (url.protocol === "http:") url.protocol = "https:";
  if (url.protocol !== "https:" || url.username || url.password || !matchesDomain(url.hostname, source.domains)) {
    throw new TypeError("URL is outside the approved HTTPS source boundary.");
  }
  url.hash = "";
  return url;
}

async function fetchDocument(value, source, accept) {
  let currentUrl = approvedUrl(value, source);
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    const response = await pacedFetch(currentUrl, { accept });
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
    if (response.status === 403 || response.status === 429) {
      return { status: response.status, code: "SOURCE_STOPPED" };
    }
    if (!response.ok) return { status: response.status, code: "HTTP_ERROR" };
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_BYTES) {
      return { status: response.status, code: "DOCUMENT_TOO_LARGE" };
    }
    const document = await response.text();
    if (new TextEncoder().encode(document).byteLength > MAX_BYTES) {
      return { status: response.status, code: "DOCUMENT_TOO_LARGE" };
    }
    return {
      status: response.status,
      code: "OK",
      document,
      contentType: response.headers.get("content-type") ?? "",
      finalUrl: currentUrl.toString(),
    };
  }
  return { status: 0, code: "REDIRECT_REJECTED" };
}

function stripRobotsComment(line) {
  return line.replace(/\s*#.*$/, "").trim();
}

function robotsRules(text, userAgent) {
  const groups = [];
  let agents = [];
  let rules = [];
  let hasRules = false;
  const flush = () => {
    if (agents.length) groups.push({ agents, rules });
    agents = [];
    rules = [];
    hasRules = false;
  };
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = stripRobotsComment(rawLine);
    if (!line) continue;
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (field === "user-agent") {
      if (hasRules) flush();
      agents.push(value.toLowerCase());
      continue;
    }
    if ((field === "allow" || field === "disallow") && agents.length) {
      hasRules = true;
      if (value || field === "allow") rules.push({ type: field, pattern: value });
    }
  }
  flush();

  const token = userAgent.split("/")[0].toLowerCase();
  const matches = groups
    .map((group) => ({
      ...group,
      specificity: Math.max(...group.agents.map((agent) => agent === "*" ? 0 : token.includes(agent) ? agent.length : -1)),
    }))
    .filter((group) => group.specificity >= 0);
  if (!matches.length) return [];
  const specificity = Math.max(...matches.map((group) => group.specificity));
  return matches.filter((group) => group.specificity === specificity).flatMap((group) => group.rules);
}

function robotsPattern(pattern) {
  const endAnchored = pattern.endsWith("$");
  const body = (endAnchored ? pattern.slice(0, -1) : pattern)
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");
  return new RegExp(`^${body}${endAnchored ? "$" : ""}`);
}

function allowedByRobots(url, rules) {
  const path = `${url.pathname}${url.search}`;
  const matching = rules
    .filter((rule) => rule.pattern && robotsPattern(rule.pattern).test(path))
    .sort((left, right) => right.pattern.length - left.pattern.length || (left.type === "allow" ? -1 : 1));
  return matching[0]?.type !== "disallow";
}

async function reviewRobots(source) {
  const robotsUrl = new URL("/robots.txt", source.homepageUrl);
  let response;
  try {
    response = await pacedFetch(robotsUrl, { accept: "text/plain" });
  } catch (error) {
    return { code: "ROBOTS_NETWORK_ERROR", status: 0, error: String(error.message ?? error) };
  }
  if (response.status === 403 || response.status === 429) {
    return { code: "SOURCE_STOPPED", status: response.status };
  }
  if (response.status === 404 || response.status === 410) {
    return { code: "OK", status: response.status, rules: [] };
  }
  if (!response.ok) return { code: "ROBOTS_HTTP_ERROR", status: response.status };
  const text = await response.text();
  return { code: "OK", status: response.status, rules: robotsRules(text, USER_AGENT) };
}

const sourceReports = [];
for (const source of sources) {
  const report = { sourceId: source.id, robots: null, endpoints: [], body: null, ok: true };
  const robots = await reviewRobots(source);
  report.robots = { code: robots.code, status: robots.status };
  if (robots.code !== "OK") {
    report.ok = false;
    sourceReports.push(report);
    console.log(JSON.stringify(report));
    continue;
  }

  const records = new Map();
  for (const endpoint of source.endpoints) {
    const resolvedEndpointUrl = resolveDiscoveryEndpointUrl({
      policy,
      source,
      endpoint,
      discoveredAt: observedAt,
    });
    const endpointUrl = approvedUrl(resolvedEndpointUrl, source);
    if (!allowedByRobots(endpointUrl, robots.rules)) {
      report.endpoints.push({ endpointId: endpoint.id, code: "ROBOTS_DISALLOWED", status: 0, discovered: 0 });
      report.ok = false;
      continue;
    }
    let fetched;
    try {
      fetched = await fetchDocument(resolvedEndpointUrl, source);
    } catch (error) {
      fetched = { status: 0, code: "NETWORK_ERROR", error: String(error.message ?? error) };
    }
    if (fetched.code !== "OK") {
      report.endpoints.push({ endpointId: endpoint.id, code: fetched.code, status: fetched.status, discovered: 0 });
      report.ok = false;
      if (fetched.code === "SOURCE_STOPPED") break;
      continue;
    }
    const discovered = discoverArticlesFromDocument({
      policy,
      source,
      endpoint,
      document: fetched.document,
      contentType: fetched.contentType,
      discoveredAt: observedAt,
    });
    for (const article of discovered) records.set(article.canonicalUrl, article);
    const endpointReport = {
      endpointId: endpoint.id,
      code: discovered.length ? "OK" : "NO_CURRENT_ARTICLES",
      status: fetched.status,
      contentType: fetched.contentType.split(";")[0],
      discovered: discovered.length,
    };
    if (diagnoseBodies) {
      endpointReport.samplePaths = discovered.slice(0, 12).map((article) => {
        const url = new URL(article.canonicalUrl);
        return `${url.pathname}${url.search}`;
      });
    }
    report.endpoints.push(endpointReport);
    if (!discovered.length) report.ok = false;
    if (bodyOnly && discovered.length) break;
  }

  if (checkBodies && report.ok) {
    const sample = [...records.values()][0];
    if (!sample || !allowedByRobots(new URL(sample.canonicalUrl), robots.rules)) {
      report.body = { code: sample ? "ROBOTS_DISALLOWED" : "NO_SAMPLE", status: 0 };
      report.ok = false;
    } else {
      const fetched = await fetchDocument(sample.canonicalUrl, source, "text/html,application/xhtml+xml");
      if (fetched.code !== "OK") {
        report.body = {
          code: fetched.code,
          status: fetched.status,
          samplePath: `${new URL(sample.canonicalUrl).pathname}${new URL(sample.canonicalUrl).search}`,
        };
        report.ok = false;
      } else {
        try {
          const topic = sample.topic === "pending" ? extractArticleTopic(fetched.document) : sample.topic;
          if (!topic || topic === "excluded") {
            const topicError = new Error("The sample article does not establish an approved topic.");
            topicError.code = topic === "excluded" ? "TOPIC_OUT_OF_SCOPE" : "TOPIC_UNAVAILABLE";
            throw topicError;
          }
          const extraction = extractArticleBody(fetched.document, {
            hostname: new URL(sample.canonicalUrl).hostname,
            sourceId: source.id,
          });
          report.body = {
            code: "OK",
            status: fetched.status,
            strategy: extraction.strategy,
            characters: extraction.bodyText.length,
            topic,
            samplePath: `${new URL(sample.canonicalUrl).pathname}${new URL(sample.canonicalUrl).search}`,
            finalPath: `${new URL(fetched.finalUrl).pathname}${new URL(fetched.finalUrl).search}`,
          };
        } catch (error) {
          report.body = {
            code: error.code ?? "BODY_UNAVAILABLE",
            status: fetched.status,
            samplePath: `${new URL(sample.canonicalUrl).pathname}${new URL(sample.canonicalUrl).search}`,
            finalPath: `${new URL(fetched.finalUrl).pathname}${new URL(fetched.finalUrl).search}`,
          };
          if (diagnoseBodies) report.body.structure = diagnoseHtmlStructure(fetched.document);
          report.ok = false;
        }
      }
    }
  }
  sourceReports.push(report);
  console.log(JSON.stringify(report));
}

const failedSources = sourceReports.filter((report) => !report.ok).map((report) => report.sourceId);
console.log(JSON.stringify({
  summary: {
    checkedSources: sourceReports.length,
    passedSources: sourceReports.length - failedSources.length,
    failedSources,
    bodyChecks: checkBodies,
  },
}));
if (failedSources.length) process.exitCode = 1;
