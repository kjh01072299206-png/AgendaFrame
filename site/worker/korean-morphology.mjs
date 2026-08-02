/**
 * Privacy-bounded Korean morphology fallback for the Cloudflare Worker.
 *
 * This is intentionally a small deterministic analyzer rather than a claim of
 * full linguistic parsing. It normalizes common particles and predicate
 * endings, preserves negation markers, and emits only aggregate lemma counts.
 * A batch analyzer such as Kiwi can later implement the same output contract.
 */

export const KOREAN_MORPHOLOGY_VERSION = "ko-controlled-morph-v1";
export const KOREAN_MORPHOLOGY_DICTIONARY_VERSION = "agendaframe-lexicon-2026-08-02";
export const KOREAN_MORPHOLOGY_MODE = "controlled_lexicon_fallback";

const PARTICLES = Object.freeze([
  "으로부터", "에게서는", "에게서", "에서는", "으로는", "로부터", "에게", "한테", "까지", "부터", "보다",
  "처럼", "만큼", "으로", "에서", "에는", "에도", "과의", "와의", "에게는", "께서", "만은", "만도",
  "은", "는", "이", "가", "을", "를", "의", "에", "와", "과", "도", "로", "만",
].sort((left, right) => right.length - left.length));

const NEGATION_FORMS = new Set(["않다", "아니다", "못하다", "없다"]);

const SPECIAL_PREDICATE_FORMS = Object.freeze([
  { lemma: "하다", pattern: /^(?:하다|한다|했다|하는|하며|하여|해야|하지|하고|하면|해서|한|할|해|했|합니다|하였다)$/u },
  { lemma: "되다", pattern: /^(?:되다|된다|됐다|되는|되며|되어|돼|되지|되고|되면|된|될|됩니다|되었다)$/u },
  { lemma: "있다", pattern: /^(?:있다|있는|있었다|있으며|있어|있고|있다고|있지만|있습니다)$/u },
  { lemma: "이다", pattern: /^(?:이다|이었다|이라는|이라고|인|입니다)$/u },
  { lemma: "말하다", pattern: /^(?:말하다|말했다|말한다|말하며|말해|말하고|말했다가|말했습니다)$/u },
  { lemma: "밝히다", pattern: /^(?:밝히다|밝혔다|밝힌|밝히며|밝혀|밝히고|밝혔고|밝혔다고|밝혔습니다)$/u },
  { lemma: "전하다", pattern: /^(?:전하다|전했다|전한|전하며|전해|전하고|전했다고|전했습니다)$/u },
  { lemma: "따르다", pattern: /^(?:따르다|따르면|따른|따랐다|따르고|따라|따랐습니다)$/u },
]);

const PREDICATE_STEMS = Object.freeze([
  "강화", "완화", "개선", "보완", "개정", "폐지", "도입", "확대", "축소", "지원", "규제", "처벌", "비판",
  "지지", "우려", "반대", "찬성", "요구", "촉구", "설명", "주장", "발표", "평가", "침해", "보장", "훼손",
  "발생", "증가", "감소", "악화", "회복", "실패", "부족", "지연", "방치", "사과", "해명", "조사", "수사",
  "감독", "보호", "외면", "기여", "위협", "존중", "마련", "추진", "검토", "필요", "논의", "결정", "시행",
]);

const CONTENT_STOPWORDS = new Set([
  "관련", "대한", "위한", "통해", "올해", "오늘", "내일", "지난", "이번", "현재", "최근", "가운데", "이후",
  "대해", "두고", "다시", "기자", "사진", "영상", "단독", "속보", "종합", "말하다", "밝히다", "전하다",
  "설명하다", "주장하다", "따르다", "그러나", "하지만", "또한", "한편", "다만", "그리고", "있다", "하다",
  "되다", "이다", "말하다", "밝히다", "전하다", "않다", "아니다", "못하다", "없다", "기사", "관련기사", "구독", "가장", "함께", "이상", "경우",
  "지난해", "이날", "위해", "같은", "다른", "이라고", "라고", "억원", "만원", "것이다", "것", "수", "등", "중", "때", "명", "건", "년", "월", "일",
]);

function normalizeInput(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/https?:\/\/\S+|www\.\S+|[\w.+-]+@[\w.-]+\.[a-z]{2,}/giu, " ")
    .replace(/[\u200B-\u200D\uFEFF]/g, " ");
}

