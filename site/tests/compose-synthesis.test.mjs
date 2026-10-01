import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { composeEventSynthesis, withEventSynthesis } from "../lib/initial-five/compose-synthesis.mjs";

const siteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("profile fallback does not manufacture camps from frame-family codes", async () => {
  const bundle = JSON.parse(
    await readFile(path.join(siteRoot, "public/initial-five/issues/bigkinds-2026-07-26-top-1.json"), "utf8"),
  );
  const synthesis = composeEventSynthesis(bundle);
  assert.equal(synthesis.usable, true);
  assert.equal(synthesis.opposition, false);
  assert.deepEqual(synthesis.camps, []);
  assert.equal(synthesis.comparison_result.status, "held_for_analysis");
  assert.match(synthesis.comparison_result.reason, /fallback|비교/);
  assert.equal(synthesis.split_line.status, "explicit_not_stated");
  const encoded = JSON.stringify(synthesis);
  assert.doesNotMatch(encoded, /진보|보수|raw_body|body_text/);
});

test("rank-4 does not invent an opposition", async () => {
  const bundle = JSON.parse(
    await readFile(path.join(siteRoot, "public/initial-five/issues/bigkinds-2026-07-26-top-4.json"), "utf8"),
  );
  const synthesis = composeEventSynthesis(bundle);
  assert.equal(synthesis.usable, true);
  assert.equal(synthesis.opposition, false);
  assert.deepEqual(synthesis.camps, []);
  assert.equal(synthesis.split_line.status, "explicit_not_stated");
  assert.doesNotMatch(synthesis.agreed_line?.text ?? "", /대통령·여당/);
});

test("withEventSynthesis attaches comparison fields without mutating the source bundle", async () => {
  const bundle = JSON.parse(
    await readFile(path.join(siteRoot, "public/initial-five/issues/bigkinds-2026-07-26-top-1.json"), "utf8"),
  );
  assert.equal(bundle.comparison.data.synthesis, undefined);
  const attached = withEventSynthesis(bundle);
  assert.equal(bundle.comparison.data.synthesis, undefined);
  assert.equal(attached.comparison.data.synthesis.usable, true);
  assert.ok(attached.comparison.data.source_lens.by_outlet.length >= 5);
  assert.deepEqual(attached.comparison.data.camps, []);
  assert.equal(attached.comparison.data.comparison_result.status, "held_for_analysis");
  assert.equal(attached.comparison.data.summary_30_seconds.divergence_detected, false);
  assert.doesNotMatch(attached.comparison.data.summary_30_seconds.common_ground, /집계합니다/);
});
