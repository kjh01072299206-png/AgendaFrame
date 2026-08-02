import assert from "node:assert/strict";
import test from "node:test";

import {
  AI_ARTICLE_FRAME_PROFILE_SCHEMA,
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

const NARRATIVE_FIELDS = [
  ["problem_definition", "problem"],
  ["causal_interpretation", "cause"],
  ["responsibility_attribution", "responsibility"],
  ["moral_evaluation", "evaluation"],
  ["treatment_recommendation", "remedy"],
];

async function narrativeProfile(articleId, family, { affectedVoice = false } = {}) {
  const profile = await analyzeArticleFraming({
    articleId,
    title: "같은 정책 쟁점",
    bodyText: "정부의 지원 대책은 집행 지연이 문제로 지적돼 제도 개선이 필요하다.",
  });
  const evidence = Object.values(profile.dimensions)
    .flatMap((dimension) => dimension.items ?? [])
    .find(Boolean)?.evidence;
  assert.ok(evidence);
  const labels = family === "burden"
    ? {
        problem: "기업의 제도 대응 부담을 핵심 문제로 설명합니다.",
        cause: "급격한 시행 준비가 비용 부담을 키웠다고 설명합니다.",
        responsibility: "정책 설계 기관의 보완 책임을 강조합니다.",
        evaluation: "현장 준비를 고려하지 않은 시행이라고 평가합니다.",
        remedy: "단계적 시행과 비용 지원을 제안합니다.",
      }
    : {
        problem: "노동자의 안전 피해를 핵심 문제로 설명합니다.",
        cause: "현장 감독 공백이 피해를 키웠다고 설명합니다.",
        responsibility: "사업주와 감독기관의 예방 책임을 강조합니다.",
        evaluation: "예방 의무를 충분히 이행하지 않았다고 평가합니다.",
        remedy: "안전 감독과 예방 조치 강화를 제안합니다.",
      };
  for (const [dimension, field] of NARRATIVE_FIELDS) {
    const claimHex = Buffer.from(`${articleId}:${dimension}`).toString("hex").padEnd(64, "0").slice(0, 64);
    profile.dimensions[dimension] = {
      status: "observed",
      model_status: "supported",
      outlet_narration_observed: true,
      items: [{
        claim_id: `claim:${claimHex}`,
        code: `${family}_${field}`,
        frame_family: `${family}_${field}`,
        variant_key: `rules:${dimension}:${family}_${field}`,
        public_paraphrase: labels[field],
        voice: { kind: "journalist_narration", speaker_name: null, speaker_role: null },
        evidence,
      }],
    };
  }
  profile.actors_and_sources = affectedVoice
    ? [{
        actor_id: `actor:${Buffer.from(articleId).toString("hex").padEnd(64, "0").slice(0, 64)}`,
        name: null,
        role: "affected_person",
        role_label: "당사자·시민",
        direct_quote_count: 1,
        indirect_attribution_count: 0,
        evidence: [evidence],
      }]
    : [];
  return profile;
}

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
  assert.equal(comparison.issue_map.status, "withheld_source_dominated");
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

test("calculates issue-map anchors and outlet positions from one vote per article", async () => {
  const fixtures = [
    ["alpha-left-1", "알파일보", "alpha", "정부의 지원 대책은 집행 지연과 제도 공백이 문제로 지적된다."],
    ["alpha-left-2", "알파일보", "alpha", "복지 정책의 집행 지연과 지원 사업의 공백이 문제로 지적된다."],
    ["beta-right-1", "베타신문", "beta", "산업재해 사고와 노동자 피해가 증가해 안전 문제가 커지고 있다."],
    ["beta-right-2", "베타신문", "beta", "현장 사고와 인명 피해가 확산해 안전 문제가 커지고 있다."],
    ["gamma-left", "감마뉴스", "gamma", "지원 제도의 집행 지연과 정책 공백이 문제로 지적된다."],
    ["gamma-right", "감마뉴스", "gamma", "사고 피해가 증가하고 시민 안전 문제가 커지고 있다."],
  ];
  const profiles = [];
  const metadata = [];
  for (const [articleId, sourceName, mediaGroupId, bodyText] of fixtures) {
    profiles.push(await analyzeArticleFraming({ articleId, title: "같은 정책 쟁점", bodyText }));
    metadata.push({ articleId, sourceId: mediaGroupId, sourceName, mediaGroupId });
  }

  const comparison = buildIssueFrameComparison(profiles, metadata);
  const map = comparison.issue_map;
  assert.equal(map.status, "available");
  assert.equal(map.dimension, "problem_definition");
  assert.equal(map.left_anchor.article_count, 3);
  assert.equal(map.right_anchor.article_count, 3);
  assert.equal(map.selection_basis.axis_strength, 0.5);
  const bySource = new Map(map.outlets.map((outlet) => [outlet.source, outlet]));
  assert.deepEqual(
    [bySource.get("알파일보").classification, bySource.get("알파일보").score, bySource.get("알파일보").display_position],
    ["left", -1, 10],
  );
  assert.deepEqual(
    [bySource.get("베타신문").classification, bySource.get("베타신문").score, bySource.get("베타신문").display_position],
    ["right", 1, 90],
  );
  assert.deepEqual(
    [bySource.get("감마뉴스").classification, bySource.get("감마뉴스").score, bySource.get("감마뉴스").display_position],
    ["mixed", 0, 50],
  );
  assert.ok(map.outlets.every((outlet) => outlet.evidence.length >= 2));
  assert.ok(map.outlets.flatMap((outlet) => outlet.claim_ids).every((claimId) => /^claim:[a-f0-9]{64}$/.test(claimId)));
});

test("builds at most two complete-link narratives and evidence-based reader questions", async () => {
  const profiles = [
    await narrativeProfile("burden-1", "burden"),
    await narrativeProfile("burden-2", "burden"),
    await narrativeProfile("safety-1", "safety", { affectedVoice: true }),
    await narrativeProfile("safety-2", "safety", { affectedVoice: true }),
  ];
  const metadata = [
    { articleId: "burden-1", sourceId: "alpha", sourceName: "알파", mediaGroupId: "alpha" },
    { articleId: "burden-2", sourceId: "beta", sourceName: "베타", mediaGroupId: "beta" },
    { articleId: "safety-1", sourceId: "gamma", sourceName: "감마", mediaGroupId: "gamma" },
    { articleId: "safety-2", sourceId: "delta", sourceName: "델타", mediaGroupId: "delta" },
  ];

  const comparison = buildIssueFrameComparison(profiles, metadata);
  assert.equal(comparison.narratives.length, 2);
  assert.ok(comparison.narratives.every((narrative) => narrative.article_count === 2));
  assert.ok(comparison.narratives.every((narrative) => narrative.completeness === 1));
  assert.ok(comparison.narratives.every((narrative) => narrative.problem && narrative.cause && narrative.remedy));
  assert.ok(comparison.narratives.every((narrative) => narrative.claim_ids.length === 10));
  assert.ok(comparison.narratives.every((narrative) => narrative.evidence.length >= 2));

  const affectedRole = comparison.source_lens.roles.find((role) => role.role === "affected_person");
  assert.equal(affectedRole.article_count, 2);
  assert.equal(affectedRole.presence_gap, 1);
  const gamma = comparison.source_lens.by_outlet.find((entry) => entry.outlet === "감마");
  assert.equal(gamma.roles[0].article_count, 1);
  assert.equal(gamma.roles[0].presence_rate, 1);
  assert.equal(gamma.roles[0].mention_count, 1);

  assert.deepEqual(
    comparison.reader_questions.map((question) => question.trigger_type),
    ["narrative_contrast", "issue_axis_contrast", "affected_voice_gap"],
  );
  assert.ok(comparison.reader_questions.every((question) => question.basis_claim_ids.length));
  assert.ok(comparison.reader_questions.every((question) => question.evidence.length));
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

test("accepts semantic v2 profiles and discloses AI use in comparisons", async () => {
  const profile = await analyzeArticleFraming({
    articleId: "semantic-v2-1",
    title: "안전 대책",
    bodyText: "안전 사고 피해가 커지고 있어 예방 대책을 강화해야 한다.",
  });
  profile.schema_version = AI_ARTICLE_FRAME_PROFILE_SCHEMA;
  profile.engine = {
    ...profile.engine,
    semantic_ai: true,
    approach: "semantic_evidence_bounded",
    prompt_version: "2.0.0",
  };
  assert.equal(validateArticleFrameProfile(profile).valid, true);
  const comparison = buildIssueFrameComparison(
    [profile],
    [{ articleId: "semantic-v2-1", sourceId: "fixture", sourceName: "검증매체" }],
  );
  assert.equal(comparison.method.semantic_ai, true);
});

test("keeps different semantic values as separate comparison variants", async () => {
  const first = await analyzeArticleFraming({
    articleId: "semantic-difference-1",
    title: "수사권 논쟁",
    bodyText: "정부의 수사 제도 개편은 절차적 혼선을 줄여야 한다는 문제를 다룬다.",
  });
  const second = await analyzeArticleFraming({
    articleId: "semantic-difference-2",
    title: "수사권 논쟁",
    bodyText: "수사 제도 개편으로 시민의 권리가 침해될 수 있다는 문제를 다룬다.",
  });
  for (const [profile, value, variantKey] of [
    [first, "절차 혼선의 해소 필요", "untrusted-shared-key"],
    [second, "시민 권리 침해 우려", "untrusted-shared-key"],
  ]) {
    profile.schema_version = AI_ARTICLE_FRAME_PROFILE_SCHEMA;
    profile.engine = {
      ...profile.engine,
      semantic_ai: true,
      approach: "semantic_evidence_bounded",
      prompt_version: "2.0.0",
    };
    const item = profile.dimensions.problem_definition.items[0];
    profile.dimensions.problem_definition.items = [item];
    item.code = "semantic_problem_definition";
    item.frame_family = null;
    item.variant_key = variantKey;
    item.public_paraphrase = value;
  }
  const comparison = buildIssueFrameComparison(
    [first, second],
    [
      { articleId: first.article.article_id, sourceId: "alpha", sourceName: "알파", mediaGroupId: "alpha" },
      { articleId: second.article.article_id, sourceId: "beta", sourceName: "베타", mediaGroupId: "beta" },
    ],
  );
  const axis = comparison.comparison_axes.find(
    (entry) => entry.dimension === "problem_definition",
  );
  assert.equal(axis.patterns.length, 2);
  assert.deepEqual(
    axis.patterns.map((pattern) => pattern.public_paraphrase).sort(),
    ["시민 권리 침해 우려", "절차 혼선의 해소 필요"].sort(),
  );
  assert.equal(comparison.summary_30_seconds.divergence_detected, false);
  assert.match(comparison.summary_30_seconds.main_difference, /사람 검토 전까지 보류/);
});

test("counts unique articles rather than evidence spans in each pattern", async () => {
  const profile = await analyzeArticleFraming({
    articleId: "unique-article-count",
    title: "안전 대책",
    bodyText: "안전 사고 피해가 커지고 있다. 재난 피해 확산도 우려된다.",
  });
  const dimension = profile.dimensions.problem_definition;
  assert.ok(dimension.items.length >= 1);
  dimension.items.push(structuredClone(dimension.items[0]));
  const comparison = buildIssueFrameComparison(
    [profile],
    [{ articleId: profile.article.article_id, sourceId: "alpha", sourceName: "알파" }],
  );
  const axis = comparison.comparison_axes.find(
    (entry) => entry.dimension === "problem_definition",
  );
  assert.equal(axis.patterns[0].article_count, 1);
  assert.equal(axis.patterns[0].article_ids.length, 1);
});

test("applies source-dominance safety to semantic profiles with unknown genre", async () => {
  const profiles = [];
  for (const articleId of ["semantic-source-1", "semantic-source-2"]) {
    const profile = await analyzeArticleFraming({
      articleId,
      title: "정치인 발언 전달",
      bodyText: '야당 의원은 "정부가 책임지고 제도를 고쳐야 한다"고 주장했다.',
    });
    profile.schema_version = AI_ARTICLE_FRAME_PROFILE_SCHEMA;
    profile.engine = {
      ...profile.engine,
      semantic_ai: true,
      approach: "semantic_evidence_bounded",
      prompt_version: "2.0.0",
    };
    profile.genre = { code: "unknown", label: "자동 분류 안 함", evidence: [] };
    profiles.push(profile);
  }
  const metadata = [
    { articleId: "semantic-source-1", sourceId: "alpha", sourceName: "알파", mediaGroupId: "alpha" },
    { articleId: "semantic-source-2", sourceId: "beta", sourceName: "베타", mediaGroupId: "beta" },
  ];
  const baseline = buildIssueFrameComparison(profiles, metadata);
  const duplicated = structuredClone(profiles);
  for (const profile of duplicated) {
    const observed = Object.values(profile.dimensions).find(
      (dimension) => dimension.items?.length,
    );
    if (observed) {
      observed.items.push(
        ...Array.from({ length: 9 }, () => structuredClone(observed.items[0])),
      );
    }
  }
  const comparison = buildIssueFrameComparison(
    duplicated,
    metadata,
  );
  assert.equal(comparison.method.source_dominance_check.detected, true);
  assert.equal(comparison.summary_30_seconds.divergence_detected, false);
  assert.equal(
    comparison.method.source_dominance_check.total_item_count,
    baseline.method.source_dominance_check.total_item_count,
  );
});
