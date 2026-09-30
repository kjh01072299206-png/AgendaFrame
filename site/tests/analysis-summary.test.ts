import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ComparisonLead } from "../app/(shell)/comparison-lead";
import { FramingSemanticPage, OutletsSemanticPage } from "../app/(shell)/semantic-analysis-pages";
import {
  comparisonSummary,
  distinctComparisonSummary,
  selectRepresentativeGroups,
} from "../lib/initial-five/analysis-summary";
import { deriveIssue } from "../lib/initial-five/derive";
import { isPublishableEventSynthesis } from "../lib/initial-five/publication-contract";
import { buildParaphraseLinguisticAnalysis } from "../lib/initial-five/paraphrase-linguistic-analysis";
import type { IssueAnalysisBundle } from "../lib/initial-five/types";

const ENGINE = {
  engineLabel: "ai_semantic",
  semanticAi: true,
  status: "succeeded",
  model: "fixture-model",
  promptVersion: "fixture-prompt",
  schemaVersion: "fixture-schema",
};

type FixtureRow = {
  articleId: string;
  outlet: string;
  text?: string;
  family?: string;
  voice?: string;
  validEvidence?: boolean;
  items?: Array<{ text: string; family?: string; voice?: string; validEvidence?: boolean }>;
};

type PointSpec = {
  text: string;
  headline?: string;
  summary?: string;
  observationId?: string;
  relation: "same_core" | "same_core_with_detail" | "different_emphasis" | "contradictory" | "insufficient_evidence";
  articleIds: string[];
  evidence?: Array<{ articleId: string; sentence: number }>;
  voice?: string | null;
  validEvidence?: boolean;
};

function digest(index: number) {
  return `${String(index % 10)}${"a".repeat(63)}`;
}

function rawEvidence(articleId: string, index: number, valid = true) {
  return {
    article_id: articleId,
    locator: { paragraph: 1, sentence: index },
    sentence_sha256: valid ? digest(index) : "not-a-sentence-hash",
  };
}

function comparisonResult(rows: FixtureRow[], points: PointSpec[], status = "difference_confirmed") {
  const rowIndex = new Map(rows.map((row, index) => [row.articleId, index + 1]));
  return {
    version: "comparison-v1.0.0",
    status,
    reason: "fixture comparison result",
    analyzed_article_ids: rows.map((row) => row.articleId),
    analyzed_outlet_count: new Set(rows.map((row) => row.outlet)).size,
    primary_dimension: "problem_definition",
    dimensions: [{
      dimension: "problem_definition",
      label: "문제 정의",
      question: "무엇을 핵심 문제로 설명했나",
      status,
      points: points.map((point) => ({
        observation_id: point.observationId ?? `fixture:${point.relation}:${point.text}`,
        headline: point.headline ?? point.text,
        summary: point.summary ?? "관련 기사 근거를 연결해 관측했습니다.",
        text: point.text,
        relation: point.relation,
        article_ids: point.articleIds,
        voice_basis: point.voice === null
          ? undefined
          : { kind: point.voice ?? "journalist_narration", label: point.voice ?? "기자 서술", evidence: [] },
        evidence: (point.evidence ?? point.articleIds.map((articleId) => ({
          articleId,
          sentence: rowIndex.get(articleId) ?? 1,
        }))).map(({ articleId, sentence }) => rawEvidence(articleId, sentence, point.validEvidence !== false)),
      })),
    }],
  };
}

