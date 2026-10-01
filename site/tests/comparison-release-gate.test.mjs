import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { comparisonReleaseFailures } from "../scripts/comparison-release-gate.mjs";

const rows = (status, publishable = true) => Array.from({ length: 5 }, (_, i) => ({ route: `/issues/${i}/outlets`, status, publishable }));

test("the production verifier passes jq IN one comma-separated stream, not four arguments", () => {
  const workflow = readFileSync(new URL("../../.github/workflows/site-gate.yml", import.meta.url), "utf8");
  const match = workflow.match(/\| IN\(([^)]+)\)/);
  assert.ok(match, "the production comparison status must be checked");
  assert.equal(match[1].includes(";"), false, "jq IN accepts a single stream argument");
  assert.deepEqual(JSON.parse(`[${match[1]}]`), [
    "difference_confirmed", "no_clear_difference", "held_for_analysis", "analysis_failed",
  ]);
});

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
