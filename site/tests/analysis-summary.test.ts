import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  comparisonSummary,
  sameComparisonMeaning,
} from "../lib/initial-five/analysis-summary";
import { deriveIssue, type IssueView } from "../lib/initial-five/derive";
import type { IssueAnalysisBundle } from "../lib/initial-five/types";

const ENGINE = {
  engineLabel: "ai_semantic",
  semanticAi: true,
  status: "succeeded",
  model: "fixture-model",
  promptVersion: "fixture-prompt",
  schemaVersion: "fixture-schema",
};

function evidence(index: number, valid = true) {
  return {
    locator: { paragraph: 1, sentence: index },
    sentence_sha256: valid ? `${String(index % 10)}${"a".repeat(63)}` : "not-a-sentence-hash",
  };
}

function makeBundle(
  rows: Array<{
    articleId: string;
    outlet: string;
    text?: string;
    family?: string;
    voice?: string;
    validEvidence?: boolean;
    items?: Array<{ text: string; family?: string; voice?: string; validEvidence?: boolean }>;
  }>,
) {
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
      state: "succeeded",
      cluster: ENGINE,
      semantic: {
        ...ENGINE,
        articleCount: rows.length,
        succeededArticleCount: rows.length,
        reviewNeededArticleCount: 0,
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
    semanticProfiles: rows.map((row, index) => ({
      articleId: row.articleId,
      status: "succeeded",
      engine: {
        ...ENGINE,
        articleId: row.articleId,
        evidenceCount: 1,
        bodySha256: null,
        reviewRequired: false,
        fallbackReason: null,
      },
      evidence: [],
      profile: {
        engine: ENGINE,
        dimensions: {
          problem_definition: {
            status: "observed",
            model_status: "supported",
          items: (row.items ?? [{
            text: row.text ?? "",
            family: row.family,
            voice: row.voice,
            validEvidence: row.validEvidence,
          }]).map((item, itemIndex) => ({
            claim_id: `${row.articleId}-claim-${itemIndex}`,
            frame_family: item.family,
            public_paraphrase: item.text,
            voice: { kind: item.voice ?? row.voice ?? "journalist_narration" },
            evidence: evidence(index + itemIndex + 1, item.validEvidence !== false && row.validEvidence !== false),
          })),
          },
        },
      },
    })),
    ruleProfiles: [],
    comparison: { engine: ENGINE, data: {}, evidence: [] },
    coderAgreement: null,
    lineage: {
      contractVersion: "fixture",
      basisDate: "2026-08-15",
      source: {
        top5SchemaVersion: null,
        top5GeneratedAt: null,
        metadataSchemaVersion: null,
        metadataGeneratedAt: null,
        semanticDirectory: "fixture",
        semanticFileCount: rows.length,
      },
      issueId: "fixture-issue",
    },
  } as unknown as IssueAnalysisBundle;
}

function issueView(articleCount: number) {
  return { articleCount } as IssueView;
}

test("Top 1 keeps energy-price and control/conflict explanations in separate groups", () => {
  const bundle = JSON.parse(readFileSync("public/initial-five/issues/live-2026-08-15-top-1.json", "utf8")) as IssueAnalysisBundle;
  const summary = comparisonSummary(bundle, deriveIssue(bundle));
  const cause = summary.dimensions.find((dimension) => dimension.dimension === "causal_interpretation");
  assert.ok(cause);
  assert.ok(cause.groups.some((group) => group.outlets.includes("서울신문") && /에너지|가격/.test(group.title)));
  assert.ok(cause.groups.some((group) => group.outlets.includes("조선일보") && /통제권|무력 대치/.test(group.title)));
  assert.ok(!cause.groups.some((group) => group.outlets.includes("서울신문") && group.outlets.includes("조선일보")));
});

