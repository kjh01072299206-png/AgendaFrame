import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const siteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pagePath = path.join(siteRoot, "app", "(shell)", "semantic-analysis-pages.tsx");

test("semantic pages enforce public evidence and state boundaries", async () => {
  const source = await readFile(pagePath, "utf8");
  assert.match(source, /function hasValidEvidence\(/);
  assert.match(source, /validEvidence && text/);
  assert.match(source, /sentence_sha256/);
  assert.match(source, /direct_quote.*indirect_source/s);
  assert.match(source, /explicit_not_stated/);
  assert.match(source, /insufficient_evidence/);
  assert.match(source, /analysis_failed/);
  assert.match(source, /conflicting/);
  assert.match(source, /requiresHumanReview/);
  assert.match(source, /profile\?\.review/);
  assert.match(source, /사건 30초 요약/);
  assert.match(source, /공통으로 본 것과 갈린 지점/);
  assert.match(source, /프레이밍의 여섯 관측축/);
  assert.match(source, /프레임 4기능 비교/);
  assert.match(source, /취재원 역할과 전달 방식/);
  assert.match(source, /시야 판단 근거/);
  assert.match(source, /장치 근거/);
  assert.match(source, /비교 원장: 축별 기사 근거/);
  assert.match(source, /구조화 보조 관측/);
  assert.match(source, /rules_local.*semantic AI와 별도/);
  assert.match(source, /validComparisonEvidence/);
  assert.match(source, /comparison_axes/);
  assert.doesNotMatch(source, /표현·책임 배치의 차이/);
});

test("semantic pages do not publish raw article text fields", async () => {
  const source = await readFile(pagePath, "utf8");
  assert.doesNotMatch(source, /\braw_body\b|\bbodyText\b|\bsentenceText\b|\bfull_article\b/i);
  assert.match(source, /원문 링크 열기/);
});
