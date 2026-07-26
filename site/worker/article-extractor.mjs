const MIN_BODY_CHARACTERS = 280;
const MAX_BODY_CHARACTERS = 200_000;
const MIN_ACCEPTABLE_QUALITY = 0.54;

const BLOCK_TAGS = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "div",
  "figcaption",
  "figure",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "li",
  "main",
  "p",
  "section",
  "table",
  "td",
  "tr",
]);

const VOID_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

const ALWAYS_REMOVE_TAGS = new Set([
  "button",
  "canvas",
  "dialog",
  "footer",
  "form",
  "header",
  "iframe",
  "nav",
  "noscript",
  "script",
  "style",
  "svg",
  "template",
]);

const NOISE_ATTRIBUTE_PATTERN =
  /(?:^|[\s_-])(?:ad(?:vert(?:isement|ising)?)?|banner|breadcrumb|caption|comment|copyright|floating|journalist|keyword|login|most[-_ ]?viewed|newsletter|paywall|photo|popular|ranking|reaction|recommend(?:ed)?|related|reporter|share|social|sns|subscribe|subscription|tag[-_ ]?list|toolbar|utility)(?:$|[\s_-])/i;

const BODY_ATTRIBUTE_PATTERN =
  /(?:^|[\s_-])(?:article[-_ ]?(?:body|content|text)|articlebody(?:content)?|article[-_ ]?view[-_ ]?content(?:[-_ ]?div)?|content[-_ ]?body|news[-_ ]?(?:article[-_ ]?)?(?:body|content|text)|newsbody|news[-_ ]?body[-_ ]?id|story[-_ ]?(?:body|content)|view[-_ ]?content)(?:$|[\s_-])/i;

const CHOSUN_BODY_PATTERN =
  /(?:^|[\s_-])(?:news[-_ ]?body[-_ ]?id|article[-_ ]?body|articlebody|news[-_ ]?content)(?:$|[\s_-])/i;

const HANKOOKILBO_BODY_PATTERN =
  /(?:^|[\s_-])(?:article[-_ ]?body|article[-_ ]?body[-_ ]?content|article[-_ ]?view[-_ ]?content(?:[-_ ]?div)?|editor[-_ ]?content|news[-_ ]?body)(?:$|[\s_-])/i;

const RESTRICTED_TEXT_PATTERNS = [
  /유료\s*(?:회원|구독자)?\s*(?:전용|기사|콘텐츠)/i,
  /(?:회원|구독자)\s*전용\s*(?:기사|콘텐츠)/i,
  /(?:로그인|구독)\s*(?:후|해야)\s*(?:기사|본문|내용|콘텐츠).{0,20}(?:읽|보|이용)/i,
  /기사(?:의)?\s*(?:나머지|전체|전문).{0,24}(?:구독|로그인)/i,
  /(?:기사를|계속)\s*읽으시려면.{0,24}(?:구독|로그인)/i,
  /이\s*콘텐츠는.{0,20}(?:유료|구독자|회원)\s*(?:전용)?/i,
  /(?:premium|subscriber)[ -]only\s+(?:article|content)/i,
  /(?:subscribe|sign in|log in)\s+to\s+(?:continue|read)/i,
];

const RESTRICTED_ATTRIBUTE_PATTERN =
  /(?:^|[\s_-])(?:article[-_ ]?lock|locked|login[-_ ]?wall|paywall|premium[-_ ]?gate|subscriber[-_ ]?only|subscription[-_ ]?wall)(?:$|[\s_-])/i;

const BOILERPLATE_LINE_PATTERNS = [
  /^(?:홈|메뉴|로그인|회원가입|구독|공유|댓글|인쇄|글자크기|다크모드)$/,
  /^(?:관련|추천|인기|주요|많이\s*본)\s*(?:기사|뉴스)$/,
  /^(?:이전|다음)\s*(?:기사|뉴스)$/,
  /^[가-힣]{2,5}\s*기자(?:\s*[|·]\s*[\w.+-]+@[\w.-]+)?$/u,
  /^[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}$/,
  /(?:무단\s*전재|재배포\s*금지|저작권자\s*©|all rights reserved)/i,
  /^(?:제보|문의)\s*[:：]/,
];

