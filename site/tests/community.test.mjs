import assert from "node:assert/strict";
import test from "node:test";

import { validateCommentPayload, validateReportPayload } from "../worker/community.mjs";

test("community payloads enforce short plain-text inputs", () => {
  assert.equal(validateCommentPayload({ body: "근거를 확인했습니다.", displayName: "독자" }).ok, true);
  assert.equal(validateCommentPayload({ body: "" }).ok, false);
  assert.equal(validateCommentPayload({ body: "x".repeat(1001) }).ok, false);
  assert.equal(validateReportPayload({ reason: "스팸" }).ok, true);
});

test("community report defaults to a reviewable reason", () => {
  const result = validateReportPayload({});
  assert.equal(result.ok, true);
  assert.match(result.value.reason, /부적절/);
});