test("Top 4 treats prosecution wording and name lists as one shared explanation", () => {
  const bundle = JSON.parse(readFileSync("public/initial-five/issues/live-2026-08-15-top-4.json", "utf8")) as IssueAnalysisBundle;
  const summary = comparisonSummary(bundle, deriveIssue(bundle));
  assert.notEqual(summary.status, "difference_confirmed");
  assert.equal(summary.groups.length, 1);
  assert.deepEqual(summary.groups[0]?.outlets.sort(), ["KBS 뉴스", "경향신문", "동아일보"]);
});

test("different frame-family codes do not by themselves create a media difference", () => {
  const bundle = makeBundle([
    { articleId: "a", outlet: "A 매체", family: "judiciary_law_enforcement", text: "특검은 체포 방해 혐의로 국민의힘 의원을 기소했다." },
    { articleId: "b", outlet: "B 매체", family: "legislature_politics", text: "특검이 체포영장 집행을 방해한 국민의힘 정치인들을 재판에 넘겼다." },
  ]);
  const summary = comparisonSummary(bundle, issueView(2));
  assert.equal(summary.status, "no_clear_difference");
  assert.equal(summary.groups.length, 1);
  assert.equal(sameComparisonMeaning("특검은 윤 전 대통령 체포를 방해한 혐의로 국민의힘 의원을 기소했다", "윤석열 전 대통령 체포영장 집행을 방해한 국민의힘 정치인들을 재판에 넘겼다", "responsibility_attribution"), true);
});

test("the same family code can still produce two concrete explanation groups", () => {
  const bundle = makeBundle([
    { articleId: "a", outlet: "A 매체", family: "external_event", text: "호르무즈 해협 봉쇄로 에너지 가격이 상승했다." },
    { articleId: "b", outlet: "B 매체", family: "external_event", text: "미국과 이란이 해협 통제권을 두고 무력 대치했다." },
  ]);
  const dimension = comparisonSummary(bundle, issueView(2)).dimensions[0];
  assert.equal(dimension?.groups.length, 2);
  assert.ok(dimension?.groups.every((group) => group.title !== "외부 사건·상황"));
});

test("a representative group keeps its own article identity and evidence", () => {
  const bundle = makeBundle([
    { articleId: "a", outlet: "A 매체", family: "energy", text: "에너지 가격 상승을 핵심 문제로 설명했다." },
    { articleId: "b", outlet: "B 매체", family: "conflict", text: "통제권 다툼을 핵심 문제로 설명했다." },
  ]);
  const summary = comparisonSummary(bundle, issueView(2));
  assert.equal(summary.commonText, null);
  for (const group of summary.dimensions[0]?.groups ?? []) {
    assert.equal(group.details.length, 1);
    assert.equal(group.details[0]?.articleId, group.articleIds[0]);
    assert.equal(group.details[0]?.outlet, group.outlets[0]);
    assert.match(group.details[0]?.evidence.sentence_sha256 ?? "", /^[a-f0-9]{64}$/i);
  }
});

test("failed or conflicting analysis cannot produce a confirmed difference", () => {
  const bundle = makeBundle([
    { articleId: "a", outlet: "A 매체", family: "energy", text: "에너지 가격 상승을 핵심 문제로 설명했다." },
    { articleId: "b", outlet: "B 매체", family: "conflict", text: "통제권 다툼과 군사 대치를 핵심 문제로 설명했다." },
  ]);
  const before = comparisonSummary(bundle, issueView(2));
  assert.equal(before.status, "difference_confirmed");

  const conflicting = structuredClone(bundle) as IssueAnalysisBundle;
  (conflicting.semanticProfiles[1].profile as { review?: { analysis_state?: string } }).review = { analysis_state: "conflicting" };
  assert.notEqual(comparisonSummary(conflicting, issueView(2)).status, "difference_confirmed");

  const failed = structuredClone(bundle) as IssueAnalysisBundle;
  failed.analysisStatus.semantic.status = "analysis_failed" as never;
  assert.notEqual(comparisonSummary(failed, issueView(2)).status, "difference_confirmed");
});

