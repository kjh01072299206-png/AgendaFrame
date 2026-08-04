import assert from "node:assert/strict";
import test from "node:test";

import { calculateReaderType, validateCommentPayload, validateReportPayload, validateSelfCheckPayload } from "../worker/community.mjs";

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

test("self-check validation and scoring are deterministic on the server", () => {
  const answers = Array(12).fill("a");
  assert.equal(validateSelfCheckPayload({ answers }).ok, true);
  assert.equal(validateSelfCheckPayload({ answers: answers.slice(0, 11) }).ok, false);
  assert.deepEqual(calculateReaderType(answers), {
    code: "HMOR",
    scores: {
      focus: { a: 3, b: 0 },
      voice: { a: 3, b: 0 },
      range: { a: 3, b: 0 },
      aim: { a: 3, b: 0 },
    },
  });
});
