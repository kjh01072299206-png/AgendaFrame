export const ANALYSIS_PROVIDER = "rules_local";
export const ANALYSIS_MODEL_VERSION = "agenda-rules-v1";

const frameDefinitions = {
  conflict: { label: "갈등·대립", words: ["갈등", "충돌", "논란", "반발", "대립", "공방", "비판", "파문", "강대강", "규탄"] },
  responsibility: { label: "책임 소재", words: ["책임", "정부", "대통령", "장관", "당국", "국회", "여당", "야당", "사퇴", "해명"] },
  economy: { label: "경제·생활", words: ["경제", "금리", "물가", "주가", "환율", "고용", "일자리", "부동산", "수출", "투자", "세금", "예산"] },
  law: { label: "법·제도", words: ["법", "법원", "헌재", "재판", "수사", "검찰", "경찰", "기소", "판결", "규제", "제도"] },
  policy: { label: "정책 효과", words: ["정책", "대책", "지원", "개편", "추진", "확대", "축소", "시행", "도입", "계획", "공급"] },
  citizen: { label: "시민 영향", words: ["시민", "국민", "청년", "노인", "학생", "노동자", "환자", "소비자", "가구", "주민", "피해"] },
};

const stopwords = new Set([
  "관련", "대한", "위한", "통해", "올해", "오늘", "내일", "지난", "이번", "정부", "대통령", "국민",
  "한국", "서울", "기자", "단독", "속보", "종합", "종합2보", "사진", "영상", "논평", "사설", "인터뷰",
  "한다", "했다", "된다", "밝혀", "가운데", "이후", "현재", "최근", "대해", "두고", "다시", "최대",
]);

function cleanToken(value) {
  return value
    .replace(/^[0-9]+|[0-9]+$/g, "")
    .replace(/(에서|으로|에게|까지|부터|보다|처럼|과의|와의|에도|에는|은|는|이|가|을|를|의|에|와|과|도|로)$/u, "")
    .trim();
}

export function titleTokens(title) {
  const normalized = String(title ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\[[^\]]*\]|\([^)]*\)/g, " ")
    .replace(/[^0-9a-z가-힣]+/g, " ");
  const tokens = normalized
    .split(/\s+/)
    .map(cleanToken)
    .filter((token) => token.length >= 2 && !stopwords.has(token));
  return [...new Set(tokens)].slice(0, 16);
}

function similarity(left, right) {
  const a = new Set(left);
  const b = new Set(right);
  let overlap = 0;
  for (const token of a) if (b.has(token)) overlap += 1;
  const union = a.size + b.size - overlap;
  return { overlap, jaccard: union ? overlap / union : 0 };
}

function topCategory(article) {
  const section = String(article.section ?? "").trim();
  const first = section.split(/[>/_]/)[0]?.trim();
  if (first) return first;
  const title = article.title;
  if (/(국회|대통령|정당|여당|야당|선거)/.test(title)) return "정치";
  if (/(경제|금리|물가|증시|부동산|수출|기업)/.test(title)) return "경제";
  if (/(외교|북한|미국|중국|일본|전쟁)/.test(title)) return "국제";
  if (/(과학|기술|인공지능|반도체|우주)/.test(title)) return "IT·과학";
  return "사회";
}

function representativeArticle(articles, tokenSets) {
  if (articles.length === 1) return articles[0];
  let bestIndex = 0;
  let bestScore = -1;
  for (let index = 0; index < articles.length; index += 1) {
    let total = 0;
    for (let other = 0; other < articles.length; other += 1) {
      if (index !== other) total += similarity(tokenSets[index], tokenSets[other]).jaccard;
    }
    const lengthPenalty = Math.max(0, articles[index].title.length - 70) / 500;
    const score = total / Math.max(1, articles.length - 1) - lengthPenalty;
    if (score > bestScore) {
      bestIndex = index;
      bestScore = score;
    }
  }
  return articles[bestIndex];
}

function placementScore(articles) {
  const values = { top: 100, main: 82, section: 58, list: 35 };
  const observed = articles.map((article) => values[article.homepagePlacement]).filter(Number.isFinite);
  if (!observed.length) return 25;
  return observed.reduce((sum, value) => sum + value, 0) / observed.length;
}

function analyzeFrames(articles, representative) {
  const raw = [];
  for (const [frame, definition] of Object.entries(frameDefinitions)) {
    let matches = 0;
    let evidence = null;
    for (const article of articles) {
      const hitCount = definition.words.filter((word) => article.title.includes(word)).length;
      matches += hitCount;
      if (!evidence && hitCount) evidence = article;
    }
    raw.push({ frame, label: definition.label, rawScore: 1 + matches * 2, evidence: evidence ?? representative, matches });
  }
  const total = raw.reduce((sum, value) => sum + value.rawScore, 0);
  return raw.map((value) => ({
    frame: value.frame,
    label: value.label,
    score: Math.round((value.rawScore / total) * 1000) / 10,
    confidence: Math.min(90, 48 + value.matches * 8 + articles.length * 2),
    evidenceText: value.evidence?.title ?? null,
    articleId: value.evidence?.id ?? null,
    sourceId: value.evidence?.sourceId ?? null,
  }));
}