const STRATEGY_BONUS = {
  "json-ld": 0.15,
  "source-selector": 0.13,
  "itemprop": 0.13,
  "body-selector": 0.11,
  "script-state": 0.09,
  article: 0.06,
  "body-meta": 0.04,
};

const HTML_ENTITY_MAP = {
  amp: "&",
  apos: "'",
  gt: ">",
  hellip: "…",
  ldquo: "“",
  lsquo: "‘",
  lt: "<",
  mdash: "—",
  middot: "·",
  nbsp: " ",
  ndash: "–",
  quot: '"',
  rdquo: "”",
  rsquo: "’",
};

export class ArticleExtractionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ArticleExtractionError";
    this.code = code;
  }
}

function clamp(value, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, value));
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function decodeHtmlEntities(value) {
  return String(value ?? "").replace(
    /&(#x[0-9a-f]+|#\d+|amp|apos|gt|hellip|ldquo|lsquo|lt|mdash|middot|nbsp|ndash|quot|rdquo|rsquo);/gi,
    (match, entity) => {
      const normalized = entity.toLowerCase();
      if (normalized.startsWith("#x")) {
        const codePoint = Number.parseInt(normalized.slice(2), 16);
        return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
      }
      if (normalized.startsWith("#")) {
        const codePoint = Number.parseInt(normalized.slice(1), 10);
        return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
      }
      return HTML_ENTITY_MAP[normalized] ?? match;
    },
  );
}

function decodeJsonScriptText(value) {
  return String(value ?? "")
    .replace(/^\s*<!--|-->\s*$/g, "")
    .replace(/^\s*\/\*<!\[CDATA\[\*\/|\/\*\]\]>\*\/\s*$/g, "")
    .trim();
}

function normalizeArticleText(value) {
  const lines = String(value ?? "")
    .normalize("NFC")
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[\t \u00a0]+/g, " ").trim())
    .filter(Boolean)
    .filter((line) => !BOILERPLATE_LINE_PATTERNS.some((pattern) => pattern.test(line)));

  const deduplicated = [];
  for (const line of lines) {
    if (deduplicated.at(-1) !== line) deduplicated.push(line);
  }
  return deduplicated.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function attributeValue(openingTag, name) {
  const escapedName = escapeRegExp(name);
  const quoted = new RegExp(`\\b${escapedName}\\s*=\\s*([\"'])([\\s\\S]*?)\\1`, "i").exec(openingTag);
  if (quoted) return decodeHtmlEntities(quoted[2]);
  const unquoted = new RegExp(`\\b${escapedName}\\s*=\\s*([^\\s>]+)`, "i").exec(openingTag);
  return unquoted ? decodeHtmlEntities(unquoted[1]) : "";
}

function elementIdentity(openingTag) {
  return [
    attributeValue(openingTag, "id"),
    attributeValue(openingTag, "class"),
    attributeValue(openingTag, "role"),
    attributeValue(openingTag, "data-component"),
    attributeValue(openingTag, "data-testid"),
    attributeValue(openingTag, "data-module"),
  ]
    .filter(Boolean)
    .join(" ");
}

function isClosingTag(tag) {
  return /^<\s*\//.test(tag);
}

function isSelfClosingTag(tag, tagName) {
  return VOID_TAGS.has(tagName) || /\/\s*>$/.test(tag);
}

function findElementEnd(source, tagName, contentStart) {
  const matcher = new RegExp(`<\\/?${escapeRegExp(tagName)}\\b[^>]*>`, "gi");
  matcher.lastIndex = contentStart;
  let depth = 1;
  let match;
  while ((match = matcher.exec(source))) {
    if (isClosingTag(match[0])) {
      depth -= 1;
      if (depth === 0) {
        return { contentEnd: match.index, elementEnd: matcher.lastIndex };
      }
    } else if (!isSelfClosingTag(match[0], tagName)) {
      depth += 1;
    }
  }
  return null;
}

