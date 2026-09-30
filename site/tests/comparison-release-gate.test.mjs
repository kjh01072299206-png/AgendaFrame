import assert from "node:assert/strict";
import { test } from "node:test";
import { comparisonReleaseFailures } from "../scripts/comparison-release-gate.mjs";

const rows = (status, publishable = true) => Array.from({ length: 5 }, (_, i) => ({ route: `/issues/${i}/outlets`, status, publishable }));

test("a correctly rendered all-held snapshot is not release-ready", () => {
  assert.ok(comparisonReleaseFailures(rows("held_for_analysis")).some((message) => message.includes("모든 비교")));
});
test("legacy unbound synthesis cannot pass the release gate", () => {
  assert.equal(comparisonReleaseFailures(rows("difference_confirmed", false)).length, 6);
});
test("verified shared cores do not require an invented difference", () => {
  assert.deepEqual(comparisonReleaseFailures(rows("no_clear_difference")), []);
});
test("an individual evidence shortage is allowed beside completed real comparisons", () => {
  const mixed = rows("difference_confirmed");
  mixed[0].status = "held_for_analysis";
  assert.deepEqual(comparisonReleaseFailures(mixed), []);
  mixed[0].status = "analysis_failed";
  assert.equal(comparisonReleaseFailures(mixed).length, 1);
});
test("missing and duplicate issue coverage cannot pass", () => {
  assert.ok(comparisonReleaseFailures(rows("difference_confirmed").slice(1)).length);
  const duplicate = rows("difference_confirmed");
  duplicate[1].route = duplicate[0].route;
  assert.ok(comparisonReleaseFailures(duplicate).length);
});
