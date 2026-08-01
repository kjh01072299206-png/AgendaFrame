import assert from "node:assert/strict";
import test from "node:test";

import { answerFromEvidence, normalizeChatQuestion } from "../worker/evidence-chat.mjs";

const comparison = {
  summary: { commonGround: "정부가 개정안을 국회에 제출했다.", mainDifference: "일부 매체는 기업 부담 완화를, 다른 매체는 노동자 안전을 중심에 둔다." },
  axes: [{ label: "문제 정의", variants: [{ summary: "기업 부담 완화", outlets: [{ claimId: "claim-1", articleId: "a-1", source: "조선일보", sourceUrl: "https://example.com/a" }] }] }],
};

test("answers only from a matching evidence-backed comparison", () => {
  const result = answerFromEvidence("매체들이 어떤 차이를 보였나요?", comparison);
  assert.equal(result.status, "answered");
  assert.equal(result.evidence[0].claimId, "claim-1");
});

test("withholds unsupported questions", () => {
  const result = answerFromEvidence("기사 기자의 개인적 의도는 무엇인가요?", comparison);
  assert.equal(result.status, "withheld");
  assert.equal(result.evidence.length, 0);
});

test("normalizes and bounds questions", () => {
  assert.equal(normalizeChatQuestion("  공통   내용은? "), "공통 내용은?");
  assert.equal(normalizeChatQuestion("x".repeat(600)).length, 500);
});