function makeBundle(rows: FixtureRow[], result?: Record<string, unknown>, semanticStatus = "succeeded") {
  const articles = rows.map((row) => ({
    articleId: row.articleId,
    id: row.articleId,
    title: `${row.outlet} 기사`,
    outlet: row.outlet,
    sourceId: null,
    mediaGroupId: null,
    publishedAt: "2026-08-15T00:00:00Z",
    section: "정치",
    canonicalUrl: `https://example.test/${row.articleId}`,
    bodySha256: null,
    issueId: "fixture-issue",
  }));
  const semanticProfiles = rows.map((row, rowIndex) => {
    const items = row.items ?? [{
      text: row.text ?? "",
      family: row.family,
      voice: row.voice,
      validEvidence: row.validEvidence,
    }];
    const validItems = items.filter((item) => item.text && item.validEvidence !== false && row.validEvidence !== false);
    return {
      articleId: row.articleId,
      status: "succeeded",
      engine: {
        ...ENGINE,
        articleId: row.articleId,
        evidenceCount: validItems.length,
        bodySha256: null,
        reviewRequired: false,
        fallbackReason: null,
      },
      evidence: validItems.map((_item, itemIndex) => ({
        articleId: row.articleId,
        locator: { paragraph: 1, sentence: rowIndex + 1 + itemIndex },
        sentenceSha256: digest(rowIndex + 1 + itemIndex),
      })),
      profile: {
        engine: {
          ...ENGINE,
          semantic_ai: true,
          prompt_version: "fixture-prompt-v1",
          analysis_schema_version: 3,
        },
        dimensions: {
          problem_definition: {
            status: "observed",
            model_status: "supported",
            items: items.map((item, itemIndex) => ({
              claim_id: `${row.articleId}-claim-${itemIndex}`,
              frame_family: item.family,
              public_paraphrase: item.text,
              voice: { kind: item.voice ?? row.voice ?? "journalist_narration" },
              evidence: {
                locator: { paragraph: 1, sentence: rowIndex + 1 + itemIndex },
                sentence_sha256: item.validEvidence === false || row.validEvidence === false
                  ? "not-a-sentence-hash"
                  : digest(rowIndex + 1 + itemIndex),
              },
            })),
          },
        },
      },
    };
  });
  const comparisonEvidence = rows.map((row, rowIndex) => rawEvidence(row.articleId, rowIndex + 1));
  const synthesis = result ? {
    usable: true,
    source: "gcp:event-synthesis",
    schemaVersion: "agendaframe.event-synthesis.v2.2",
    promptVersion: "event-synthesis-v2.2.0",
    invocation: { provider: "vertex_ai" },
    run_id: "fixture-run",
    event_paragraphs: [
      { text: "확인된 사건 설명입니다.", status: "observed", evidence: comparisonEvidence },
      { text: "확인된 추가 경위입니다.", status: "observed", evidence: comparisonEvidence },
    ],
    terms: [{ term: "사건", gloss: "기사에서 확인된 사건", evidence: comparisonEvidence }],
    common_ground: {
      text: "두 기사에서 사건의 공통 설명을 확인했습니다.",
      status: "observed",
      evidence: comparisonEvidence,
    },
    comparison_result: result,
  } : undefined;
  return {
    schemaVersion: "fixture",
    basisDate: "2026-08-15",
    status: "succeeded",
    issue: {
      issueId: "fixture-issue",
      rank: 1,
      title: "fixture",
      category: "정치",
      articleCount: rows.length,
      outletCount: new Set(rows.map((row) => row.outlet)).size,
    },
    analysisStatus: {
      state: semanticStatus,
      cluster: ENGINE,
      semantic: {
        ...ENGINE,
        status: semanticStatus,
        articleCount: rows.length,
        succeededArticleCount: rows.length,
        reviewNeededArticleCount: semanticStatus === "succeeded" ? 0 : rows.length,
        requiresHumanReview: false,
      },
    },
    clusterAi: {
      ...ENGINE,
      decision: "observed",
      coherence: "high",
      textScope: "fixture",
      fallbackReason: null,
      requiresHumanReview: false,
      summary: null,
      commonSubjects: [],
      narrativeVariants: [],
      outlierArticleIds: [],
      articleIds: rows.map((row) => row.articleId),
    },
    articles,
    semanticProfiles,
    ruleProfiles: [],
    comparison: { engine: ENGINE, data: synthesis ? { synthesis } : {}, evidence: [] },
    coderAgreement: null,
    lineage: { contractVersion: "fixture", basisDate: "2026-08-15", source: {}, issueId: "fixture-issue", runId: "fixture-run" },
  } as unknown as IssueAnalysisBundle;
}

test("A: same core and added detail is not promoted to a difference", () => {
  const rows = [
    { articleId: "a", outlet: "A 매체", text: "예산 축소를 핵심 문제로 설명했다." },
    { articleId: "b", outlet: "B 매체", text: "예산 축소와 지역 격차를 핵심 문제로 설명했다." },
  ];
  const result = comparisonResult(rows, [
    { text: "예산 축소가 공통 핵심", relation: "same_core", articleIds: ["a", "b"] },
    { text: "지역 격차를 추가로 설명", relation: "same_core_with_detail", articleIds: ["b"] },
  ], "no_clear_difference");
  const summary = comparisonSummary(makeBundle(rows, result));
  assert.equal(summary.status, "no_clear_difference");
  assert.ok(summary.groups.every((group) => group.relation !== "different_emphasis"));
});

test("B: different emphasis is confirmed only from an explicit cross-outlet relation", () => {
  const rows = [
    { articleId: "a", outlet: "A 매체", text: "에너지 가격 부담을 핵심 문제로 설명했다." },
    { articleId: "b", outlet: "B 매체", text: "해협 통제권 다툼을 핵심 문제로 설명했다." },
  ];
  const summary = comparisonSummary(makeBundle(rows, comparisonResult(rows, [
    { text: "에너지 가격 부담을 앞세움", relation: "different_emphasis", articleIds: ["a"] },
    { text: "해협 통제권 다툼을 앞세움", relation: "different_emphasis", articleIds: ["b"] },
  ])));
  assert.equal(summary.status, "difference_confirmed");
  assert.equal(summary.representativeGroups.length, 2);
  assert.deepEqual(new Set(summary.representativeGroups.flatMap((group) => group.outlets)), new Set(["A 매체", "B 매체"]));
});

