export const ANALYSIS_PROVIDER = "rules_local";
export const ANALYSIS_MODEL_VERSION = "agenda-rules-v3";
export const CLUSTERING_VERSION = "event-anchors-complete-link-v2";
export const SCORE_VERSION = "observed-agenda-v3";
export const FRAME_TAXONOMY_VERSION = "frame-signals-v3";

const frameDefinitions = {
  conflict: { label: "갈등·대립", words: ["갈등", "충돌", "논란", "반발", "대립", "공방", "비판", "파문", "강대강", "규탄"] },
  responsibility: { label: "책임 소재", words: ["책임", "사퇴", "해명", "문책", "귀책", "책임론"] },
  economy: { label: "경제·생활", words: ["경제", "금리", "물가", "주가", "환율", "고용", "일자리", "부동산", "수출", "투자", "세금", "예산"] },
  law: { label: "법·제도", words: ["법", "법원", "헌재", "재판", "수사", "검찰", "경찰", "기소", "판결", "규제", "제도"] },
  policy: { label: "정책 효과", words: ["정책", "대책", "지원", "개편", "추진", "확대", "축소", "시행", "도입", "계획", "공급"] },
  citizen: { label: "시민 영향", words: ["시민", "청년", "노인", "학생", "노동자", "환자", "소비자", "가구", "주민", "피해자"] },
};

const stopwords = new Set([
  "관련", "대한", "위한", "통해", "올해", "오늘", "내일", "지난", "이번", "정부", "대통령", "국민",
  "한국", "서울", "기자", "단독", "속보", "종합", "종합2보", "사진", "영상", "논평", "사설", "인터뷰",
  "한다", "했다", "된다", "밝혀", "가운데", "이후", "현재", "최근", "대해", "두고", "다시", "최대",
]);

const genericEventTokens = new Set([
  "관련", "사건", "의혹", "논란", "특검", "검찰", "경찰", "법원", "정부", "국회", "청구", "수사", "조사",
  "구속영장", "압수수색", "긴급체포", "체포", "구속", "기소", "입건", "송치", "선고", "판결", "발표",
  "추진", "개최", "방문", "오늘", "내일", "전날", "지난", "이번", "속보", "종합",
]);

const actorRolePattern = /([가-힣]{2,4})(?:\s+전)?\s*(?:대통령|총리|장관|의원|대표|시장|도지사|교육감|회장|사장|감독|총장|검찰총장|감사위원|사령관|교수|기자|검사|판사)/gu;
const actionDefinitions = {
  warrant: ["구속영장", "영장 청구", "영장청구"],
  search: ["압수수색"],
  arrest: ["긴급체포", "체포", "구속"],
  indictment: ["기소", "재판행"],
  booking: ["입건"],
  referral: ["송치"],
  ruling: ["선고", "판결", "결정"],
  investigation: ["수사", "조사"],
  legislation: ["발의", "의결", "법안"],
  announcement: ["발표", "공개"],
  accident: ["사고", "충돌", "추락"],
  death: ["사망", "숨진", "시신"],
  strike: ["파업"],
  visit: ["방문", "파견"],
};

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
  return [...new Set(tokens)].slice(0, 20);
}

function similarity(left, right) {
  const a = new Set(left);
  const b = new Set(right);
  let overlap = 0;
  for (const token of a) if (b.has(token)) overlap += 1;
  const union = a.size + b.size - overlap;
  return { overlap, jaccard: union ? overlap / union : 0 };
}

function overlapCount(left, right) {
  const rightSet = new Set(right);
  return left.reduce((count, value) => count + (rightSet.has(value) ? 1 : 0), 0);
}

function normalizedTitle(title) {
  return String(title ?? "").normalize("NFKC").toLowerCase().replace(/[^0-9a-z가-힣]+/g, "");
}

