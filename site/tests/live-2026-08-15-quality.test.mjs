import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { inspectPublicTitle } from "../lib/article-title.mjs";
import { isVerifiedSemanticBundle } from "../lib/analysis-verification.mjs";
import { analyzeArticles } from "../worker/analysis.mjs";
import { withEventSynthesis } from "../lib/initial-five/compose-synthesis.mjs";

const siteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function article(id, title) {
  return {
    id,
    title,
    url: `https://example.test/${id}`,
    sourceId: id.startsWith("a") ? "khan" : "chosun",
    mediaGroupId: `${id}-g`,
    publishedAt: "2026-08-15T00:00:00+09:00",
    section: "정치",
    bodyText: "",
  };
}

const FORBIDDEN_PUBLIC_KEYS = new Set([
  "body_text",
  "bodytext",
  "raw_body",
  "rawbody",
  "html",
  "sentence_text",
  "sentencetext",
  "full_article",
  "fullarticle",
  "article_content",
  "articlecontent",
  "articlebody",
  "content",
  "full_content",
  "fullcontent",
  "prompt_payload",
  "promptpayload",
  "evidence_text",
  "evidencetext",
]);

function containsForbiddenPublicKey(value) {
  if (Array.isArray(value)) return value.some(containsForbiddenPublicKey);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, child]) => FORBIDDEN_PUBLIC_KEYS.has(key.toLowerCase()) || containsForbiddenPublicKey(child));
}

test("body-like titles are not public headlines", () => {
  const longBody = `${"정부는 오늘 발표했다. ".repeat(12)}추가 설명이 이어진다`;
  const inspected = inspectPublicTitle(longBody);
  assert.equal(inspected.ok, false);
  assert.equal(inspected.status, "titleUnavailable");
  assert.equal(inspectPublicTitle("이 대통령 광복절 경축사 대북 대화 제안").ok, true);
});