test("B2: card headline and summary remain distinct and duplicate legacy copy is omitted", () => {
  const rows = [
    { articleId: "a", outlet: "A 매체", text: "지역별 공공요금 부담을 설명했다." },
    { articleId: "b", outlet: "B 매체", text: "공공요금 인상 배경을 설명했다." },
  ];
  const sameCopy = comparisonSummary(makeBundle(rows, comparisonResult(rows, [
    { text: "공공요금 부담을 서로 다른 측면에서 설명했다.", relation: "different_emphasis", articleIds: ["a", "b"] },
  ])));
  assert.equal(distinctComparisonSummary({ ...sameCopy.groups[0], emphasis: sameCopy.groups[0].title }), null);

  const separateCopy = comparisonSummary(makeBundle(rows, comparisonResult(rows, [
    {
      text: "두 매체는 공공요금 문제를 서로 다른 설명으로 묶었다.",
      headline: "공공요금 부담과 인상 배경",
      summary: "한쪽은 지역 부담을, 다른 쪽은 인상 배경을 먼저 설명했다.",
      relation: "different_emphasis",
      articleIds: ["a", "b"],
    },
  ])));
  assert.equal(distinctComparisonSummary(separateCopy.groups[0]), "한쪽은 지역 부담을, 다른 쪽은 인상 배경을 먼저 설명했다.");
});

test("C: contradiction remains distinct from ordinary emphasis", () => {
  const rows = [
    { articleId: "a", outlet: "A 매체", text: "협상이 중단됐다고 설명했다." },
    { articleId: "b", outlet: "B 매체", text: "협상이 계속된다고 설명했다." },
  ];
  const summary = comparisonSummary(makeBundle(rows, comparisonResult(rows, [
    { text: "협상이 중단됨", relation: "contradictory", articleIds: ["a"] },
    { text: "협상이 계속됨", relation: "contradictory", articleIds: ["b"] },
  ])));
  assert.equal(summary.status, "difference_confirmed");
  assert.ok(summary.groups.every((group) => group.relation === "contradictory"));
});

test("D: insufficient evidence is held rather than guessed", () => {
  const rows = [
    { articleId: "a", outlet: "A 매체", text: "한 가지 설명" },
    { articleId: "b", outlet: "B 매체", text: "다른 설명" },
  ];
  const summary = comparisonSummary(makeBundle(rows, comparisonResult(rows, [
    { text: "판정할 수 없음", relation: "insufficient_evidence", articleIds: ["a", "b"] },
  ], "held_for_analysis")));
  assert.equal(summary.status, "held_for_analysis");
  assert.equal(summary.groups.length, 0);
});

test("E: the shipped rank-5 snapshot does not invent a difference when comparison_result is absent", () => {
  const bundle = JSON.parse(readFileSync("public/initial-five/issues/live-2026-08-15-top-5.json", "utf8")) as IssueAnalysisBundle;
  const summary = comparisonSummary(bundle);
  const requestedArticleIds = new Set([
    "86067ecb43faae14baa94d04ed8fba88",
    "83ec12943a84ec03876bd4537d4eb107",
  ]);
  assert.ok([...requestedArticleIds].every((articleId) => bundle.articles.some((article) => article.articleId === articleId)));
  assert.equal(summary.status, "held_for_analysis");
  assert.equal(summary.groups.length, 0);
  assert.match(summary.statusReason, /비교|연결/);
});

test("synthetic hard negatives cannot be merged by profile text without an explicit AI comparison result", () => {
  const cases = readFileSync("../evals/event-synthesis/comparison-hard-negatives-v2.2.0.jsonl", "utf8")
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as {
      case: string;
      synthetic: boolean;
      articles?: Array<{ article_id: string; outlet: string; text: string; voice: string }>;
    });
  assert.ok(cases.length >= 12);
  assert.ok(cases.every((fixture) => fixture.synthetic));
  for (const fixture of cases.filter((candidate) => ["A", "B", "C", "D"].includes(candidate.case))) {
    const rows = (fixture.articles ?? []).map((article) => ({
      articleId: article.article_id,
      outlet: article.outlet,
      text: article.text,
      voice: article.voice,
    }));
    const summary = comparisonSummary(makeBundle(rows));
    assert.equal(summary.status, "held_for_analysis", `fixture ${fixture.case} must await an explicit relation`);
    assert.equal(summary.groups.length, 0, `fixture ${fixture.case} must not be merged from text alone`);
  }
});

