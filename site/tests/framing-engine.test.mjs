import assert from "node:assert/strict";
import test from "node:test";

import {
  ARTICLE_FRAME_PROFILE_SCHEMA,
  analyzeArticleFraming,
  buildIssueFrameComparison,
  segmentKoreanArticle,
  validateArticleFrameProfile,
} from "../worker/framing-engine.mjs";

test("segments Korean paragraphs and sentences with stable locators", () => {
  const sentences = segmentKoreanArticle("첫 문장입니다. 둘째 문장입니다.\n\n새 문단입니다!");
  assert.deepEqual(
    sentences.map(({ paragraph, sentence }) => [paragraph, sentence]),
    [[1, 1], [1, 2], [2, 1]],
  );
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
