import assert from "node:assert/strict";
import { test } from "node:test";
import { stripEvidenceTokens } from "../lib/initial-five/public-text.mjs";

test("keeps public synthesis prose readable while preserving normal parentheses", () => {
  assert.equal(
    stripEvidenceTokens("사실이다(96f04d1c2f26918ca77bc89262e5019a, 1, 2). 다음."),
    "사실이다. 다음.",
  );
  assert.equal(
    stripEvidenceTokens("전망이다(fcc0a2e9a6b9c8d7e6f50123456789ab, 1, 9; 0987654321abcdef0987654321abcdef, 1, 5)."),
    "전망이다.",
  );
  assert.equal(stripEvidenceTokens("비율(2, 3)은 유지한다."), "비율(2, 3)은 유지한다.");
});