test("F: same-family and different wording are not semantically merged", () => {
  const rows = [
    { articleId: "a", outlet: "A 매체", family: "external_event", text: "에너지 가격 상승을 설명했다." },
    { articleId: "b", outlet: "B 매체", family: "external_event", text: "해협 통제권 다툼을 설명했다." },
  ];
  const summary = comparisonSummary(makeBundle(rows));
  assert.equal(summary.status, "held_for_analysis");
  assert.equal(summary.groups.length, 0);
});

test("G: different-family and same core can be explicitly marked shared", () => {
  const rows = [
    { articleId: "a", outlet: "A 매체", family: "law", text: "제도 변경을 핵심 문제로 설명했다." },
    { articleId: "b", outlet: "B 매체", family: "politics", text: "제도 변경을 핵심 문제로 설명했다." },
  ];
  const summary = comparisonSummary(makeBundle(rows, comparisonResult(rows, [
    { text: "제도 변경을 핵심 문제로 설명", relation: "same_core", articleIds: ["a", "b"] },
  ], "no_clear_difference")));
  assert.equal(summary.status, "no_clear_difference");
  assert.equal(summary.groups[0]?.relation, "same_core");
});

test("H: two articles from one outlet cannot confirm a media difference", () => {
  const rows = [
    { articleId: "a1", outlet: "A 매체", text: "가격 부담을 앞세웠다." },
    { articleId: "a2", outlet: "A 매체", text: "통제권 다툼을 앞세웠다." },
  ];
  const summary = comparisonSummary(makeBundle(rows, comparisonResult(rows, [
    { text: "가격 부담", relation: "different_emphasis", articleIds: ["a1"] },
    { text: "통제권 다툼", relation: "different_emphasis", articleIds: ["a2"] },
  ])));
  assert.equal(summary.status, "held_for_analysis");
});

test("I: source-only observations stay out of journalist comparison", () => {
  const rows = [
    { articleId: "a", outlet: "A 매체", text: "취재원은 가격 부담을 말했다.", voice: "direct_quote" },
    { articleId: "b", outlet: "B 매체", text: "취재원은 통제권 다툼을 말했다.", voice: "indirect_source" },
  ];
  const summary = comparisonSummary(makeBundle(rows));
  assert.equal(summary.status, "held_for_analysis");
  assert.equal(summary.groups.length, 0);
  assert.equal(summary.sourceGroups.length, 2);
});

test("render: held comparison keeps source-only speech outside outlet comparison cards", () => {
  const rows = [
    { articleId: "a", outlet: "A 매체", text: "취재원은 가격 부담을 말했다.", voice: "direct_quote" },
    { articleId: "b", outlet: "B 매체", text: "취재원은 통제권 다툼을 말했다.", voice: "indirect_source" },
  ];
  const bundle = makeBundle(rows) as IssueAnalysisBundle;
  const issue = {
    articleCount: rows.length,
    articles: bundle.articles.map((article) => ({
      articleId: article.articleId,
      outlet: article.outlet,
      title: article.title,
      url: article.canonicalUrl,
    })),
  } as never;
  const markup = renderToStaticMarkup(createElement(ComparisonLead, { bundle, issue, synthesis: null }));
  const groupsMarkup = markup.slice(markup.indexOf('id="sec-camps"'));
  assert.match(groupsMarkup, /class="afp-no-groups"/);
  assert.match(groupsMarkup, /class="afp-source-only-details"/);
  assert.match(groupsMarkup, /언론사 비교에 사용하지 않음/);
  assert.match(groupsMarkup, /class="afp-source-only-item"/);
  assert.doesNotMatch(groupsMarkup, /afp-camp-card-v2/);
  assert.equal((markup.match(/비교 질문 미확정/gu) ?? []).length, 1);
});

test("J: failed or conflicting remnants cannot produce a confirmed difference", () => {
  const rows = [
    { articleId: "a", outlet: "A 매체", text: "가격 부담" },
    { articleId: "b", outlet: "B 매체", text: "통제권 다툼" },
  ];
  const result = comparisonResult(rows, [
    { text: "가격 부담", relation: "different_emphasis", articleIds: ["a"] },
    { text: "통제권 다툼", relation: "different_emphasis", articleIds: ["b"] },
  ]);
  const conflicting = makeBundle(rows, result, "conflicting");
  const summary = comparisonSummary(conflicting);
  assert.equal(summary.status, "analysis_failed");
});

test("J2: a same-core point cannot lend its second outlet to a one-outlet difference", () => {
  const rows = [
    { articleId: "a", outlet: "A 매체", text: "예산 축소를 공통 핵심으로 설명했다." },
    { articleId: "b", outlet: "B 매체", text: "예산 축소를 공통 핵심으로 설명했다." },
  ];
  const summary = comparisonSummary(makeBundle(rows, comparisonResult(rows, [
    { text: "예산 축소가 공통 핵심", relation: "same_core", articleIds: ["a", "b"] },
    { text: "A 매체만 지역 격차를 추가 강조", relation: "different_emphasis", articleIds: ["a"] },
  ])));
  assert.equal(summary.status, "held_for_analysis");
  assert.equal(summary.groups.length, 0);
});

