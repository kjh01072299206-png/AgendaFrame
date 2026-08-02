const FORBIDDEN_EXACT_KEYS = new Set([
  "rawbody",
  "bodytext",
  "sentencetext",
  "html",
  "fullarticle",
  "articlecontent",
  "fullcontent",
  "content",
  "body",
  "text",
]);

const FORBIDDEN_KEY_FRAGMENTS = [
  "rawbody",
  "rawtext",
  "rawtokens",
  "bodytext",
  "sentencetext",
  "fullarticle",
  "articlecontent",
  "fullcontent",
  "rawhtml",
];

function normalizedKey(key) {
  return String(key).replace(/[-_]/g, "").toLowerCase();
}

export function isForbiddenPublicKey(key) {
  const normalized = normalizedKey(key);
  return (
    FORBIDDEN_EXACT_KEYS.has(normalized) ||
    FORBIDDEN_KEY_FRAGMENTS.some((fragment) => normalized.includes(fragment))
  );
}

/**
 * Copy source metadata while dropping fields that could contain article text.
 * This is intentionally a projection rather than a generic JSON clone so a
 * future source field cannot silently become public content without passing
 * the leakage contract.
 */
export function projectPublicValue(value, key = "") {
  if (key && isForbiddenPublicKey(key)) return undefined;
  if (value === null) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => projectPublicValue(item, key))
      .filter((item) => item !== undefined);
  }
  if (typeof value !== "object") return undefined;

  const result = {};
  for (const [childKey, childValue] of Object.entries(value)) {
    const projected = projectPublicValue(childValue, childKey);
    if (projected !== undefined) result[childKey] = projected;
  }
  return result;
}

export function assertNoForbiddenPublicKeys(value, path = "$", seen = new WeakSet()) {
  if (!value || typeof value !== "object") return;
  if (seen.has(value)) throw new Error(`Cyclic public value at ${path}`);
  seen.add(value);

  try {
    if (Array.isArray(value)) {
      value.forEach((item, index) => assertNoForbiddenPublicKeys(item, `${path}[${index}]`, seen));
      return;
    }

    for (const [key, child] of Object.entries(value)) {
      if (isForbiddenPublicKey(key)) {
        throw new Error(`Forbidden public key at ${path}.${key}`);
      }
      assertNoForbiddenPublicKeys(child, `${path}.${key}`, seen);
    }
  } finally {
    seen.delete(value);
  }
}

function numberOrUndefined(value) {
  return Number.isFinite(value) ? value : undefined;
}

function stringOrUndefined(value) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function evidenceFromCandidate(candidate, fallbackArticleId) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return undefined;

  const rawLocator = candidate.locator && typeof candidate.locator === "object"
    ? candidate.locator
    : candidate;
  const paragraph = numberOrUndefined(rawLocator.paragraph);
  const sentence = numberOrUndefined(rawLocator.sentence);
  const sentenceSha256 = stringOrUndefined(
    candidate.sentence_sha256 ?? candidate.sentenceSha256 ?? candidate.hash,
  );
  if (paragraph === undefined && sentence === undefined && !sentenceSha256) return undefined;

  const evidence = {};
  const articleId = stringOrUndefined(candidate.article_id ?? candidate.articleId ?? fallbackArticleId);
  const sourceId = stringOrUndefined(candidate.source_id ?? candidate.sourceId);
  if (articleId) evidence.articleId = articleId;
  if (sourceId) evidence.sourceId = sourceId;
  if (paragraph !== undefined || sentence !== undefined) {
    evidence.locator = {};
    if (paragraph !== undefined) evidence.locator.paragraph = paragraph;
    if (sentence !== undefined) evidence.locator.sentence = sentence;
  }
  if (sentenceSha256) evidence.sentenceSha256 = sentenceSha256;
  return evidence;
}

/**
 * Extract only locator/hash evidence. The function deliberately ignores
 * quote/text fields; callers must not manufacture evidence prose.
 */
export function collectPublicEvidence(value, fallbackArticleId = undefined) {
  const result = [];
  const seenEvidence = new Set();
  const seenNodes = new WeakSet();

  const addCandidate = (candidate, articleId) => {
    if (Array.isArray(candidate)) {
      candidate.forEach((item) => addCandidate(item, articleId));
      return;
    }
    const evidence = evidenceFromCandidate(candidate, articleId);
    if (evidence) {
      const key = JSON.stringify(evidence);
      if (!seenEvidence.has(key)) {
        seenEvidence.add(key);
        result.push(evidence);
      }
      return;
    }
    visit(candidate, articleId);
  };

  const visit = (node, articleId) => {
    if (!node || typeof node !== "object") return;
    if (seenNodes.has(node)) return;
    seenNodes.add(node);
    if (Array.isArray(node)) {
      node.forEach((item) => visit(item, articleId));
      return;
    }
    for (const [key, child] of Object.entries(node)) {
      if (normalizedKey(key) === "evidence") {
        addCandidate(child, articleId);
      } else {
        visit(child, articleId);
      }
    }
  };

  visit(value, fallbackArticleId);
  return result;
}

export function hasPublicEvidence(value) {
  return collectPublicEvidence(value).length > 0;
}

export function compactEngine({
  label,
  semanticAi = false,
  status,
  model = null,
  promptVersion = null,
  schemaVersion = null,
  source = null,
}) {
  return {
    label,
    engineLabel: label,
    semanticAi: Boolean(semanticAi),
    status,
    model,
    promptVersion,
    schemaVersion,
    ...(source ? { source } : {}),
  };
}