test("live 2026-08-15 ids never resolve to 2026-07-26 proto issues", async () => {
  const source = await readFile(path.join(siteRoot, "lib/proto/index.ts"), "utf8");
  assert.match(source, /bigkinds-2026-07-26-top-/);
  assert.doesNotMatch(source, /const rank = Number\(\/-top-\(\\d\+\)\$/);
  const chrome = await readFile(path.join(siteRoot, "app/(shell)/shell-chrome.tsx"), "utf8");
  assert.doesNotMatch(chrome, /fetchLiveIssueList/);
});

test("hard-negative events stay in separate clusters", () => {
  const issues = analyzeArticles([
    article("a1", "이 대통령 광복절 경축사에서 대북 전쟁 종식 논의 제안"),
    article("b1", "이 대통령 광복절 산책하며 K-컬처 세계화 강조"),
    article("a2", "이진숙 방통위원장 탄핵 심판 변론 시작"),
    article("b2", "이진숙 의원 5·18 토론회에서 발언"),
    article("a3", "광복절 특별사면 복권 명단 논란"),
    article("b3", "조국혁신당 당내 선거 경선 일정 발표"),
    article("a4", "친일 반민족 행위자 부당 재산 환수 추진"),
    article("b4", "독립유공자 후손 성금 기부 이어져"),
    article("a5", "이 대통령 광복절 경축사 대북 상호 위협 중단"),
    article("c5", "여당 이 대통령 광복절 경축사 전쟁 종식 논의 환영"),
  ], { configuredSourceCount: 12, configuredSourceGroupCount: 12, maxIssues: 20 });

  const titles = issues.map((issue) => issue.articles.map((row) => row.title).join(" | "));
  assert.equal(titles.some((text) => text.includes("경축사") && text.includes("산책")), false);
  assert.equal(titles.some((text) => text.includes("방통위원장") && text.includes("토론회")), false);
  assert.equal(titles.some((text) => text.includes("특별사면") && text.includes("당내 선거")), false);
  assert.equal(titles.some((text) => text.includes("재산 환수") && text.includes("성금")), false);
  const speech = issues.find((issue) => issue.articles.some((row) => row.title.includes("경축사")));
  assert.ok(speech);
  assert.ok(speech.agendaScore > 0);
});

test("shuffled input yields the same speech cluster members", () => {
  const rows = [
    article("a1", "이 대통령 광복절 경축사에서 대북 전쟁 종식 논의 제안"),
    article("c5", "여당 이 대통령 광복절 경축사 전쟁 종식 논의 환영"),
    article("d5", "야당 이 대통령 광복절 경축사 대북 상호 위협 중단 비판"),
  ];
  const forward = analyzeArticles(rows, { configuredSourceCount: 12, maxIssues: 10 });
  const reverse = analyzeArticles([...rows].reverse(), { configuredSourceCount: 12, maxIssues: 10 });
  const members = (issues) => (issues[0]?.articles ?? []).map((row) => row.id).sort();
  assert.deepEqual(members(forward), members(reverse));
});

test("verified direct event synthesis remains visible when clustering is rules-local", async () => {
  const bundle = JSON.parse(
    await readFile(path.join(siteRoot, "public/initial-five/issues/live-2026-08-15-top-1.json"), "utf8"),
  );
  assert.equal(isVerifiedSemanticBundle(bundle), false);
  const attached = withEventSynthesis(bundle);
  assert.equal(attached.comparison.data.synthesis.usable, true);
  assert.equal(attached.comparison.data.synthesis.source, "gcp:event-synthesis");
  assert.equal(attached.analysisStatus.semantic.semanticAi, true);
});

test("published 2026-08-15 synthesis is Vertex-backed, evidence-bound, and body-free", async () => {
  const manifest = JSON.parse(
    await readFile(path.join(siteRoot, "public/initial-five/manifest.json"), "utf8"),
  );
  assert.equal(manifest.basisDate, "2026-08-15");
  assert.equal(manifest.issueCount, 5);
  assert.equal(manifest.articleCount, 40);
  assert.equal(manifest.analysisModel, "gemini-2.5-pro");
  assert.match(String(manifest.analysisRunId), /^[0-9a-f]{32}$/);

  for (const rank of [1, 2, 3, 4, 5]) {
    const bundle = JSON.parse(
      await readFile(
        path.join(siteRoot, `public/initial-five/issues/live-2026-08-15-top-${rank}.json`),
        "utf8",
      ),
    );
    const synthesis = bundle.comparison?.data?.synthesis;
    const engine = bundle.comparison?.engine;
    const semantic = bundle.analysisStatus?.semantic;
    assert.equal(bundle.lineage?.runId, manifest.analysisRunId);
    assert.equal(engine?.source, "gcp:event-synthesis");
    assert.equal(engine?.semanticAi, true);
    assert.equal(engine?.model, "gemini-2.5-pro");
    assert.equal(semantic?.semanticAi, true);
    assert.equal(synthesis?.schemaVersion, "agendaframe.event-synthesis.v2");
    assert.equal(synthesis?.usable, true);
    assert.equal(synthesis?.source, "gcp:event-synthesis");
    assert.equal(synthesis?.run_id, manifest.analysisRunId);
    assert.equal(synthesis?.invocation?.provider, "vertex_ai");
    assert.match(String(synthesis?.invocation?.request_sha256), /^[0-9a-f]{64}$/);
    assert.match(String(synthesis?.invocation?.response_sha256), /^[0-9a-f]{64}$/);

    assert.ok(Array.isArray(synthesis.event_paragraphs));
    assert.ok(synthesis.event_paragraphs.length >= 2 && synthesis.event_paragraphs.length <= 4);
    for (const paragraph of synthesis.event_paragraphs) {
      assert.equal(paragraph.status, "observed");
      assert.ok(paragraph.text);
      assert.ok(Array.isArray(paragraph.evidence) && paragraph.evidence.length > 0);
    }
    assert.equal(synthesis.common_ground?.status, "observed");
    assert.ok(synthesis.common_ground?.text);
    assert.ok(Array.isArray(synthesis.common_ground?.evidence) && synthesis.common_ground.evidence.length > 0);
    assert.ok(Array.isArray(synthesis.terms));
    assert.ok(Array.isArray(synthesis.proof_rows));
    assert.ok(Array.isArray(synthesis.camps));
    if (synthesis.camps.length >= 2) {
      assert.equal(synthesis.opposition, true);
      assert.ok(synthesis.comparison_axis?.label);
      assert.ok(synthesis.comparison_axis?.question);
      assert.ok(Array.isArray(synthesis.comparison_axis?.evidence) && synthesis.comparison_axis.evidence.length > 0);
    } else {
      assert.equal(synthesis.opposition, false);
    }
    assert.equal(containsForbiddenPublicKey(bundle), false);
  }
});

test("unverified 2026-08-15 bundles without a direct synthesis stay hidden", async () => {
  const bundle = JSON.parse(
    await readFile(path.join(siteRoot, "public/initial-five/issues/live-2026-08-15-top-1.json"), "utf8"),
  );
  delete bundle.comparison.data.synthesis;
  const attached = withEventSynthesis(bundle);
  assert.equal(attached.comparison.data.synthesis.usable, false);
  const encoded = JSON.stringify(attached);
  assert.doesNotMatch(encoded, /대통령의 침묵과 정치적 책임/);
  assert.doesNotMatch(encoded, /제도적 안전장치 약화/);
});

test("current synthesis projections do not end with a truncated inline citation", async () => {
  for (const rank of [1, 2, 3, 4, 5]) {
    const bundle = JSON.parse(
      await readFile(
        path.join(siteRoot, `public/initial-five/issues/live-2026-08-15-top-${rank}.json`),
        "utf8",
      ),
    );
    const data = bundle.comparison?.data ?? {};
    const texts = [
      data.synthesis?.split_line?.text,
      data.summary_30_seconds?.main_difference,
      data.splitLine,
    ].filter((value) => typeof value === "string");
    for (const value of texts) {
      assert.ok(
        value.split("(").length - 1 <= value.split(")").length - 1,
        `rank ${rank} exposes an incomplete inline citation`,
      );
    }
  }
});

test("title-derived hashes are not treated as verified evidence", () => {
  const digest = createHash("sha256").update("임의 제목-1").digest("hex");
  assert.match(digest, /^[0-9a-f]{64}$/);
  assert.equal(isVerifiedSemanticBundle({
    basisDate: "2026-08-15",
    lineage: { runId: "x" },
    analysisStatus: { semantic: { model: "gemini", promptVersion: "1", source: "live-crawl-2026-08-15", status: "succeeded" } },
    semanticProfiles: [{ evidence: [{ sentenceSha256: digest }] }],
  }), false);
});