test("J3: absent voice attribution is not presumed to be journalist narration", () => {
  const rows = [
    { articleId: "a", outlet: "A 매체", text: "가격 부담을 강조했다." },
    { articleId: "b", outlet: "B 매체", text: "통제권 다툼을 강조했다." },
  ];
  const summary = comparisonSummary(makeBundle(rows, comparisonResult(rows, [
    { text: "가격 부담 강조", relation: "different_emphasis", articleIds: ["a"], voice: null },
    { text: "통제권 다툼 강조", relation: "different_emphasis", articleIds: ["b"], voice: null },
  ])));
  assert.equal(summary.status, "held_for_analysis");
  assert.equal(summary.groups.length, 0);
  assert.equal(summary.sourceGroups.length, 0);
});

test("J4: a failed comparison dimension cannot publish its stale points", () => {
  const rows = [
    { articleId: "a", outlet: "A 매체", text: "가격 부담을 강조했다." },
    { articleId: "b", outlet: "B 매체", text: "통제권 다툼을 강조했다." },
  ];
  const result = comparisonResult(rows, [
    { text: "가격 부담 강조", relation: "different_emphasis", articleIds: ["a"] },
    { text: "통제권 다툼 강조", relation: "different_emphasis", articleIds: ["b"] },
  ]);
  const dimension = (result.dimensions as Array<Record<string, unknown>>)[0];
  dimension.status = "conflicting";
  const summary = comparisonSummary(makeBundle(rows, result));
  assert.notEqual(summary.status, "difference_confirmed");
  assert.equal(summary.dimensions[0]?.status, "analysis_failed");
  assert.equal(summary.dimensions[0]?.groups.length, 0);
});

test("J5: a conflicting result cannot publish stale points from otherwise successful dimensions", () => {
  const rows = [
    { articleId: "a", outlet: "A 매체", text: "가격 부담을 강조했다." },
    { articleId: "b", outlet: "B 매체", text: "통제권 다툼을 강조했다." },
  ];
  const result = comparisonResult(rows, [
    { text: "가격 부담 강조", relation: "different_emphasis", articleIds: ["a"] },
    { text: "통제권 다툼 강조", relation: "different_emphasis", articleIds: ["b"] },
  ], "difference_confirmed");
  result.status = "conflicting";
  const summary = comparisonSummary(makeBundle(rows, result));
  assert.equal(summary.status, "analysis_failed");
  assert.equal(summary.dimensions[0]?.status, "analysis_failed");
  assert.equal(summary.dimensions[0]?.groups.length, 0);
});

test("J6: insufficient evidence is held for analysis, not reported as an analysis failure", () => {
  const rows = [
    { articleId: "a", outlet: "A 매체", text: "가격 부담을 강조했다." },
    { articleId: "b", outlet: "B 매체", text: "통제권 다툼을 강조했다." },
  ];
  const summary = comparisonSummary(makeBundle(rows, comparisonResult(rows, [], "insufficient_evidence")));
  assert.equal(summary.status, "held_for_analysis");
  assert.equal(summary.dimensions[0]?.status, "held_for_analysis");
});

test("J7: failed comparison state suppresses otherwise evidence-valid common-ground remnants", () => {
  const rows = [
    { articleId: "a", outlet: "A 매체", text: "가격 부담을 설명했다." },
    { articleId: "b", outlet: "B 매체", text: "가격 부담을 설명했다." },
  ];
  const bundle = makeBundle(rows, comparisonResult(rows, [], "analysis_failed"));
  const synthesis = bundle.comparison?.data?.synthesis as Record<string, unknown>;
  synthesis.common_ground = {
    text: "두 기사 모두 가격 부담을 설명했다.",
    status: "observed",
    evidence: [rawEvidence("a", 1), rawEvidence("b", 2)],
  };
  assert.equal(comparisonSummary(bundle).commonText, null);
});

test("J8: declared missing articles invalidate a comparison point instead of being silently dropped", () => {
  const rows = [
    { articleId: "a", outlet: "A 매체", text: "가격 부담을 강조했다." },
    { articleId: "b", outlet: "B 매체", text: "통제권 다툼을 강조했다." },
  ];
  const summary = comparisonSummary(makeBundle(rows, comparisonResult(rows, [
    {
      text: "A 매체의 가격 부담 설명",
      relation: "different_emphasis",
      articleIds: ["a", "missing-article"],
      evidence: [{ articleId: "a", sentence: 1 }],
    },
    {
      text: "B 매체의 통제권 설명",
      relation: "different_emphasis",
      articleIds: ["b"],
    },
  ])));
  assert.equal(summary.status, "held_for_analysis");
  assert.equal(summary.groups.length, 0);
});