function extractElementCandidates(source, predicate, strategy) {
  const candidates = [];
  const openingTagPattern = /<([a-z][a-z0-9:-]*)\b[^>]*>/gi;
  let match;
  while ((match = openingTagPattern.exec(source))) {
    const tagName = match[1].toLowerCase();
    const openingTag = match[0];
    if (isSelfClosingTag(openingTag, tagName) || !predicate(tagName, openingTag)) continue;
    const boundary = findElementEnd(source, tagName, openingTagPattern.lastIndex);
    if (!boundary) continue;
    candidates.push({
      rawHtml: source.slice(openingTagPattern.lastIndex, boundary.contentEnd),
      strategy,
      sourceOffset: match.index,
    });
  }
  return candidates;
}

function removableElementIntervals(source) {
  const intervals = [];
  const stack = [];
  const tagPattern = /<\/?([a-z][a-z0-9:-]*)\b[^>]*>/gi;
  let match;
  while ((match = tagPattern.exec(source))) {
    const tagName = match[1].toLowerCase();
    const tag = match[0];
    if (isClosingTag(tag)) {
      let stackIndex = stack.length - 1;
      while (stackIndex >= 0 && stack[stackIndex].tagName !== tagName) stackIndex -= 1;
      if (stackIndex < 0) continue;
      const opened = stack[stackIndex];
      stack.length = stackIndex;
      if (opened.remove && !opened.parentRemoved) intervals.push([opened.start, tagPattern.lastIndex]);
      continue;
    }

    const identity = elementIdentity(tag);
    const parentRemoved = stack.some((entry) => entry.remove || entry.parentRemoved);
    const remove = ALWAYS_REMOVE_TAGS.has(tagName) || NOISE_ATTRIBUTE_PATTERN.test(identity);
    if (isSelfClosingTag(tag, tagName)) {
      if (remove && !parentRemoved) intervals.push([match.index, tagPattern.lastIndex]);
      continue;
    }
    stack.push({ tagName, start: match.index, remove, parentRemoved });
  }
  return intervals.sort((left, right) => left[0] - right[0]);
}

function removeIntervals(source, intervals) {
  let result = "";
  let cursor = 0;
  for (const [start, end] of intervals) {
    if (start < cursor) continue;
    result += source.slice(cursor, start);
    cursor = end;
  }
  return result + source.slice(cursor);
}

function htmlFragmentToText(value) {
  let source = String(value ?? "").replace(/<!--[\s\S]*?-->/g, " ");
  source = removeIntervals(source, removableElementIntervals(source));
  source = source
    .replace(/<(?:br|hr)\b[^>]*\/?\s*>/gi, "\n")
    .replace(/<\/?([a-z][a-z0-9:-]*)\b[^>]*>/gi, (tag, tagName) =>
      BLOCK_TAGS.has(String(tagName).toLowerCase()) ? "\n" : " ",
    );
  return normalizeArticleText(decodeHtmlEntities(source));
}

function normalizeCandidateValue(value) {
  const source = String(value ?? "").trim();
  if (!source) return "";
  return /<[a-z][\s\S]*>/i.test(source)
    ? htmlFragmentToText(source)
    : normalizeArticleText(decodeHtmlEntities(source.replace(/\\n/g, "\n")));
}

function recursiveArticleBodies(value, path = [], seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return [];
  seen.add(value);
  const bodies = [];
  if (Array.isArray(value)) {
    for (const item of value) bodies.push(...recursiveArticleBodies(item, path, seen));
    return bodies;
  }
  for (const [key, child] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase().replace(/[^a-z]/g, "");
    const nextPath = [...path, key];
    const context = nextPath.join(".").toLowerCase();
    const exactBodyKey = [
      "articlebody",
      "articlecontent",
      "bodytext",
      "contentbody",
      "fulltext",
      "newsbody",
      "storybody",
    ].includes(normalizedKey);
    const contextualBodyKey =
      ["body", "content", "text"].includes(normalizedKey) &&
      /(?:article|news|post|story)/i.test(context);
    if (typeof child === "string" && (exactBodyKey || contextualBodyKey)) {
      bodies.push(child);
    } else if (child && typeof child === "object") {
      bodies.push(...recursiveArticleBodies(child, nextPath, seen));
    }
  }
  return bodies;
}