function reportFor(issue, frames) {
  const ordered = [...frames].sort((a, b) => b.score - a.score);
  const strongest = ordered[0];
  const weakest = ordered.at(-1);
  return {
    summary: `${issue.sourceCount}개 언론사의 ${issue.articleCount}건 보도에서 ${strongest.label} 관점이 상대적으로 많이 나타났습니다. 제목 표현을 기준으로 한 규칙 분석 결과입니다.`,
    missingPerspective: `${weakest.label} 관점은 상대적으로 적게 관측됐습니다. 해당 관점의 부재를 단정하지 말고 원문을 함께 확인해야 합니다.`,
    caution: "이 결과는 비용 없는 규칙 기반 1차 분석이며 언론사의 성향이나 보도의 옳고 그름을 판정하지 않습니다. Vertex AI 연결 후에도 사람 검토와 원문 근거를 우선합니다.",
  };
}

export function analyzeArticles(inputArticles, { configuredSourceCount = 5, maxIssues = 80 } = {}) {
  const articles = inputArticles.map((article, index) => ({ ...article, _index: index, _tokens: titleTokens(article.title) }));
  const parent = articles.map((_, index) => index);
  const find = (value) => {
    let current = value;
    while (parent[current] !== current) {
      parent[current] = parent[parent[current]];
      current = parent[current];
    }
    return current;
  };
  const unite = (left, right) => {
    const a = find(left);
    const b = find(right);
    if (a !== b) parent[b] = a;
  };

  const inverted = new Map();
  for (let index = 0; index < articles.length; index += 1) {
    const article = articles[index];
    const candidates = new Map();
    for (const token of article._tokens) {
      for (const candidate of inverted.get(token) ?? []) candidates.set(candidate, (candidates.get(candidate) ?? 0) + 1);
    }
    for (const [candidate, shared] of candidates) {
      if (shared < 2 && article._tokens.length > 2) continue;
      const compared = similarity(article._tokens, articles[candidate]._tokens);
      const sameNormalizedTitle = article.title.replace(/\s+/g, "") === articles[candidate].title.replace(/\s+/g, "");
      const compatibleCategory = topCategory(article) === topCategory(articles[candidate]);
      if (sameNormalizedTitle || (compatibleCategory && compared.overlap >= 2 && compared.jaccard >= 0.28)) unite(index, candidate);
    }
    for (const token of article._tokens) {
      const bucket = inverted.get(token) ?? [];
      if (bucket.length < 120) bucket.push(index);
      inverted.set(token, bucket);
    }
  }

  const groups = new Map();
  articles.forEach((article, index) => {
    const root = find(index);
    const group = groups.get(root) ?? [];
    group.push(article);
    groups.set(root, group);
  });
  const maxArticleCount = Math.max(1, ...[...groups.values()].map((group) => group.length));

  return [...groups.values()]
    .map((group) => {
      const sources = new Map();
      for (const article of group) sources.set(article.sourceId, (sources.get(article.sourceId) ?? 0) + 1);
      const representative = representativeArticle(group, group.map((article) => article._tokens));
      const diversity = Math.min(100, (sources.size / configuredSourceCount) * 100);
      const placement = placementScore(group);
      const volume = Math.min(100, (Math.log1p(group.length) / Math.log1p(maxArticleCount)) * 100);
      const repetition = group.length > 1 ? ((group.length - sources.size) / (group.length - 1)) * 100 : 0;
      const agendaScore = diversity * 0.35 + placement * 0.3 + volume * 0.2 + repetition * 0.15;
      const issue = {
        title: representative.title,
        summary: `${sources.size}개 언론사에서 관련 기사 ${group.length}건이 확인됐습니다. 실제 제목 유사도와 분류 정보를 기준으로 묶었습니다.`,
        category: topCategory(representative),
        articleCount: group.length,
        sourceCount: sources.size,
        agendaScore: Math.round(agendaScore * 10) / 10,
        diversityScore: Math.round(diversity * 10) / 10,
        placementScore: Math.round(placement * 10) / 10,
        volumeScore: Math.round(volume * 10) / 10,
        repetitionScore: Math.round(repetition * 10) / 10,
        confidence: Math.min(92, 48 + Math.min(24, group.length * 3) + sources.size * 4),
        representativeArticleId: representative.id,
        articles: group.map((article) => {
          const cleanArticle = { ...article };
          delete cleanArticle._index;
          delete cleanArticle._tokens;
          return {
            ...cleanArticle,
            similarity: article.id === representative.id ? 1 : Math.round(similarity(representative._tokens, article._tokens).jaccard * 1000) / 1000,
            representative: article.id === representative.id,
          };
        }),
      };
      issue.frames = analyzeFrames(group, representative);
      issue.report = reportFor(issue, issue.frames);
      return issue;
    })
    .sort((left, right) => right.agendaScore - left.agendaScore || right.articleCount - left.articleCount)
    .slice(0, maxIssues);
}

export const frameLabels = Object.fromEntries(Object.entries(frameDefinitions).map(([key, value]) => [key, value.label]));