test("K2: every verified evidence span for a claim in one article is preserved", () => {
  const rows = [
    { articleId: "a", outlet: "A 매체", items: [
      { text: "공공요금 부담을 다뤘다." },
      { text: "공공요금 부담의 지역별 차이를 다뤘다." },
    ] },
    { articleId: "b", outlet: "B 매체", text: "공공요금 부담을 다뤘다." },
  ];
  const summary = comparisonSummary(makeBundle(rows, comparisonResult(rows, [
    {
      text: "두 매체가 공공요금 부담을 서로 다른 측면에서 설명했다.",
      relation: "different_emphasis",
      articleIds: ["a", "b"],
      evidence: [
        { articleId: "a", sentence: 1 },
        { articleId: "a", sentence: 2 },
        { articleId: "b", sentence: 2 },
      ],
    },
  ])));
  const observations = summary.groups[0]?.observations ?? [];
  assert.equal(observations.length, 3);
  assert.equal(observations.filter((row) => row.articleId === "a").length, 2);
  assert.equal(new Set(observations.map((row) => [
    row.articleId,
    row.evidence.locator?.paragraph,
    row.evidence.locator?.sentence,
    row.evidence.sentence_sha256,
  ].join(":"))).size, 3);
});

test("K: evidence that is not in the article evidence list is discarded", () => {
  const rows = [
    { articleId: "a", outlet: "A 매체", text: "가격 부담" },
    { articleId: "b", outlet: "B 매체", text: "통제권 다툼" },
  ];
  const result = comparisonResult(rows, [
    { text: "가격 부담", relation: "different_emphasis", articleIds: ["a"], validEvidence: false },
    { text: "통제권 다툼", relation: "different_emphasis", articleIds: ["b"] },
  ]);
  const summary = comparisonSummary(makeBundle(rows, result));
  assert.equal(summary.status, "held_for_analysis");
});

test("L: group order is stable and does not depend on locale", () => {
  const rows = [
    { articleId: "b", outlet: "B 매체", text: "통상 관세 조치의 영향을 설명했다." },
    { articleId: "a", outlet: "A 매체", text: "이혼 재산분할 법리를 설명했다." },
  ];
  const summary = comparisonSummary(makeBundle(rows, comparisonResult(rows, [
    { text: "통상 관세 조치", relation: "different_emphasis", articleIds: ["b"] },
    { text: "이혼 재산분할 법리", relation: "different_emphasis", articleIds: ["a"] },
  ])));
  assert.deepEqual(summary.groups.map((group) => group.title), ["이혼 재산분할 법리", "통상 관세 조치"]);
});

test("L2: exact-text source group title is invariant to profile input order", () => {
  const rows = [
    { articleId: "a", outlet: "A 매체", text: "취재원은 가격 부담을 말했다.", voice: "direct_quote" },
    { articleId: "b", outlet: "B 매체", text: "취재원은 가격 부담을 말했다!", voice: "direct_quote" },
  ];
  const forward = comparisonSummary(makeBundle(rows));
  const reverse = comparisonSummary(makeBundle([...rows].reverse()));
  assert.equal(forward.sourceGroups[0]?.title, reverse.sourceGroups[0]?.title);
});

test("M: representative selection covers Kyunghyang when KBS groups would otherwise dominate", () => {
  const groups = ["KBS-1", "KBS-2", "KBS-3", "Kyunghyang"].map((key) => ({
    key,
    dimension: "problem_definition",
    dimensionLabel: "문제 정의",
    title: key,
    emphasis: key,
    articleIds: [key],
    outlets: [key.startsWith("KBS") ? "KBS" : "경향신문"],
    articleCount: 1,
    voiceLabel: "기자 서술",
    observations: [],
    details: [],
    relation: "different_emphasis" as const,
  }));
  const selected = selectRepresentativeGroups(groups, 3);
  assert.ok(selected.some((group) => group.outlets.includes("경향신문")));
  assert.equal(selected.length, 3);
});

test("N: all five shipped issues remain bounded without a synthetic public split", () => {
  for (const rank of [1, 2, 3, 4, 5]) {
    const id = `live-2026-08-15-top-${rank}`;
    const bundle = JSON.parse(readFileSync(`public/initial-five/issues/${id}.json`, "utf8")) as IssueAnalysisBundle;
    const summary = comparisonSummary(bundle);
    assert.ok(["difference_confirmed", "no_clear_difference", "held_for_analysis", "analysis_failed"].includes(summary.status));
    assert.ok(!summary.statusLabel.includes("synthetic"));
  }
});

