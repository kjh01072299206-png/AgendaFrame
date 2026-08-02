import assert from "node:assert/strict";
import test from "node:test";

import {
  ARTICLE_FRAME_PROFILE_SCHEMA,
  analyzeArticleFraming,
  buildIssueFrameComparison,
  segmentKoreanArticle,
  validateArticleFrameProfile,
} from "../worker/framing-engine.mjs";
import {
  summarizeKoreanMorphology,
  tokenizeKoreanMorphology,
} from "../worker/korean-morphology.mjs";

test("segments Korean paragraphs and sentences with stable locators", () => {
  const sentences = segmentKoreanArticle("첫 문장입니다. 둘째 문장입니다.\n\n새 문단입니다!");
  assert.deepEqual(
    sentences.map(({ paragraph, sentence }) => [paragraph, sentence]),
    [[1, 1], [1, 2], [2, 1]],
  );
});

test("normalizes Korean particles and predicate endings without retaining token sequences", () => {
  const tokens = tokenizeKoreanMorphology("정책을 개선했고 지원해야 하지만 실패했다. 실패가 아니었다.");

  for (const [lemma, pos] of [
    ["정책", "noun"],
    ["개선하다", "predicate"],
    ["지원하다", "predicate"],
    ["실패하다", "predicate"],
    ["아니다", "predicate"],
    ["을", "particle"],
  ]) {
    assert.ok(tokens.some((token) => token.lemma === lemma && token.pos === pos), `missing normalized token: ${lemma}/${pos}`);
  }

  const summary = summarizeKoreanMorphology([
    { text: "정책을 개선했고 정책은 개선해야 한다." },
  ]);
  const frequencies = new Map(summary.term_frequencies.map((term) => [`${term.pos}:${term.term}`, term.count]));
  assert.equal(frequencies.get("noun:정책"), 2);
  assert.equal(frequencies.get("predicate:개선하다"), 2);
  assert.equal(summary.raw_tokens_retained, false);
  assert.equal(Object.hasOwn(summary, "tokens"), false);

  const boilerplate = summarizeKoreanMorphology([
    { text: "기자는 현장에 있는 것으로 전해졌다고 밝혔다. 관련 기사는 구독할 수 있다." },
  ]).term_frequencies.map((term) => term.term);
  assert.equal(boilerplate.includes("했다"), false);
  assert.equal(boilerplate.includes("있는"), false);
  assert.equal(boilerplate.includes("것으"), false);
  assert.equal(boilerplate.includes("관련기사"), false);
});

test("matches Policy descriptors on normalized lemmas instead of Korean substrings", async () => {
  const substringOnly = await analyzeArticleFraming({
    articleId: "descriptor-substring-only",
    title: "회의 참석",
    bodyText: "안전모를 착용한 시장님은 경제학자와 회의를 열었다.",
  });
  const substringCodes = substringOnly.secondary_descriptors.policy_frames.map((descriptor) => descriptor.code);
  assert.equal(substringCodes.includes("health_safety"), false);
  assert.equal(substringCodes.includes("economic"), false);

  const grounded = await analyzeArticleFraming({
    articleId: "descriptor-grounded",
    title: "현장 안전 대책",
    bodyText: "안전 사고로 환자와 의료 인력의 위험이 커졌다.",
  });
  assert.ok(grounded.secondary_descriptors.policy_frames.some((descriptor) => descriptor.code === "health_safety"));
});

test("returns evidence fingerprints and never leaks raw body or exact sentences", async () => {
  const uniqueSentence = "절대로 공개 결과에 그대로 남으면 안 되는 고유 문장 7f9d입니다.";
  const bodyText = [
    "정부의 지원 대책이 늦어 피해가 커졌다는 지적이 나왔다.",
    uniqueSentence,
    "당국은 제도를 보완해야 한다고 밝혔다.",
  ].join("\n\n");
  const profile = await analyzeArticleFraming({
    articleId: "privacy-1",
    title: "지원 대책 지연 논란",
    bodyText,
    publishedAt: "2026-07-23T09:00:00+09:00",
  });

  const serialized = JSON.stringify(profile);
  assert.equal(profile.schema_version, ARTICLE_FRAME_PROFILE_SCHEMA);
  assert.equal(profile.article.raw_body_retained, false);
  assert.doesNotMatch(serialized, /절대로 공개 결과에 그대로 남으면 안 되는/);
  assert.doesNotMatch(serialized, /정부의 지원 대책이 늦어 피해가 커졌다는/);
  assert.doesNotMatch(serialized, /당국은 제도를 보완해야 한다고 밝혔다/);
  assert.match(profile.article.body_sha256, /^[a-f0-9]{64}$/);
  assert.equal(validateArticleFrameProfile(profile).valid, true);
});