function inspectJsonLd(value, result) {
  if (Array.isArray(value)) {
    for (const item of value) inspectJsonLd(item, result);
    return;
  }
  if (!value || typeof value !== "object") return;
  const type = Array.isArray(value["@type"]) ? value["@type"].join(" ") : String(value["@type"] ?? "");
  const articleLike = /(?:Article|NewsArticle|ReportageNewsArticle)/i.test(type);
  const accessible = value.isAccessibleForFree;
  if (
    articleLike &&
    (accessible === false || String(accessible).trim().toLowerCase() === "false")
  ) {
    result.blocked = true;
  }
  if (articleLike && typeof value.articleBody === "string") result.bodies.push(value.articleBody);
  for (const child of Object.values(value)) {
    if (child && typeof child === "object") inspectJsonLd(child, result);
  }
}

function jsonLdCandidates(source) {
  const result = { blocked: false, candidates: [] };
  for (const match of source.matchAll(
    /<script\b[^>]*type\s*=\s*["']application\/ld\+json(?:\s*;\s*charset=[^"']+)?["'][^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    const jsonText = decodeJsonScriptText(match[1]);
    if (!jsonText) continue;
    try {
      const inspection = { blocked: false, bodies: [] };
      inspectJsonLd(JSON.parse(jsonText), inspection);
      result.blocked ||= inspection.blocked;
      for (const body of inspection.bodies) {
        result.candidates.push({ rawText: body, strategy: "json-ld", sourceOffset: match.index });
      }
    } catch {
      // Publisher JSON-LD is often malformed. Other explicit extraction paths remain available.
    }
  }
  return result;
}

function scriptStateCandidates(source) {
  const candidates = [];
  for (const match of source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const openingTag = `<script${match[1]}>`;
    const type = attributeValue(openingTag, "type").toLowerCase();
    const id = attributeValue(openingTag, "id");
    const safeStateScript =
      type === "application/json" ||
      /^(?:__NEXT_DATA__|__NUXT_DATA__|__APOLLO_STATE__|__INITIAL_STATE__)$/i.test(id);
    if (!safeStateScript) continue;
    const jsonText = decodeJsonScriptText(match[2]);
    if (!jsonText || jsonText.length > 4_000_000) continue;
    try {
      for (const body of recursiveArticleBodies(JSON.parse(jsonText))) {
        candidates.push({ rawText: body, strategy: "script-state", sourceOffset: match.index });
      }
    } catch {
      // Only valid structured state is considered. Executable JavaScript is never evaluated.
    }
  }
  return candidates;
}

function bodyMetaCandidates(source) {
  const candidates = [];
  for (const match of source.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = match[0];
    const key = [
      attributeValue(tag, "name"),
      attributeValue(tag, "property"),
      attributeValue(tag, "itemprop"),
    ]
      .join(" ")
      .toLowerCase()
      .replace(/[^a-z]/g, "");
    if (!["articlebody", "articlecontent", "newsbody", "storybody"].includes(key)) continue;
    const content = attributeValue(tag, "content");
    if (content) candidates.push({ rawText: content, strategy: "body-meta", sourceOffset: match.index });
  }
  for (const match of source.matchAll(
    /<([a-z][a-z0-9:-]*)\b[^>]*\bdata-(?:article-body|news-body)\s*=\s*(["'])([\s\S]*?)\2[^>]*>/gi,
  )) {
    candidates.push({
      rawText: decodeHtmlEntities(match[3]),
      strategy: "body-meta",
      sourceOffset: match.index,
    });
  }
  return candidates;
}

function hasStructuredRestriction(source) {
  for (const match of source.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = match[0];
    const key = [attributeValue(tag, "name"), attributeValue(tag, "property"), attributeValue(tag, "itemprop")]
      .join(" ")
      .toLowerCase()
      .replace(/[^a-z]/g, "");
    const value = attributeValue(tag, "content").trim().toLowerCase();
    if (key === "isaccessibleforfree" && value === "false") return true;
  }
  return false;
}

function hasVisibleRestriction(source) {
  const restrictedContainers = extractElementCandidates(
    source,
    (_tagName, openingTag) => RESTRICTED_ATTRIBUTE_PATTERN.test(elementIdentity(openingTag)),
    "restriction",
  );
  if (
    restrictedContainers.some(({ rawHtml }) =>
      RESTRICTED_TEXT_PATTERNS.some((pattern) => pattern.test(htmlFragmentToText(rawHtml))),
    )
  ) {
    return true;
  }
  const pageText = htmlFragmentToText(source);
  const strongMatches = RESTRICTED_TEXT_PATTERNS.filter((pattern) => pattern.test(pageText)).length;
  return strongMatches >= 2 && pageText.length < 3_000;
}

function sourceFamily(hostname, sourceId) {
  const normalized = `${hostname ?? ""} ${sourceId ?? ""}`.toLowerCase();
  if (/(?:^|[.\s_-])chosun(?:\.com|biz|$)|조선/.test(normalized)) return "chosun";
  if (/hankookilbo|한국일보/.test(normalized)) return "hankookilbo";
  return "generic";
}

function selectorCandidates(source, hostname, sourceId) {
  const family = sourceFamily(hostname, sourceId);
  const candidates = [];
  const sourcePattern =
    family === "chosun"
      ? CHOSUN_BODY_PATTERN
      : family === "hankookilbo"
        ? HANKOOKILBO_BODY_PATTERN
        : null;

  if (sourcePattern) {
    candidates.push(
      ...extractElementCandidates(
        source,
        (_tagName, openingTag) => sourcePattern.test(elementIdentity(openingTag)),
        "source-selector",
      ),
    );
  }

  candidates.push(
    ...extractElementCandidates(
      source,
      (_tagName, openingTag) => {
        const itemprop = attributeValue(openingTag, "itemprop");
        return /(?:^|\s)articleBody(?:\s|$)/i.test(itemprop);
      },
      "itemprop",
    ),
    ...extractElementCandidates(
      source,
      (_tagName, openingTag) => BODY_ATTRIBUTE_PATTERN.test(elementIdentity(openingTag)),
      "body-selector",
    ),
    ...extractElementCandidates(source, (tagName) => tagName === "article", "article"),
  );
  return candidates;
}

function textStatistics(rawHtml, bodyText) {
  const compact = bodyText.replace(/\s/g, "");
  const meaningfulCharacters = (compact.match(/[\p{L}\p{N}]/gu) ?? []).length;
  const punctuation = (bodyText.match(/[.!?。！？](?:["'”’)]|$|\s)/gu) ?? []).length;
  const KoreanEndings = (bodyText.match(/[가-힣](?:다|요|죠|음|함)[.!?](?:\s|$)/gu) ?? []).length;
  const paragraphs = bodyText.split("\n").filter((line) => line.length >= 35).length;
  const anchors = [...String(rawHtml ?? "").matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)];
  const anchorCharacters = anchors.reduce(
    (total, match) => total + htmlFragmentToText(match[1]).replace(/\s/g, "").length,
    0,
  );
  const shortLines = bodyText
    .split("\n")
    .filter(Boolean)
    .filter((line) => line.length < 18).length;
  const lineCount = Math.max(1, bodyText.split("\n").filter(Boolean).length);
  const boilerplateHits = [
    /많이\s*본\s*뉴스/gi,
    /관련\s*기사/gi,
    /로그인/gi,
    /회원가입/gi,
    /뉴스레터/gi,
    /추천\s*기사/gi,
    /무단\s*전재/gi,
  ].reduce((total, pattern) => total + (bodyText.match(pattern) ?? []).length, 0);
  return {
    anchorRatio: compact.length ? anchorCharacters / compact.length : 1,
    boilerplateHits,
    lineCount,
    meaningfulRatio: compact.length ? meaningfulCharacters / compact.length : 0,
    paragraphs,
    sentenceSignals: punctuation + KoreanEndings,
    shortLineRatio: shortLines / lineCount,
  };
}

function qualityScore(rawHtml, bodyText, strategy) {
  const length = bodyText.length;
  if (length < MIN_BODY_CHARACTERS || length > MAX_BODY_CHARACTERS) return 0;
  const stats = textStatistics(rawHtml, bodyText);
  const lengthScore =
    length < 450
      ? 0.08
      : length < 800
        ? 0.16
        : length < 1_500
          ? 0.23
          : length < 8_000
            ? 0.28
            : 0.25;
  const structureScore =
    clamp(stats.sentenceSignals / 10) * 0.12 + clamp(stats.paragraphs / 5) * 0.1;
  const languageScore = clamp((stats.meaningfulRatio - 0.45) / 0.4) * 0.17;
  const linkPenalty = clamp((stats.anchorRatio - 0.08) / 0.42) * 0.28;
  const shortLinePenalty = clamp((stats.shortLineRatio - 0.45) / 0.45) * 0.1;
  const boilerplatePenalty = clamp(stats.boilerplateHits / 5) * 0.18;
  const repetitionPenalty = repeatedLineRatio(bodyText) * 0.18;
  return clamp(
    0.2 +
      lengthScore +
      structureScore +
      languageScore +
      (STRATEGY_BONUS[strategy] ?? 0) -
      linkPenalty -
      shortLinePenalty -
      boilerplatePenalty -
      repetitionPenalty,
  );
}

function repeatedLineRatio(bodyText) {
  const lines = bodyText
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length >= 20);
  if (lines.length < 2) return 0;
  const unique = new Set(lines);
  return (lines.length - unique.size) / lines.length;
}

function candidateResult(candidate) {
  const bodyText = normalizeCandidateValue(candidate.rawText ?? candidate.rawHtml);
  if (RESTRICTED_TEXT_PATTERNS.some((pattern) => pattern.test(bodyText))) {
    throw new ArticleExtractionError(
      "ACCESS_RESTRICTED",
      "로그인·구독 또는 유료 접근이 필요한 기사 본문은 추출하지 않습니다.",
    );
  }
  return {
    bodyText,
    strategy: candidate.strategy,
    quality: qualityScore(candidate.rawHtml ?? "", bodyText, candidate.strategy),
    sourceOffset: candidate.sourceOffset ?? Number.MAX_SAFE_INTEGER,
  };
}

/**
 * Extracts article text from already-fetched, public HTML without evaluating scripts.
 *
 * @param {string} html
 * @param {{hostname?: string, sourceId?: string}} [options]
 * @returns {{bodyText: string, strategy: string, quality: number}}
 * @throws {ArticleExtractionError} ACCESS_RESTRICTED or BODY_UNAVAILABLE
 */
export function extractArticleBody(html, options = {}) {
  const source = String(html ?? "");
  if (!source.trim()) {
    throw new ArticleExtractionError("BODY_UNAVAILABLE", "빈 HTML에서는 기사 본문을 확인할 수 없습니다.");
  }

  const jsonLd = jsonLdCandidates(source);
  if (jsonLd.blocked || hasStructuredRestriction(source) || hasVisibleRestriction(source)) {
    throw new ArticleExtractionError(
      "ACCESS_RESTRICTED",
      "로그인·구독 또는 유료 접근이 필요한 기사 본문은 추출하지 않습니다.",
    );
  }

  const candidates = [
    ...jsonLd.candidates,
    ...scriptStateCandidates(source),
    ...bodyMetaCandidates(source),
    ...selectorCandidates(source, options.hostname, options.sourceId),
  ];

  const uniqueCandidates = new Map();
  for (const candidate of candidates) {
    const result = candidateResult(candidate);
    if (!result.bodyText) continue;
    const fingerprint = result.bodyText.slice(0, 320) + result.bodyText.slice(-160);
    const existing = uniqueCandidates.get(fingerprint);
    if (!existing || result.quality > existing.quality) uniqueCandidates.set(fingerprint, result);
  }

  const best = [...uniqueCandidates.values()].sort(
    (left, right) =>
      right.quality - left.quality ||
      right.bodyText.length - left.bodyText.length ||
      left.sourceOffset - right.sourceOffset,
  )[0];

  if (!best || best.quality < MIN_ACCEPTABLE_QUALITY) {
    throw new ArticleExtractionError(
      "BODY_UNAVAILABLE",
      "페이지 셸이나 메뉴가 아닌 신뢰할 수 있는 기사 본문을 확인하지 못했습니다.",
    );
  }
  return {
    bodyText: best.bodyText,
    strategy: best.strategy,
    quality: Number(best.quality.toFixed(3)),
  };
}

export const ARTICLE_EXTRACTION_LIMITS = Object.freeze({
  minBodyCharacters: MIN_BODY_CHARACTERS,
  maxBodyCharacters: MAX_BODY_CHARACTERS,
  minAcceptableQuality: MIN_ACCEPTABLE_QUALITY,
});
