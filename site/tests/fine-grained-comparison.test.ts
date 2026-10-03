import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FineComparisonSection } from "../app/(shell)/fine-comparison";
import { fineComparison, type FineComparison } from "../lib/initial-five/fine-grained-comparison";
import { comparisonSummary } from "../lib/initial-five/analysis-summary";
import { isPublishableEventSynthesis } from "../lib/initial-five/publication-contract";
import type { IssueAnalysisBundle } from "../lib/initial-five/types";
const stored = (rank = 2): IssueAnalysisBundle => JSON.parse(fs.readFileSync(new URL(`../public/initial-five/issues/live-2026-08-15-top-${rank}.json`, import.meta.url), "utf8"));
const observation = (bundle: IssueAnalysisBundle) => (bundle.comparison.data.fine_grained as FineComparison).observations[0];
test("actual saved title observations are independent editorial comparisons, not new AI calls", () => {
  for (const rank of [2, 5]) {
    const result = fineComparison(stored(rank));
    assert.equal(result.observations.length, 1);
    assert.equal(result.rejected.length, 0);
    assert.equal(result.producer, "editorial-title-review");
    assert.notEqual(result.observations[0].articles[0].description, result.observations[0].articles[1].description);
    assert.equal(result.observations[0].status, "expression_only");
  }
});
for (const failure of ["failed", "conflicting", "stale-prompt", "body-mismatch", "article-mismatch", "outlet-mismatch", "title-mismatch", "schema-mismatch"]) {
  test(`article integrity rejects ${failure}`, () => {
    const bundle = stored();
    const row = observation(bundle).articles[0];
    const entry = bundle.semanticProfiles.find((item) => item.articleId === row.article_id)!;
    if (["failed", "conflicting"].includes(failure)) entry.engine.status = failure as typeof entry.engine.status;
    if (failure === "stale-prompt") entry.engine.promptVersion = entry.profile!.engine!.prompt_version = "stale-prompt";
    if (failure === "body-mismatch") entry.engine.bodySha256 = "0".repeat(64);
    if (failure === "article-mismatch") entry.profile!.article!.article_id = "other";
    if (failure === "schema-mismatch") entry.engine.schemaVersion = "stale";
    if (failure === "outlet-mismatch") row.outlet = "뉴스1";
    if (failure === "title-mismatch") row.title_basis!.title += " 수정";
    assert.equal(fineComparison(bundle).observations.length, 0);
    assert.equal(fineComparison(bundle).rejected.length, 1);
  });
}
test("held issue preserves valid article/title observations", () => {
  const bundle = stored();
  bundle.analysisStatus.semantic.status = "review_needed";
  assert.equal(fineComparison(bundle).observations.length, 1);
});
test("rank-5 legacy outlet misattribution cannot confirm a difference", () => {
  const bundle = stored(5);
  const quarantined = (bundle.comparison.data.editorial_quarantine as { removed_points: unknown[] }).removed_points;
  assert.equal(isPublishableEventSynthesis(bundle), true);
  const result = bundle.comparison.data.synthesis!.comparison_result!;
  const dimension = result.dimensions![0];
  dimension.points = structuredClone(quarantined) as typeof dimension.points;
  dimension.status = "difference_confirmed";
  result.status = "difference_confirmed";
  assert.equal(isPublishableEventSynthesis(bundle), false);
  assert.notEqual(comparisonSummary(bundle).status, "difference_confirmed");
  assert.equal(fineComparison(bundle).observations.length, 1);
});
test("quote incorrectly marked as journalist narration and invalid evidence are rejected", () => {
  const bundle = stored();
  for (const row of observation(bundle).articles) {
    const entry = bundle.semanticProfiles.find((item) => item.articleId === row.article_id)!;
    const quote = Object.values(entry.profile!.dimensions!).flatMap((item) => item.items ?? []).find((item) => item.voice?.kind !== "journalist_narration");
    delete row.title_basis;
    row.voice = "journalist_narration";
    row.evidence = quote ? [{ ...quote.evidence, article_id: row.article_id }] : [{ article_id: row.article_id, locator: { paragraph: 999, sentence: 999 }, sentence_sha256: "0".repeat(64) }];
  }
  assert.equal(fineComparison(bundle).observations.length, 0);
});
test("duplicated article descriptions are invalid", () => {
  const bundle = stored();
  const rows = observation(bundle).articles;
  rows[1].description = rows[0].description;
  assert.equal(fineComparison(bundle).observations.length, 0);
});

test("server-rejected observations preserve Korean reasons without hiding valid siblings", () => {
  const bundle = stored();
  (bundle.comparison.data.fine_grained as FineComparison).rejected = [
    { headline: "취재원 관측", reason: "evidence_voice_mismatch" },
    { headline: "원문 관측", reason: "incomplete_body_cannot_support_absence" },
  ];
  const result = fineComparison(bundle);
  assert.equal(result.observations.length, 1);
  assert.equal(result.rejected.length, 2);
  assert.match(result.rejected[0].reason, /취재원.*기자/);
  assert.match(result.rejected[1].reason, /부재 판단 불가/);
  const markup = renderToStaticMarkup(createElement(FineComparisonSection, { bundle }));
  assert.ok(markup.includes(observation(bundle).articles[0].description));
  assert.ok(markup.includes(observation(bundle).articles[1].description));
  assert.match(markup, /취재원 발언과 기자 서술의 구분 불일치/);
  assert.doesNotMatch(markup, /evidence_voice_mismatch/);
});

test("stale server rejection receipts cannot be merged into the current run", () => {
  const bundle = stored();
  const raw = bundle.comparison.data.fine_grained as FineComparison;
  raw.run_id = "stale-run";
  raw.rejected = [{ headline: "오래된 관측", reason: "evidence_voice_mismatch" }];
  const result = fineComparison(bundle);
  assert.equal(result.observations.length, 0);
  assert.equal(result.rejected.length, 1);
  assert.match(result.rejected[0].reason, /실행 ID 불일치/);
});
for (const axis of ["certainty", "placement", "sources_countervoices", "additional_context", "evaluative_language"] as const) {
  test(`synthetic-only ${axis} contract retains detail without asserting frame opposition`, () => {
    const bundle = stored();
    const item = observation(bundle);
    item.axis = axis;
    for (const row of item.articles) {
      delete row.title_basis;
      row.voice = "journalist_narration";
      const entry = bundle.semanticProfiles.find((candidate) => candidate.articleId === row.article_id)!;
      const source = Object.values(entry.profile!.dimensions!).flatMap((dimension) => dimension.items ?? []).find((candidate) => candidate.voice?.kind === "journalist_narration")!;
      row.evidence = [{ ...source.evidence, article_id: row.article_id }];
    }
    assert.equal(fineComparison(bundle).observations[0].status, "expression_only");
    item.status = "not_observed";
    bundle.semanticProfiles.find((row) => row.articleId === item.articles[0].article_id)!.profile!.extraction!.input_truncated = true;
    assert.equal(fineComparison(bundle).observations.length, 0);
  });
}