test("keeps a quoted source claim separate from outlet narration", async () => {
  const profile = await analyzeArticleFraming({
    articleId: "voice-1",
    title: "예산안 공방",
    bodyText: [
      '정부 관계자는 "정책 실패는 야당 탓이며 장관이 책임져야 한다"고 말했다.',
      "회의는 오후에 끝났고 다음 주 다시 열릴 예정이다.",
    ].join("\n\n"),
  });

  const responsibility = profile.dimensions.responsibility_attribution;
  assert.equal(responsibility.status, "source_attributed");
  assert.equal(responsibility.outlet_narration_observed, false);
  assert.ok(responsibility.items.length >= 1);
  assert.ok(responsibility.items.every((item) => item.voice.kind !== "journalist_narration"));
  assert.ok(responsibility.items.some((item) => item.voice.speaker_role === "anonymous_official"));
});

test("keeps the same framing code once per distinct journalist and source voice", async () => {
  const profile = await analyzeArticleFraming({
    articleId: "same-code-distinct-voices",
    title: "결정 평가",
    bodyText: [
      "이 결정은 부당하고 무책임한 조치다.",
      '시민단체 관계자는 "이 결정은 부당하고 무책임하다"고 말했다.',
    ].join("\n\n"),
  });

  const evaluations = profile.dimensions.moral_evaluation.items
    .filter((item) => item.code === "negative_legitimacy_evaluation");
  assert.equal(evaluations.filter((item) => item.voice.kind === "journalist_narration").length, 1);
  assert.equal(evaluations.filter((item) => item.voice.kind === "direct_quote").length, 1);
});

test("captures political incentives, legitimacy criticism, and institutional checks without adopting a quoted position", async () => {
  const profile = await analyzeArticleFraming({
    articleId: "political-incentive-1",
    title: "보완수사권 폐지 논쟁",
    bodyText: [
      '야당 원내대표는 "강성 당원 눈치를 보며 보완수사권 폐지 속도전을 벌이고 있다"고 주장했다.',
      '"여론의 역풍이 두렵고 강경파와의 뒷거래가 깨질까 걱정하는 것"이라고 말했다.',
      '"대통령은 침묵을 깨고 입장을 밝혀야 하며 재의요구권을 행사해야 한다"고 촉구했다.',
      '"법치주의의 근간을 뒤흔드는 추악한 만행"이라고 비판했다.',
    ].join("\n\n"),
  });

  assert.ok(profile.dimensions.causal_interpretation.items.some(
    (item) => item.code === "political_incentive_cause",
  ));
  assert.ok(profile.dimensions.moral_evaluation.items.some(
    (item) => item.code === "negative_legitimacy_evaluation",
  ));
  assert.ok(profile.dimensions.treatment_recommendation.items.some(
    (item) => item.code === "institutional_check",
  ));
  assert.equal(profile.dimensions.causal_interpretation.outlet_narration_observed, false);
  assert.equal(profile.dimensions.treatment_recommendation.outlet_narration_observed, false);
  assert.doesNotMatch(JSON.stringify(profile), /강성 당원 눈치를 보며/);
});

test("does not label a source-dominated straight-news bundle as an outlet framing divergence", async () => {
  const left = await analyzeArticleFraming({
    articleId: "source-dominated-left",
    title: "정책 폐지 비판",
    bodyText: [
      '야당 원내대표는 "여론의 역풍이 두려워 침묵하고 있다"고 주장했다.',
      '"법치주의를 뒤흔드는 추악한 결정이며 거부권을 행사해야 한다"고 말했다.',
    ].join("\n\n"),
  });
  const right = await analyzeArticleFraming({
    articleId: "source-dominated-right",
    title: "대통령 침묵 비판",
    bodyText: [
      '야당 원내대표는 "강성 당원 눈치를 보며 속도전을 벌이고 있다"고 비판했다.',
      '"국민 안전을 위협하는 결정이므로 입장을 밝혀야 한다"고 촉구했다.',
    ].join("\n\n"),
  });
  const comparison = buildIssueFrameComparison(
    [left, right],
    [
      { articleId: "source-dominated-left", sourceId: "alpha", sourceName: "알파", mediaGroupId: "alpha" },
      { articleId: "source-dominated-right", sourceId: "beta", sourceName: "베타", mediaGroupId: "beta" },
    ],
  );

  assert.equal(comparison.method.source_dominance_check.detected, true);
  assert.equal(comparison.summary_30_seconds.divergence_detected, false);
  assert.match(comparison.summary_30_seconds.main_difference, /매체 자체의 프레임 차이로 확정하지 않았습니다/);
});