function eventFeatures(article) {
  const title = String(article.title ?? "").normalize("NFKC");
  const actors = [];
  for (const match of title.matchAll(actorRolePattern)) actors.push(match[1]);
  const actions = Object.entries(actionDefinitions)
    .filter(([, signals]) => signals.some((signal) => title.includes(signal)))
    .map(([action]) => action);
  const discriminators = article._tokens.filter((token) => !genericEventTokens.has(token));
  return {
    actors: [...new Set(actors)],
    actions,
    discriminators,
    normalized: normalizedTitle(title),
  };
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

function compatibleEvent(left, right) {
  if (left._event.normalized === right._event.normalized) return true;
  if (topCategory(left) !== topCategory(right)) return false;

  const compared = similarity(left._tokens, right._tokens);
  const sharedDiscriminators = overlapCount(left._event.discriminators, right._event.discriminators);
  const leftActors = left._event.actors;
  const rightActors = right._event.actors;
  const leftActions = left._event.actions;
  const rightActions = right._event.actions;

  if (leftActors.length && rightActors.length && overlapCount(leftActors, rightActors) === 0) return false;
  if (leftActions.length && rightActions.length && overlapCount(leftActions, rightActions) === 0) return false;
  if ((leftActors.length || rightActors.length) && sharedDiscriminators < 1) return false;
  if (leftActors.length !== rightActors.length && compared.jaccard < 0.42) return false;

  return compared.overlap >= 2 && sharedDiscriminators >= 1 && compared.jaccard >= 0.32;
}

function representativeArticle(articles) {
  if (articles.length === 1) return articles[0];
  let bestIndex = 0;
  let bestScore = -1;
  for (let index = 0; index < articles.length; index += 1) {
    let total = 0;
    for (let other = 0; other < articles.length; other += 1) {
      if (index !== other) total += similarity(articles[index]._tokens, articles[other]._tokens).jaccard;
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
  const observedArticles = articles.flatMap((article) => {
    const observations = Array.isArray(article.placementObservations) ? article.placementObservations : [];
    if (observations.length) {
      const scores = observations.map((observation) => values[observation.zone]).filter(Number.isFinite);
      return scores.length ? [scores.reduce((sum, value) => sum + value, 0) / scores.length] : [];
    }
    const legacyValue = values[article.homepagePlacement];
    return Number.isFinite(legacyValue) ? [legacyValue] : [];
  });
  const observationCount = articles.reduce((count, article) => count + (article.placementObservations?.length ?? (values[article.homepagePlacement] ? 1 : 0)), 0);
  return {
    value: observedArticles.length ? observedArticles.reduce((sum, value) => sum + value, 0) / observedArticles.length : null,
    observedCount: observedArticles.length,
    observationCount,
    totalCount: articles.length,
  };
}

function weightedAgendaScore({ diversity, placement, volume, followUpVolume }) {
  const components = [
    { value: diversity, weight: 0.35 },
    { value: placement.value, weight: 0.30 },
    { value: volume, weight: 0.20 },
    { value: followUpVolume, weight: 0.15 },
  ].filter((component) => Number.isFinite(component.value));
  const observedWeight = components.reduce((sum, component) => sum + component.weight, 0);
  const score = components.reduce((sum, component) => sum + component.value * component.weight, 0) / observedWeight;
  return {
    score: Math.round(score * 10) / 10,
    status: placement.observedCount ? "observed_components" : "placement_excluded",
    observedWeight: Math.round(observedWeight * 100),
  };
}

function bodyEvidence(article, words) {
  const body = String(article.bodyText ?? "");
  if (!body) return null;
  const matchedWord = words.find((word) => body.includes(word));
  if (!matchedWord) return null;
  const matchStart = body.indexOf(matchedWord);
  const previousBoundary = Math.max(body.lastIndexOf("\n", matchStart), body.lastIndexOf(".", matchStart), body.lastIndexOf("다.", matchStart));
  const nextCandidates = [body.indexOf("\n", matchStart), body.indexOf("다.", matchStart), body.indexOf(".", matchStart)]
    .filter((value) => value >= matchStart);
  const start = Math.max(0, previousBoundary + 1);
  const rawEnd = nextCandidates.length ? Math.min(...nextCandidates) + 2 : Math.min(body.length, start + 280);
  const end = Math.min(body.length, Math.max(start + matchedWord.length, rawEnd));
  const excerpt = body.slice(start, end).trim().slice(0, 280);
  return {
    start,
    end,
    text: article.publicEvidenceAllowed
      ? excerpt
      : "승인된 본문에서 관련 표현을 확인했습니다. 근거 문장은 공개 검토 전입니다.",
    basis: article.publicEvidenceAllowed ? "body_public" : "body_private",
  };
}

function analyzeFrames(articles) {
  return Object.entries(frameDefinitions).map(([frame, definition]) => {
    const matches = articles.map((article) => {
      const body = bodyEvidence(article, definition.words);
      if (body) return { article, body, basis: body.basis };
      if (definition.words.some((word) => article.title.includes(word))) return { article, body: null, basis: "headline" };
      return null;
    }).filter(Boolean);
    const evidence = matches.find((match) => match.body) ?? matches[0] ?? null;
    const bodyObservedCount = articles.filter((article) => Boolean(article.bodyText)).length;
    return {
      frame,
      label: definition.label,
      score: Math.round((matches.length / Math.max(1, articles.length)) * 1000) / 10,
      confidence: null,
      calibrationStatus: "not_calibrated",
      evidenceBasis: evidence?.basis ?? "headline",
      evidenceText: evidence?.body?.text ?? evidence?.article?.title ?? null,
      evidenceStart: evidence?.body?.start ?? null,
      evidenceEnd: evidence?.body?.end ?? null,
      contentVersionId: evidence?.body ? evidence.article.contentVersionId ?? null : null,
      articleId: evidence?.article?.id ?? null,
      sourceId: evidence?.article?.sourceId ?? null,
      bodyObservedCount,
      status: evidence?.body ? "body_signal_detected" : evidence ? "headline_signal_detected" : "not_detected",
    };
  });
}

function reportFor(issue, frames) {
  const detected = frames.filter((frame) => frame.status !== "not_detected").sort((a, b) => b.score - a.score);
  const bodyObservedCount = Math.max(0, ...frames.map((frame) => frame.bodyObservedCount ?? 0));
  return {
    summary: detected.length && bodyObservedCount
      ? `${issue.articleCount}건 중 승인된 본문 ${bodyObservedCount}건과 제목에서 ${detected[0].label} 관련 표현 단서를 확인했습니다. 구조화 프레임 판정 전 단계입니다.`
      : detected.length
      ? `${issue.sourceCount}개 언론사의 ${issue.articleCount}건 제목에서 ${detected[0].label} 관련 표현이 상대적으로 자주 관측됐습니다. 기사 본문에 대한 판단이 아닙니다.`
      : "기사 제목에서 공개할 수 있는 프레임 신호가 확인되지 않았습니다.",
    missingPerspective: bodyObservedCount
      ? "승인 본문이 없는 기사와 구조화되지 않은 취재원·책임·해법 요소는 판단하지 않습니다."
      : "기사 본문을 저장·분석하지 않으므로 관점이나 취재원의 부재는 판단할 수 없습니다.",
    caution: bodyObservedCount
      ? "본문·제목 표현 기준 규칙 탐색입니다. Gemini 프레임 판정이나 사람 검토 결과가 아닙니다."
      : "제목 표현 기준 규칙 분석입니다. 언론사의 성향, 사실성, 보도의 옳고 그름을 판정하지 않습니다.",
  };
}

function clusterArticles(articles) {
  const clusters = [];
  const inverted = new Map();

  for (const article of articles) {
    const candidateCounts = new Map();
    const indexTokens = article._event.discriminators.length ? article._event.discriminators : article._tokens;
    for (const token of indexTokens) {
      for (const clusterIndex of inverted.get(token) ?? []) {
        candidateCounts.set(clusterIndex, (candidateCounts.get(clusterIndex) ?? 0) + 1);
      }
    }

    let selectedIndex = -1;
    let selectedScore = -1;
    for (const [clusterIndex, shared] of [...candidateCounts].sort((a, b) => b[1] - a[1])) {
      if (shared < 1) continue;
      const cluster = clusters[clusterIndex];
      if (!cluster.every((member) => compatibleEvent(article, member))) continue;
      const representative = representativeArticle(cluster);
      const compared = similarity(article._tokens, representative._tokens);
      if (compared.jaccard > selectedScore) {
        selectedIndex = clusterIndex;
        selectedScore = compared.jaccard;
      }
    }

    if (selectedIndex < 0) {
      selectedIndex = clusters.length;
      clusters.push([article]);
    } else {
      clusters[selectedIndex].push(article);
    }

    for (const token of indexTokens) {
      const bucket = inverted.get(token) ?? new Set();
      if (bucket.size < 120) bucket.add(selectedIndex);
      inverted.set(token, bucket);
    }
  }
  return clusters;
}

export function analyzeArticles(inputArticles, { configuredSourceCount = 5, maxIssues = 80 } = {}) {
  const articles = inputArticles.map((article, index) => {
    const prepared = { ...article, _index: index, _tokens: titleTokens(article.title) };
    prepared._event = eventFeatures(prepared);
    return prepared;
  });
  const groups = clusterArticles(articles);
  const maxArticleCount = Math.max(1, ...groups.map((group) => group.length));

  return groups
    .map((group) => {
      const sources = new Map();
      for (const article of group) sources.set(article.sourceId, (sources.get(article.sourceId) ?? 0) + 1);
      const representative = representativeArticle(group);
      const diversity = Math.min(100, (sources.size / configuredSourceCount) * 100);
      const placement = placementScore(group);
      const volume = Math.min(100, (Math.log1p(group.length) / Math.log1p(maxArticleCount)) * 100);
      const followUpVolume = group.length > 1 ? ((group.length - sources.size) / (group.length - 1)) * 100 : 0;
      const scoreResult = weightedAgendaScore({ diversity, placement, volume, followUpVolume });
      const similarities = group.map((article) => article.id === representative.id ? 1 : similarity(representative._tokens, article._tokens).jaccard);
      const minimumSimilarity = Math.min(...similarities);
      const issue = {
        title: representative.title,
        summary: `${sources.size}개 언론사의 관련 제목 ${group.length}건을 사건 인물·행위와 제목 유사도를 함께 확인해 묶었습니다.`,
        category: topCategory(representative),
        articleCount: group.length,
        sourceCount: sources.size,
        agendaScore: scoreResult.score,
        scoreStatus: scoreResult.status,
        scoreObservedWeight: scoreResult.observedWeight,
        diversityScore: Math.round(diversity * 10) / 10,
        placementScore: placement.value === null ? null : Math.round(placement.value * 10) / 10,
        placementObservedCount: placement.observedCount,
        placementObservationCount: placement.observationCount,
        placementTotalCount: placement.totalCount,
        volumeScore: Math.round(volume * 10) / 10,
        repetitionScore: Math.round(followUpVolume * 10) / 10,
        followUpVolumeScore: Math.round(followUpVolume * 10) / 10,
        confidence: null,
        calibrationStatus: "not_calibrated",
        clusterQuality: group.length < 2 ? "insufficient_evidence" : minimumSimilarity >= 0.42 ? "cohesive" : "review_required",
        representativeArticleId: representative.id,
        articles: group.map((article) => {
          const cleanArticle = { ...article };
          delete cleanArticle._index;
          delete cleanArticle._tokens;
          delete cleanArticle._event;
          delete cleanArticle.bodyText;
          delete cleanArticle.publicEvidenceAllowed;
          delete cleanArticle.contentVersionId;
          return {
            ...cleanArticle,
            contentAvailable: Boolean(article.bodyText),
            similarity: article.id === representative.id ? 1 : Math.round(similarity(representative._tokens, article._tokens).jaccard * 1000) / 1000,
            membershipStatus: "included",
            representative: article.id === representative.id,
          };
        }),
      };
      issue.frames = analyzeFrames(group);
      issue.report = reportFor(issue, issue.frames);
      return issue;
    })
    .sort((left, right) => right.agendaScore - left.agendaScore || right.articleCount - left.articleCount)
    .slice(0, maxIssues);
}

export const frameLabels = Object.fromEntries(Object.entries(frameDefinitions).map(([key, value]) => [key, value.label]));
