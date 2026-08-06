const DIMENSION_LABELS = {
  problem_definition: "문제 정의",
  causal_interpretation: "원인 해석",
  responsibility_attribution: "책임 귀속",
  moral_evaluation: "규범적 평가",
  treatment_recommendation: "해법·처방",
};

const DIMENSION_PATTERNS = [
  [/책임|귀속/, "responsibility_attribution"],
  [/원인|왜 그렇|배경/, "causal_interpretation"],
  [/해법|처방|대책|해결/, "treatment_recommendation"],
  [/평가|옳|잘못|규범|도덕/, "moral_evaluation"],
  [/문제|규정|쟁점/, "problem_definition"],
];

const STOPWORDS = new Set(["무엇", "어떤", "왜", "어떻게", "기사", "보도", "알려", "주세요", "에서", "으로", "있는", "하는", "의제"]);

function tokens(value) {
  return [...new Set(String(value ?? "").toLowerCase().match(/[0-9a-z가-힣]{2,}/g) ?? [])]
    .filter((token) => !STOPWORDS.has(token));
}

function clean(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function dimensionForQuestion(question) {
  return DIMENSION_PATTERNS.find(([pattern]) => pattern.test(question))?.[1] ?? null;
}

function articleFor(bundle, articleId) {
  return bundle?.articles?.find((article) => article.articleId === articleId) ?? null;
}

function evidenceFor(bundle, articleId, evidence) {
  const article = articleFor(bundle, articleId) ?? bundle?.articles?.[0];
  if (!article?.canonicalUrl) return null;
  const locator = evidence?.locator;
  return {
    articleId: article.articleId,
    source: article.outlet ?? "매체 미상",
    sourceUrl: article.canonicalUrl,
    title: article.title ?? "제목 없음",
    evidenceLocator: locator && (locator.paragraph !== undefined || locator.sentence !== undefined)
      ? `${locator.paragraph ?? "-"}문단 ${locator.sentence ?? "-"}문장`
      : null,
    evidenceHash: evidence?.sentence_sha256 ?? evidence?.sentenceSha256 ?? null,
  };
}

function axisPatterns(bundle) {
  return (bundle?.comparison?.data?.comparison_axes ?? []).flatMap((axis) =>
    (axis.patterns ?? []).map((pattern) => ({
      dimension: axis.dimension ?? "unknown",
      label: axis.label ?? DIMENSION_LABELS[axis.dimension] ?? "분석 축",
      text: clean(pattern.public_paraphrase),
      articleCount: Number(pattern.article_count ?? 0),
      articleIds: Array.isArray(pattern.article_ids) ? pattern.article_ids : [],
      evidence: Array.isArray(pattern.evidence) ? pattern.evidence : [],
    })).filter((pattern) => pattern.text),
  );
}

function rankedPatterns(bundle, question) {
  const wantedDimension = dimensionForQuestion(question);
  const questionTokens = tokens(question);
  return axisPatterns(bundle)
    .filter((pattern) => !wantedDimension || pattern.dimension === wantedDimension)
    .map((pattern) => {
      const haystack = `${pattern.text} ${pattern.label} ${DIMENSION_LABELS[pattern.dimension] ?? ""}`;
      const overlap = questionTokens.filter((token) => tokens(haystack).includes(token)).length;
      return { ...pattern, score: overlap * 10 + pattern.articleCount };
    })
    .sort((left, right) => right.score - left.score || right.articleCount - left.articleCount);
}

function patternEvidence(bundle, pattern, limit = 2) {
  const evidence = pattern.evidence.length ? pattern.evidence : pattern.articleIds.map((articleId) => ({ article_id: articleId }));
  return evidence
    .slice(0, limit)
    .map((item) => evidenceFor(bundle, item.article_id ?? pattern.articleIds[0], item))
    .filter(Boolean);
}

function fallbackEvidence(bundle) {
  return (bundle?.comparison?.evidence ?? [])
    .slice(0, 3)
    .map((item) => evidenceFor(bundle, item.articleId, item))
    .filter(Boolean);
}

function ruleLimitations() {
  return [
    "규칙 기반 보조 답변입니다. 형태·범주와 공개된 paraphrase를 연결하며 새 사실을 생성하지 않습니다.",
    "매체의 의도·편향·사실성이나 인과관계를 판정하지 않습니다.",
    "AI 본문 분석이 연결되면 같은 질문을 AI 근거와 함께 다시 확인해야 합니다.",
  ];
}

export function ruleGroundedAnswer(bundle, question) {
  const normalized = clean(question);
  const summary = bundle?.comparison?.data?.summary_30_seconds ?? {};
  const ranked = rankedPatterns(bundle, normalized);
  const wantedDimension = dimensionForQuestion(normalized);
  const asksDifference = /차이|다른|갈린|비교|초점/.test(normalized);
  const asksCommon = /공통|같게|같은 사실|합의/.test(normalized);

  let answer = "";
  let evidence = [];
  if (asksCommon && clean(summary.common_ground)) {
    answer = clean(summary.common_ground);
    evidence = fallbackEvidence(bundle);
  } else if (wantedDimension && ranked.length) {
    const samples = ranked.slice(0, 3);
    answer = `${DIMENSION_LABELS[wantedDimension] ?? wantedDimension} 축에서 규칙으로 관측된 설명은 다음과 같습니다.\n${samples.map((item) => `· ${item.text} (${item.articleCount || item.articleIds.length}건)`).join("\n")}`;
    evidence = samples.flatMap((item) => patternEvidence(bundle, item)).slice(0, 4);
  } else if (asksDifference && (clean(summary.main_difference) || ranked.length)) {
    const samples = ranked.slice(0, 2);
    answer = clean(summary.main_difference) || `규칙 기반 비교에서 관측된 대표 설명은 “${samples.map((item) => item.text).join("”과 “")}`;
    if (samples.length) answer += `\n대표 패턴: ${samples.map((item) => item.text).join(" / ")}`;
    evidence = samples.flatMap((item) => patternEvidence(bundle, item)).slice(0, 4);
  } else if (ranked.length) {
    const samples = ranked.slice(0, 3);
    answer = `선택한 의제에서 규칙으로 연결된 대표 설명입니다.\n${samples.map((item) => `· ${item.text} (${item.articleCount || item.articleIds.length}건)`).join("\n")}`;
    evidence = samples.flatMap((item) => patternEvidence(bundle, item)).slice(0, 4);
  } else if (clean(bundle?.clusterAi?.summary)) {
    answer = `기사 묶음 요약(규칙 기반 보조 화면): ${clean(bundle.clusterAi.summary)}`;
    evidence = fallbackEvidence(bundle);
  } else if (clean(summary.main_difference) || clean(summary.common_ground)) {
    answer = clean(summary.main_difference) || clean(summary.common_ground);
    evidence = fallbackEvidence(bundle);
  } else {
    answer = "이 의제의 공개 분석 번들에서 연결 가능한 규칙 기반 설명을 찾지 못했습니다.";
  }

  return {
    status: "answered",
    answer: `${answer}\n\n※ ${ruleLimitations()[0]}`,
    evidence,
    provider: "rules_initial_five_v1",
    limitations: ruleLimitations(),
  };
}

export function ruleExamples(bundle) {
  if (!bundle) return [];
  return [
    "이 의제의 핵심 쟁점은 무엇인가요?",
    "매체별 설명이 갈린 지점은 무엇인가요?",
    "책임이나 원인을 어떻게 설명했나요?",
  ].map((question) => ({ question, result: ruleGroundedAnswer(bundle, question) }));
}