test("O: rank-2 representative cards cover another outlet and keep the remaining groups reachable", () => {
  const rows = [
    { articleId: "k1", outlet: "KBS 뉴스", text: "검거 경과를 앞세웠다." },
    { articleId: "k2", outlet: "KBS 뉴스", text: "법적 절차를 앞세웠다." },
    { articleId: "k3", outlet: "KBS 뉴스", text: "정책 배경을 앞세웠다." },
    { articleId: "g1", outlet: "경향신문", text: "피해 영향과 대응을 앞세웠다." },
  ];
  const result = comparisonResult(rows, [
    { text: "검거 경과를 앞세움", relation: "different_emphasis", articleIds: ["k1"] },
    { text: "법적 절차를 앞세움", relation: "different_emphasis", articleIds: ["k2"] },
    { text: "정책 배경을 앞세움", relation: "different_emphasis", articleIds: ["k3"] },
    { text: "피해 영향과 대응을 앞세움", relation: "different_emphasis", articleIds: ["g1"] },
  ]);
  const summary = comparisonSummary(makeBundle(rows, result));
  const selectedKeys = new Set(summary.representativeGroups.map((group) => group.key));
  assert.equal(summary.status, "difference_confirmed");
  assert.equal(summary.representativeGroups.length, 3);
  assert.ok(summary.representativeGroups.some((group) => group.outlets.includes("경향신문")));
  assert.equal(summary.remainingGroupCount, summary.allGroups.length - summary.representativeGroups.length);
  assert.ok(summary.allGroups.some((group) => !selectedKeys.has(group.key)), "the hidden group must remain in allGroups");
});

test("P: legacy v2 event synthesis cannot satisfy the current publication comparison contract", () => {
  const bundle = JSON.parse(readFileSync("public/initial-five/issues/live-2026-08-15-top-1.json", "utf8")) as IssueAnalysisBundle;
  assert.equal(bundle.comparison?.data?.synthesis?.promptVersion, "event-synthesis-v2.0.0");
  assert.equal(bundle.comparison?.data?.synthesis?.comparison_result, undefined);
  assert.equal(isPublishableEventSynthesis(bundle), false);
});

test("Q: v2.2 synthesis with an explicit held comparison state can satisfy the publication contract", () => {
  const bundle = {
    lineage: { runId: "run-1" },
    comparison: {
      data: {
        synthesis: {
          usable: true,
          source: "gcp:event-synthesis",
          schemaVersion: "agendaframe.event-synthesis.v2.2",
          promptVersion: "event-synthesis-v2.2.0",
          run_id: "run-1",
          invocation: { provider: "vertex_ai" },
          event_paragraphs: [{ text: "사건이 확인됩니다.", status: "observed", evidence: [{}] }, { text: "추가 경위.", status: "observed", evidence: [{}] }],
          terms: [{ term: "사건", gloss: "확인된 사건", evidence: [{}] }],
          common_ground: { text: null, status: "insufficient_evidence", evidence: [] },
          comparison_result: {
            version: "comparison-v1.0.0",
            status: "held_for_analysis",
            dimensions: [],
            analyzed_article_ids: [],
            analyzed_outlet_count: 0,
          },
        },
      },
    },
  };
  assert.equal(isPublishableEventSynthesis(bundle as never), true);
});

test("R: saved paraphrases produce evidence-bound partial linguistic observations without crossing sentences or speakers", () => {
  const rows: FixtureRow[] = [
    {
      articleId: "a",
      outlet: "A 매체",
      items: [
        { text: "기후 규제 강화" },
        { text: "경제 부담" },
      ],
    },
    {
      articleId: "b",
      outlet: "B 매체",
      items: [
        { text: "기후 규제 완화" },
        { text: "기업 피해 증가", voice: "indirect_source" },
      ],
    },
  ];
  const analysis = buildParaphraseLinguisticAnalysis(makeBundle(rows, undefined, "review_needed"));
  const hasEdge = (left: string, right: string) => analysis.network.edges.some((edge) =>
    new Set([edge.source, edge.target]).has(left) && new Set([edge.source, edge.target]).has(right));

  assert.equal(analysis.issueSemanticStatus, "review_needed");
  assert.equal(analysis.analyzedArticleCount, 2, "successful per-article outputs remain visible while the issue is held");
  assert.equal(analysis.validParaphraseCount, 3);
  assert.equal(analysis.excludedSourceObservationCount, 1);
  assert.ok(analysis.terms.some((term) => term.term === "기후"));
  assert.ok(!analysis.terms.some((term) => term.term === "기업" || term.term === "피해"));
  assert.ok(hasEdge("noun:기후", "predicate:규제하다"), "terms from one saved paraphrase co-occur");
  assert.ok(!hasEdge("noun:기후", "noun:경제"), "terms from separate paraphrases do not become an edge");
  const evidenceEdge = analysis.network.edges.find((edge) => new Set([edge.source, edge.target]).has("noun:기후")
    && new Set([edge.source, edge.target]).has("predicate:규제하다"));
  assert.equal(evidenceEdge?.observations[0].articleId, "a");
  assert.equal(evidenceEdge?.observations[0].claimId, "a-claim-0");
  assert.equal(evidenceEdge?.observations[0].voiceKind, "journalist_narration");
  assert.deepEqual(evidenceEdge?.observations[0].evidence.locator, { paragraph: 1, sentence: 1 });
  assert.match(evidenceEdge?.observations[0].evidence.sentence_sha256 ?? "", /^[a-f0-9]{64}$/);
  assert.equal(analysis.analysisRuns[0].promptVersion, "fixture-prompt-v1");
  assert.equal(analysis.analysisRuns[0].schemaVersion, 3);
  assert.ok(!("text" in analysis.terms[0]), "the generated result does not retain paraphrase text");
});