test("explicitly abstains from unsupported Entman dimensions", async () => {
  const profile = await analyzeArticleFraming({
    articleId: "abstain-1",
    title: "위원회 회의 개최",
    bodyText: "위원회는 오전 열 시 회의를 열었다. 회의에는 위원 일곱 명이 참석했다.",
  });

  for (const dimension of [
    "problem_definition",
    "causal_interpretation",
    "responsibility_attribution",
    "moral_evaluation",
    "treatment_recommendation",
  ]) {
    assert.equal(profile.dimensions[dimension].status, "not_observed");
    assert.deepEqual(profile.dimensions[dimension].items, []);
    assert.match(profile.dimensions[dimension].abstention_reason, /확인하지 못했습니다/);
  }
});

test("builds a useful issue comparison without treating source quotes as outlet positions", async () => {
  const policyProfile = await analyzeArticleFraming({
    articleId: "compare-policy",
    title: "주거 대책 보완 요구",
    bodyText: [
      "정부의 주거 지원 대책은 집행 지연과 제도 공백이 문제로 지적된다.",
      "지원 제도를 보완해야 한다.",
      "지난해 통계와 법률 절차도 함께 검토됐다.",
    ].join("\n\n"),
  });
  const harmProfile = await analyzeArticleFraming({
    articleId: "compare-harm",
    title: "주거 피해 확산",
    bodyText: [
      "주거 피해와 주민 안전 문제가 커지고 있다.",
      "피해자 지원을 확대해야 한다.",
      "주민들은 현장에서 생활의 어려움을 호소했다.",
    ].join("\n\n"),
  });
  const quoteOnlyProfile = await analyzeArticleFraming({
    articleId: "compare-quote",
    title: "주거 정책 논쟁",
    bodyText: '야당 관계자는 "정부가 책임져야 하고 대책을 전면 개정해야 한다"고 말했다.',
  });

  const comparison = buildIssueFrameComparison(
    [policyProfile, harmProfile, quoteOnlyProfile],
    [
      { articleId: "compare-policy", sourceId: "alpha", sourceName: "알파일보", mediaGroupId: "alpha" },
      { articleId: "compare-harm", sourceId: "beta", sourceName: "베타신문", mediaGroupId: "beta" },
      { articleId: "compare-quote", sourceId: "gamma", sourceName: "감마뉴스", mediaGroupId: "gamma" },
    ],
    { issueId: "housing-1", issueTitle: "주거 대책" },
  );

  assert.equal(comparison.sample.article_count, 3);
  assert.equal(comparison.sample.outlet_count, 3);
  assert.equal(comparison.sample.independent_media_group_count, 3);
  assert.match(comparison.summary_30_seconds.sample, /3개 매체의 3건/);
  assert.match(comparison.summary_30_seconds.main_difference, /문제 정의/);
  assert.equal(comparison.summary_30_seconds.divergence_detected, true);
  const responsibility = comparison.comparison_axes.find((axis) => axis.dimension === "responsibility_attribution");
  assert.equal(responsibility.outlet_narration_article_count, 0);
  assert.equal(responsibility.source_attributed_only_article_count, 1);
  assert.ok(responsibility.patterns.every((pattern) => pattern.voice_scope !== "outlet_narration"));
  assert.ok(comparison.not_observed_statements.length > 0);
  assert.equal(JSON.stringify(comparison).includes("정부가 책임져야 하고"), false);
});

test("does not call multiple patterns inside one media group a cross-outlet divergence", async () => {
  const first = await analyzeArticleFraming({
    articleId: "same-group-1",
    title: "복합 정책 쟁점",
    bodyText: "정책 집행 지연과 주민 안전 문제가 함께 커지고 있다. 제도 개선이 필요하다.",
  });
  const second = await analyzeArticleFraming({
    articleId: "same-group-2",
    title: "복합 정책 쟁점 후속",
    bodyText: "정책 집행 지연과 주민 안전 문제가 함께 커지고 있다. 추가 회의가 열렸다.",
  });
  const comparison = buildIssueFrameComparison(
    [first, second],
    [
      { articleId: "same-group-1", sourceId: "alpha-paper", sourceName: "알파일보", mediaGroupId: "alpha" },
      { articleId: "same-group-2", sourceId: "alpha-web", sourceName: "알파뉴스", mediaGroupId: "alpha" },
    ],
  );
  assert.equal(comparison.summary_30_seconds.divergence_detected, false);
  assert.match(comparison.summary_30_seconds.main_difference, /충분하지 않습니다/);
});