test("source-only disagreement remains held for analysis", () => {
  const bundle = makeBundle([
    { articleId: "a", outlet: "A 매체", family: "energy", text: "취재원은 에너지 가격을 원인으로 들었다.", voice: "direct_quote" },
    { articleId: "b", outlet: "B 매체", family: "conflict", text: "취재원은 통제권 다툼을 원인으로 들었다.", voice: "indirect_source" },
  ]);
  const summary = comparisonSummary(bundle, issueView(2));
  assert.equal(summary.status, "held_for_analysis");
  assert.equal(summary.groups.length, 0);
  assert.equal(summary.sourceGroups.length, 2);
});

test("invalid evidence is excluded from comparison groups", () => {
  const bundle = makeBundle([
    { articleId: "a", outlet: "A 매체", family: "energy", text: "에너지 가격 상승을 핵심 문제로 설명했다." },
    { articleId: "b", outlet: "B 매체", family: "conflict", text: "통제권 다툼을 핵심 문제로 설명했다.", validEvidence: false },
  ]);
  const summary = comparisonSummary(bundle, issueView(2));
  assert.notEqual(summary.status, "difference_confirmed");
});

test("same-outlet article variation is not promoted to a media difference", () => {
  const bundle = makeBundle([
    { articleId: "a1", outlet: "A 매체", family: "energy", text: "에너지 가격 상승을 핵심 문제로 설명했다." },
    { articleId: "a2", outlet: "A 매체", family: "conflict", text: "통제권 다툼을 핵심 문제로 설명했다." },
  ]);
  const dimension = comparisonSummary(bundle, issueView(2)).dimensions[0];
  assert.equal(dimension?.groups.length, 2);
  assert.notEqual(dimension?.status, "difference_confirmed");
});

test("multiple claims in one article retain separate evidence", () => {
  const bundle = makeBundle([{
    articleId: "a",
    outlet: "A 매체",
    items: [
      { text: "에너지 가격 상승을 핵심 문제로 설명했다.", family: "external_event" },
      { text: "통제권 다툼과 무력 대치를 함께 설명했다.", family: "external_event" },
    ],
  }]);
  const dimension = comparisonSummary(bundle, issueView(1)).dimensions[0];
  const observations = dimension?.groups.flatMap((group) => group.observations) ?? [];
  assert.equal(observations.length, 2);
  assert.equal(new Set(observations.map((row) => row.evidence.sentence_sha256)).size, 2);
});

test("empty and partially analyzable snapshots stay explicit", () => {
  const empty = makeBundle([
    { articleId: "a", outlet: "A 매체", family: "external_event", text: "" },
    { articleId: "b", outlet: "B 매체", family: "external_event", text: "" },
  ]);
  const emptyDimension = comparisonSummary(empty, issueView(2)).dimensions[0];
  assert.equal(emptyDimension?.groups.length, 0);
  assert.equal(emptyDimension?.status, "held_for_analysis");

  const partial = makeBundle([
    { articleId: "a", outlet: "A 매체", family: "energy", text: "에너지 가격 상승을 핵심 문제로 설명했다." },
    { articleId: "b", outlet: "B 매체", family: "conflict", text: "통제권 다툼을 핵심 문제로 설명했다.", validEvidence: false },
    { articleId: "c", outlet: "A 매체", family: "conflict", text: "통제권 다툼을 핵심 문제로 설명했다." },
  ]);
  const partialDimension = comparisonSummary(partial, issueView(3)).dimensions[0];
  assert.equal(partialDimension?.groups.length, 2);
  assert.notEqual(partialDimension?.status, "difference_confirmed");
});

test("the other initial-five issues also return bounded comparison states", () => {
  for (const rank of [2, 3, 5]) {
    const id = `live-2026-08-15-top-${rank}`;
    const bundle = JSON.parse(readFileSync(`public/initial-five/issues/${id}.json`, "utf8")) as IssueAnalysisBundle;
    const summary = comparisonSummary(bundle, deriveIssue(bundle));
    assert.ok(["difference_confirmed", "no_clear_difference", "held_for_analysis"].includes(summary.status));
    assert.ok(summary.groups.every((group) => !["외부 사건·상황", "정치적 이해", "기타"].includes(group.title)));
  }
});