test("S: paraphrases with broken article/locator/hash links never create terms or network edges", () => {
  const analysis = buildParaphraseLinguisticAnalysis(makeBundle([
    { articleId: "a", outlet: "A 매체", items: [{ text: "기후 규제 강화", validEvidence: false }] },
  ]));
  assert.equal(analysis.validParaphraseCount, 0);
  assert.deepEqual(analysis.terms, []);
  assert.deepEqual(analysis.network.edges, []);
});

test("T: shipped issue snapshots yield deterministic, traceable paraphrase-language observations", () => {
  for (let rank = 1; rank <= 5; rank += 1) {
    const bundle = JSON.parse(readFileSync(`public/initial-five/issues/live-2026-08-15-top-${rank}.json`, "utf8")) as IssueAnalysisBundle;
    const analysis = buildParaphraseLinguisticAnalysis(bundle);
    assert.ok(analysis.validParaphraseCount > 0, `rank ${rank} should use saved, evidence-linked public paraphrases`);
    assert.ok(analysis.analyzedArticleCount > 0);
    assert.ok(analysis.analysisRuns.length > 0);
    assert.equal(analysis.analyzer.maxTermsPerParaphrase, 40);
    assert.ok(analysis.analyzer.limitation.length > 0);
    assert.ok(analysis.terms.every((term) => term.observations.every((observation) =>
      observation.articleId && observation.claimId && observation.voiceKind === "journalist_narration"
      && /^[a-f0-9]{64}$/.test(observation.evidence.sentence_sha256)
      && observation.promptVersion && observation.schemaVersion)));
    assert.ok(analysis.network.edges.every((edge) => edge.weight === edge.observations.length && edge.weight > 0));
  }
});

test("U: conflicting prose for one stable claim and sentence is withheld instead of input-order deduplicated", () => {
  const bundle = makeBundle([{
    articleId: "a",
    outlet: "A 매체",
    items: [{ text: "기후 규제 강화" }, { text: "경제 부담" }],
  }]);
  const items = bundle.semanticProfiles[0].profile?.dimensions?.problem_definition?.items ?? [];
  items[1].claim_id = items[0].claim_id;
  items[1].evidence = items[0].evidence;
  const analysis = buildParaphraseLinguisticAnalysis(bundle);
  assert.equal(analysis.validParaphraseCount, 0);
  assert.deepEqual(analysis.terms, []);
  assert.deepEqual(analysis.network.edges, []);
});

test("V: issue-level review holds comparisons but preserves individually evidenced article rows", () => {
  const bundle = makeBundle([
    { articleId: "a", outlet: "A 매체", text: "예산 집행 시점을 기사 근거로 설명했다." },
    { articleId: "b", outlet: "B 매체", text: "사업 일정의 영향을 기사 근거로 설명했다." },
  ], undefined, "review_needed");
  bundle.analysisStatus.semantic.requiresHumanReview = true;
  const issue = deriveIssue(bundle);
  const framingMarkup = renderToStaticMarkup(createElement(FramingSemanticPage, { bundle, issue }));
  const outletsMarkup = renderToStaticMarkup(createElement(OutletsSemanticPage, { bundle, issue }));
  const summary = comparisonSummary(bundle);

  assert.ok(framingMarkup.includes("예산 집행 시점을 기사 근거로 설명했다."));
  assert.ok(framingMarkup.includes("사업 일정의 영향을 기사 근거로 설명했다."));
  assert.ok(outletsMarkup.includes("예산 집행 시점을 기사 근거로 설명했다."));
  assert.ok(outletsMarkup.includes("사업 일정의 영향을 기사 근거로 설명했다."));
  assert.match(framingMarkup, /사람 검토 전/);
  assert.equal(summary.status, "held_for_analysis");
  assert.equal(summary.commonText, null);
  assert.deepEqual(summary.groups, []);
});