test("aggregates evidence-grounded analysis modules and suppresses unsupported values", async () => {
  const profiles = await Promise.all([
    analyzeArticleFraming({
      articleId: "module-alpha",
      title: "제도 평가",
      bodyText: "공통의제와 예산 부족, 인력 부족을 구조적 정책 문제로 다뤘다. 이 결정은 부당하고 무책임한 조치다. 희귀알파어가 언급됐다.",
    }),
    analyzeArticleFraming({
      articleId: "module-beta",
      title: "현장 반응",
      bodyText: '공통의제를 둘러싼 현장 사례를 전했다. 정부 관계자는 "이 결정은 부당하고 무책임하다"고 말했다. 희귀베타어가 언급됐다.',
    }),
    analyzeArticleFraming({
      articleId: "module-gamma",
      title: "회의 개최",
      bodyText: "위원회는 오전 열 시 정기 회의를 열었다.",
    }),
  ]);
  const metadata = [
    { articleId: "module-alpha", sourceId: "alpha", sourceName: "알파일보", mediaGroupId: "alpha" },
    { articleId: "module-beta", sourceId: "beta", sourceName: "베타신문", mediaGroupId: "beta" },
    { articleId: "module-gamma", sourceId: "gamma", sourceName: "감마통신", mediaGroupId: "gamma" },
  ];
  const comparison = buildIssueFrameComparison(profiles, metadata);
  const modules = comparison.analysis_modules;

  assert.equal(modules.frame_composition.status, "available");
  assert.equal(modules.frame_composition.unit, "article_presence");
  assert.equal(modules.frame_composition.multi_label, true);
  const alphaFrames = modules.frame_composition.by_outlet.find((outlet) => outlet.outlet === "알파일보");
  assert.ok(alphaFrames.labels.some((label) => label.code === "capacity_resources" && label.article_count === 1));

  const alphaStyle = modules.reporting_style.by_outlet.find((outlet) => outlet.outlet === "알파일보");
  assert.equal(alphaStyle.evaluation.status, "observed");
  assert.equal(alphaStyle.evaluation.index, -1);
  assert.equal(alphaStyle.evaluation.critical_article_count, 1);
  assert.ok(alphaStyle.evaluation.evidence.length > 0);

  const betaStyle = modules.reporting_style.by_outlet.find((outlet) => outlet.outlet === "베타신문");
  assert.equal(betaStyle.evaluation.status, "abstained");
  assert.equal(betaStyle.evaluation.index, null);
  assert.equal(betaStyle.evaluation.attributed_only_article_count, 1);
  assert.deepEqual(betaStyle.evaluation.evidence, []);

  const gammaStyle = modules.reporting_style.by_outlet.find((outlet) => outlet.outlet === "감마통신");
  assert.deepEqual(
    [gammaStyle.evaluation.status, gammaStyle.evaluation.index, gammaStyle.scope.status, gammaStyle.scope.index],
    ["abstained", null, "abstained", null],
  );
  assert.deepEqual(gammaStyle.evaluation.evidence, []);
  assert.deepEqual(gammaStyle.scope.evidence, []);

  assert.equal(modules.morphology.minimum_document_frequency, 2);
  assert.equal(modules.morphology.minimum_media_group_frequency, 2);
  const morphologyTerms = modules.morphology.by_outlet.flatMap((outlet) => outlet.terms.map((term) => term.term));
  assert.ok(morphologyTerms.includes("공통의제"));
  assert.equal(morphologyTerms.includes("희귀알파어"), false);
  assert.equal(morphologyTerms.includes("희귀베타어"), false);

  const renamed = buildIssueFrameComparison(profiles, metadata.map((entry, index) => ({
    ...entry,
    sourceName: `완전히다른매체명-${index + 1}`,
  })));
  const styleValues = (result) => result.analysis_modules.reporting_style.by_outlet.map((outlet) => ({
    analyzed_article_count: outlet.analyzed_article_count,
    evaluation: outlet.evaluation,
    scope: outlet.scope,
  }));
  assert.deepEqual(styleValues(renamed), styleValues(comparison));
  for (const outlet of comparison.analysis_modules.reporting_style.by_outlet) {
    assert.equal(Object.hasOwn(outlet, "x"), false);
    assert.equal(Object.hasOwn(outlet, "y"), false);
    assert.equal(Object.hasOwn(outlet, "jitter"), false);
  }
});

test("validator rejects conventional raw-text carrier fields", async () => {
  const profile = await analyzeArticleFraming({
    articleId: "validation-1",
    title: "안전 대책",
    bodyText: "안전 사고 피해가 커지고 있어 예방 대책을 강화해야 한다.",
  });
  const unsafe = structuredClone(profile);
  unsafe.raw_body = "기사 전문";
  const result = validateArticleFrameProfile(unsafe);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("raw_body")));
});