function predicateLemma(surface) {
  if (NEGATION_FORMS.has(surface)) return surface;
  const special = SPECIAL_PREDICATE_FORMS.find((rule) => rule.pattern.test(surface));
  if (special) return special.lemma;
  if (/^(?:않|아니|못하|없)(?:았|었|다|다고|다는|으며|지만|거나|는|은|을|지|고|게|도록|습니다|습니까)*$/u.test(surface)) {
    if (surface.startsWith("아니")) return "아니다";
    if (surface.startsWith("못하")) return "못하다";
    if (surface.startsWith("없")) return "없다";
    return "않다";
  }
  for (const stem of PREDICATE_STEMS) {
    if (!surface.startsWith(stem)) continue;
    const ending = surface.slice(stem.length);
    if (!ending || /^(?:하|해|했|한|할|하는|하며|하여|해야|하지|되|돼|됐|된|될|되는|시키|시켜|시켰|이다|인|일|였다|였|라고|라며|다|고|며|면서|지만|도록|습니다|습니까|았다|었다|는다|ㄴ다|자|길|기)*$/u.test(ending)) {
      return `${stem}하다`;
    }
  }
  if (/^[가-힣]{2,}(?:했다|한다|하는|하며|해야|하지|하였다|됩니다|됐다|되었다|되는|된다)$/u.test(surface)) {
    return `${surface.replace(/(?:했다|한다|하는|하며|해야|하지|하였다|됩니다|됐다|되었다|되는|된다)$/u, "")}하다`;
  }
  return null;
}

function splitKoreanEojeol(surface) {
  if (PARTICLES.includes(surface)) return [{ surface, lemma: surface, pos: "particle" }];
  const predicate = predicateLemma(surface);
  if (predicate) {
    return [{ surface, lemma: predicate, pos: "predicate" }];
  }
  const particle = PARTICLES.find((candidate) => surface.endsWith(candidate) && surface.length - candidate.length >= 1);
  if (particle) {
    const stem = surface.slice(0, -particle.length);
    const stemPredicate = predicateLemma(stem);
    return [
      { surface: stem, lemma: stemPredicate ?? stem, pos: stemPredicate ? "predicate" : "noun" },
      { surface: particle, lemma: particle, pos: "particle" },
    ];
  }
  return [{ surface, lemma: surface, pos: "noun" }];
}

/**
 * Tokenize into a conservative morphology-like representation. Token order is
 * used only while analyzing the current sentence and is never persisted.
 */
export function tokenizeKoreanMorphology(value) {
  const units = normalizeInput(value).match(/[가-힣]+|[a-z]+(?:[.-][a-z]+)*|\d+(?:[.,]\d+)*/gu) ?? [];
  return units.flatMap((surface) => {
    if (/^\d/u.test(surface)) return [{ surface, lemma: surface.replace(/,/g, ""), pos: "number" }];
    if (/^[a-z]/u.test(surface)) return [{ surface, lemma: surface, pos: "foreign" }];
    return splitKoreanEojeol(surface);
  });
}

export function hasNearbyNegation(tokens, tokenIndex, radius = 3) {
  const start = Math.max(0, tokenIndex - radius);
  const end = Math.min(tokens.length, tokenIndex + radius + 1);
  return tokens.slice(start, end).some((token) => NEGATION_FORMS.has(token.lemma));
}

function safeContentToken(token) {
  if (!["noun", "predicate", "foreign"].includes(token.pos)) return false;
  if (token.lemma.length < 2 || token.lemma.length > 20) return false;
  if (/^\d|https?|www\.|@/iu.test(token.lemma)) return false;
  return !CONTENT_STOPWORDS.has(token.lemma);
}

/**
 * Build aggregate-only morphology statistics. No token sequence or source text
 * is returned, so profile_json cannot reconstruct an article sentence.
 */
export function summarizeKoreanMorphology(sentences) {
  const posCounts = { noun: 0, predicate: 0, particle: 0, number: 0, foreign: 0 };
  const termCounts = new Map();
  let tokenCount = 0;
  let contentTokenCount = 0;
  let negationCount = 0;

  for (const sentence of sentences) {
    const tokens = tokenizeKoreanMorphology(sentence.text);
    for (const token of tokens) {
      tokenCount += 1;
      posCounts[token.pos] = (posCounts[token.pos] ?? 0) + 1;
      if (NEGATION_FORMS.has(token.lemma)) negationCount += 1;
      if (!safeContentToken(token)) continue;
      contentTokenCount += 1;
      const key = `${token.pos}:${token.lemma}`;
      const current = termCounts.get(key) ?? { term: token.lemma, pos: token.pos, count: 0 };
      current.count += 1;
      termCounts.set(key, current);
    }
  }

  return {
    analyzer: {
      name: "AgendaFrame Korean controlled morphology",
      mode: KOREAN_MORPHOLOGY_MODE,
      version: KOREAN_MORPHOLOGY_VERSION,
      dictionary_version: KOREAN_MORPHOLOGY_DICTIONARY_VERSION,
      pos_tagset: "agendaframe-lite-v1",
    },
    token_count: tokenCount,
    content_token_count: contentTokenCount,
    negation_count: negationCount,
    pos_counts: posCounts,
    term_frequencies: [...termCounts.values()]
      .sort((left, right) => right.count - left.count || left.term.localeCompare(right.term, "ko"))
      .slice(0, 40),
    raw_tokens_retained: false,
    limitation: "조사·일부 활용을 정규화하는 경량 규칙형 분석입니다. Kiwi·MeCab 같은 완전한 형태소 분석기의 품사 판정과 동일하지 않습니다.",
  };
}

export function contentLemmaSet(value) {
  return new Set(tokenizeKoreanMorphology(value).filter(safeContentToken).map((token) => token.lemma));
}
