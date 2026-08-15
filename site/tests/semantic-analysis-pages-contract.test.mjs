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
  assert.match(source, /sentence_sha256/);
  assert.match(source, /isAttributed\(|direct_quote|indirect_source/);
  assert.match(source, /explicit_not_stated/);
  assert.match(source, /insufficient_evidence/);
  assert.match(source, /analysis_failed/);
  assert.match(source, /conflicting/);
  assert.match(source, /profile\?\.review/);
  assert.match(source, /사건 30초 요약/);
  assert.match(source, /공통으로 본 것과 갈린 지점/);
  assert.match(source, /프레이밍의 여섯 관측축/);
  assert.match(source, /프레임 4기능 비교/);
  assert.match(source, /취재원 역할과 전달 방식/);
  assert.match(source, /비교 원장: 축별 기사 근거/);
  assert.match(source, /사건 종합 비교/);
  assert.match(source, /export function SynthesisNarrative/);
  assert.match(source, /서로 다른 근거 그룹이 없어 대립 구도로 표시하지 않습니다/);
  assert.match(source, /synthesis\?\.usable/);
  assert.match(source, /구조화 보조 관측/);
  assert.match(source, /rules_local.*semantic AI와 별도/);
  assert.match(source, /validComparisonEvidence/);
  assert.match(source, /comparison_axes/);
});

test("semantic pages do not publish raw article text fields or political ideology labels", async () => {
  const source = await readFile(pagePath, "utf8");
  assert.doesNotMatch(source, /\braw_body\b|\bbodyText\b|\bsentenceText\b|\bfull_article\b/i);
  assert.doesNotMatch(source, /이 언론사는 진보|이 언론사는 보수/);
  assert.match(source, /원문 링크 열기/);
});

test("semantic pages distinguish explicit_not_stated from insufficient_evidence and analysis_failed", async () => {
  const source = await readFile(pagePath, "utf8");
  assert.match(source, /explicit_not_stated.*명시적으로/s);
  assert.match(source, /insufficient_evidence.*근거/s);
  assert.match(source, /analysis_failed.*분석 실패/s);
  assert.match(source, /review_needed.*사람 검토/s);
});

test("semantic pages include framing navigation rail and methodology disclaimer", async () => {
  const source = await readFile(pagePath, "utf8");
  assert.match(source, /FramingRail/);
  assert.match(source, /MethodologyDisclaimer/);
  assert.match(source, /#sec-synthesis/);
  assert.match(source, /#sec-four-functions/);
  assert.match(source, /#sec-matrix/);
  assert.match(source, /#sec-clusters/);
  assert.match(source, /#sec-descriptors/);
  assert.match(source, /#sec-scope/);
  assert.match(source, /#sec-evidence/);
  assert.match(source, /Entman.*1993/);
  assert.match(source, /Matthes.*Kohring/);
  assert.match(source, /Boydstun/);
  assert.match(source, /Iyengar/);
  assert.match(source, /Gans/);
});

test("issue layout and home page maintain active snapshot route consistency", async () => {
  const layoutPath = path.join(siteRoot, "app", "(shell)", "issues", "[issueId]", "layout.tsx");
  const homePath = path.join(siteRoot, "app", "(shell)", "page.tsx");
  const activeHomePath = path.join(siteRoot, "app", "(shell)", "active-home.tsx");

  const layoutSource = await readFile(layoutPath, "utf8");
  const homeSource = await readFile(homePath, "utf8");
  const activeHomeSource = await readFile(activeHomePath, "utf8");

  assert.match(layoutSource, /loadIssueBundle/);
  assert.match(layoutSource, /의제 정보를 찾을 수 없습니다/);
  assert.doesNotMatch(layoutSource, /generateStaticParams/);

  assert.match(homeSource, /ActiveSnapshotHome/);
  assert.match(homeSource, /getActiveSnapshot/);

  assert.match(activeHomeSource, /\/outlets/);
  assert.match(activeHomeSource, /\/framing/);
});

