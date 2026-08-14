import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { composeEventSynthesis, withEventSynthesis } from "../lib/initial-five/compose-synthesis.mjs";

const siteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("rank-1 profiles compose the three target camps without ideology labels", async () => {
  const bundle = JSON.parse(
    await readFile(path.join(siteRoot, "public/initial-five/issues/bigkinds-2026-07-26-top-1.json"), "utf8"),
  );
  const synthesis = composeEventSynthesis(bundle);
  assert.equal(synthesis.usable, true);
  assert.equal(synthesis.opposition, true);
  assert.equal(synthesis.camps.length, 3);
  const names = synthesis.camps.map((camp) => camp.name).join(" ");
  assert.match(names, /거부권|침묵/);
  assert.match(names, /제도/);
  assert.match(names, /경고/);
  assert.equal(synthesis.agreed_line.status, "observed");
  assert.match(synthesis.agreed_line.text, /책임/);
  for (const camp of synthesis.camps) {
    assert.ok(camp.evidence.length > 0);
    assert.match(camp.evidence[0].sentence_sha256, /^[0-9a-f]{64}$/);
  }
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
  assert.equal(attached.comparison.data.summary_30_seconds.divergence_detected, true);
  assert.doesNotMatch(attached.comparison.data.summary_30_seconds.common_ground, /집계합니다/);
});
