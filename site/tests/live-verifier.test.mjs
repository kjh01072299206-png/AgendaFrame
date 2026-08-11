import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const verifier = readFileSync(new URL("../scripts/verify-discovery-endpoints.mjs", import.meta.url), "utf8");

test("keeps publisher endpoint verification behind the explicit live-test flag", () => {
  assert.match(packageJson.scripts["collection:verify"], /verify-discovery-endpoints\.mjs/);
  assert.match(verifier, /AGENDAFRAME_LIVE_TESTS/);
  assert.match(verifier, /process\.exit\(2\)/);
  assert.match(verifier, /SOURCE_STOPPED/);
  assert.match(verifier, /robots\.txt/);
  assert.doesNotMatch(verifier, /console\.log\([^\n]*(?:document|bodyText|title)/);
});
