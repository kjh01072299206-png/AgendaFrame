import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  INITIAL_FIVE_SCHEMA_VERSION,
  RULE_ENGINE_LABEL,
  buildInitialFive,
  buildInitialFiveManifest,
  collectPublicEvidence,
  isSemanticProfileSuccess,
  readInitialFiveSourcesSync,
} from "../lib/initial-five/index.mjs";
import { handleInitialFiveRequest } from "../worker/initial-five-api.mjs";

const siteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const forbiddenKey = /raw[_-]?body|body[_-]?text|sentence[_-]?text|html|full[_-]?article|article[_-]?content|full[_-]?content/i;

function walkKeys(value, pathName = "$", output = []) {
  if (!value || typeof value !== "object") return output;
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkKeys(item, `${pathName}[${index}]`, output));
    return output;
  }
  for (const [key, child] of Object.entries(value)) {
    if (forbiddenKey.test(key)) output.push(`${pathName}.${key}`);
    walkKeys(child, `${pathName}.${key}`, output);
  }
  return output;
}

function allEvidence(value) {
  return collectPublicEvidence(value);
}

test("builds a thin deterministic manifest for exactly the initial five", () => {
  const first = buildInitialFive({ siteRoot });
  const second = buildInitialFive({ siteRoot });
  assert.deepEqual(first.manifest, second.manifest);
  assert.equal(first.manifest.schemaVersion, INITIAL_FIVE_SCHEMA_VERSION);
  assert.equal(first.manifest.basisDate, "2026-07-26");
  assert.equal(first.manifest.issueCount, 5);
  assert.equal(first.manifest.articleCount, 25);
  assert.deepEqual(first.manifest.issues.map((issue) => issue.rank), [1, 2, 3, 4, 5]);
  assert.deepEqual(
    first.manifest.issues.map((issue) => issue.title),
    [
      "정점식 의원의 특검 보완수사권 주장",
      "권영진 의원의 정점식 의원 멱살 논란",
      "경산 아파트 방화·보복범죄 수사",
      "권경애 재판 불출석 손해배상 조정",
      "음성 외국인 집단 난투 사건",
    ],
  );
  assert.ok(!Object.hasOwn(first.manifest, "profiles"));
  assert.ok(!Object.hasOwn(first.manifest, "articles"));
  assert.ok(first.manifest.issues.every((issue) => issue.payloadKey.startsWith("issues/")));
  assert.deepEqual(walkKeys(first.manifest), []);
});

test("keeps cluster AI metadata and separates rule and semantic engines", () => {
  const reader = buildInitialFive({ siteRoot });
  for (const issue of reader.manifest.issues) {
    assert.equal(issue.clusterAi.engineLabel, "ai_semantic");
    assert.equal(issue.clusterAi.model, "gemini-2.5-flash-lite");
    assert.equal(issue.clusterAi.promptVersion, "2.0.0");
    assert.equal(issue.clusterAi.schemaVersion, 1);
    assert.equal(issue.semantic.engineLabel, "ai_semantic");
  }
  const rankOne = reader.getIssueByRank(1);
  assert.ok(rankOne);
  assert.equal(rankOne.comparison.engine.label, RULE_ENGINE_LABEL);
  assert.equal(rankOne.comparison.engine.semanticAi, false);
  assert.ok(rankOne.ruleProfiles.every((entry) => entry.engine.label === RULE_ENGINE_LABEL));
  assert.ok(rankOne.ruleProfiles.every((entry) => entry.engine.semanticAi === false));
});

test("loads one issue payload with article metadata, lineage, statuses, and evidence locators", () => {
  const reader = buildInitialFive({ siteRoot });
  const rankOne = reader.getIssueByRank(1);
  assert.equal(rankOne.issue.articleCount, 7);
  assert.equal(rankOne.articles.length, 7);
  assert.ok(rankOne.articles.every((article) => article.articleId && article.outlet && article.publishedAt && article.canonicalUrl));
  assert.ok(rankOne.lineage.source.semanticDirectory.includes("semantic-rank1"));
  assert.equal(rankOne.semanticProfiles.length, 7);
  assert.ok(rankOne.semanticProfiles.every((entry) => entry.status === "succeeded"));
  assert.ok(rankOne.semanticProfiles.every((entry) => entry.engine.model === "claude-sonnet-5x2-opus-5-adjudicated"));
  assert.ok(rankOne.semanticProfiles.every((entry) => entry.engine.promptVersion === "claude-framing-v1.0.0"));
  assert.ok(rankOne.semanticProfiles.every((entry) => entry.engine.schemaVersion === "agendaframe.article-frame-profile.v2"));
  const evidence = allEvidence(rankOne);
  assert.ok(evidence.length > 0);
  assert.ok(evidence.every((entry) => entry.locator || entry.sentenceSha256));
  assert.ok(evidence.every((entry) => !Object.hasOwn(entry, "quote") && !Object.hasOwn(entry, "text")));
});

test("publishes all 25 semantic profiles only after AI success and evidence validation", () => {
  const reader = buildInitialFive({ siteRoot });
  for (const rank of [1, 2, 3, 4, 5]) {
    const bundle = reader.getIssueByRank(rank);
    assert.equal(bundle.status, "succeeded");
    assert.equal(bundle.analysisStatus.semantic.status, "succeeded");
    assert.equal(bundle.analysisStatus.semantic.succeededArticleCount, bundle.issue.articleCount);
    assert.equal(bundle.analysisStatus.semantic.reviewNeededArticleCount, 0);
    assert.equal(bundle.analysisStatus.semantic.engineLabel, "ai_semantic");
    assert.ok(bundle.semanticProfiles.every((entry) => entry.status === "succeeded"));
    assert.ok(bundle.semanticProfiles.every((entry) => entry.engine.label !== RULE_ENGINE_LABEL));
    assert.ok(bundle.semanticProfiles.every((entry) => entry.profile !== null));
    assert.ok(bundle.semanticProfiles.every((entry) => entry.evidence.length > 0));
    assert.ok(bundle.ruleProfiles.every((entry) => entry.engine.label === RULE_ENGINE_LABEL));
  }
});

test("semantic success requires AI analyze decision, no fallback, and evidence", () => {
  const base = {
    article: { body_sha256: "body-hash" },
    engine: { semantic_ai: true, version: "gemini-2.5-flash-lite" },
    review: { analysis_decision: "analyze", fallback_reason: null },
    dimensions: {
      problem_definition: {
        items: [{ evidence: { locator: { paragraph: 1, sentence: 1 }, sentence_sha256: "sentence-hash" } }],
      },
    },
  };
  assert.equal(isSemanticProfileSuccess({ profile: base }), true);
  assert.equal(
    isSemanticProfileSuccess({ profile: { ...base, dimensions: {} } }),
    false,
  );
  assert.equal(
    isSemanticProfileSuccess({ profile: { ...base, review: { ...base.review, fallback_reason: "invalid_json" } } }),
    false,
  );
  assert.equal(
    isSemanticProfileSuccess({ profile: { ...base, engine: { semantic_ai: false } } }),
    false,
  );
  assert.equal(
    isSemanticProfileSuccess({ profile: { ...base, review: { analysis_decision: "review_needed" } } }),
    false,
  );
});

test("public payload contains no raw article content or forbidden source fields", async () => {
  const reader = buildInitialFive({ siteRoot });
  for (const issue of reader.manifest.issues) {
    const bundle = reader.getIssue(issue.issueId);
    assert.deepEqual(walkKeys(bundle), [], JSON.stringify(walkKeys(bundle)));
    const serialized = JSON.stringify(bundle);
    assert.doesNotMatch(serialized, /raw_body|body_text|sentence_text|<html|<body/i);
    assert.doesNotMatch(serialized, /full article content/i);
  }
  const top5 = JSON.parse(await readFile(path.join(siteRoot, "data", "top5-2026-07-26.json"), "utf8"));
  assert.ok(top5.rawBodiesIncluded === false);
});

test("serves the manifest and one lazy issue bundle from the production worker", async () => {
  const manifestResponse = await handleInitialFiveRequest(new Request("https://example.test/api/initial-five"));
  assert.equal(manifestResponse.status, 200);
  const publicManifest = await manifestResponse.json();
  assert.equal(publicManifest.issueCount, 5);
  assert.ok(publicManifest.articleCount >= 25);

  const issueId = publicManifest.issues[1].issueId;
  const issueResponse = await handleInitialFiveRequest(
    new Request(`https://example.test/api/initial-five/issues/${encodeURIComponent(issueId)}`),
  );
  assert.equal(issueResponse.status, 200);
  const bundle = await issueResponse.json();
  assert.equal(bundle.issue.issueId, issueId);
  assert.equal(bundle.status, "succeeded");
  assert.deepEqual(walkKeys(bundle), []);
});

test("answers initial-five questions only from published Gemini evidence", async () => {
  const request = new Request("https://example.test/api/initial-five/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://example.test" },
    body: JSON.stringify({
      issueId: "live-2026-08-15-top-1",
      question: "기사에 등장한 취재원과 화자는 누구인가요?",
    }),
  });
  const response = await handleInitialFiveRequest(request);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const answer = await response.json();
  assert.equal(answer.status, "answered");
  assert.ok(["claude_analysis_grounded_retrieval_v1", "rules_initial_five_v1"].includes(answer.provider));
  assert.ok(answer.evidence.length > 0);
  assert.ok(answer.evidence.every((entry) => entry.sourceUrl && entry.evidenceHash));
  assert.deepEqual(walkKeys(answer), []);
});

test("routes the selected issue to an answer for every initial-five agenda", async () => {
  const manifestResponse = await handleInitialFiveRequest(new Request("https://example.test/api/initial-five"));
  const publicManifest = await manifestResponse.json();
  for (const issue of publicManifest.issues) {
    const response = await handleInitialFiveRequest(new Request("https://example.test/api/initial-five/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://example.test" },
      body: JSON.stringify({ issueId: issue.issueId, question: "이 의제의 핵심 쟁점은 무엇인가요?" }),
    }));
    assert.equal(response.status, 200, `rank ${issue.rank} must be answerable`);
    const answer = await response.json();
    assert.equal(answer.issueId, issue.issueId);
    assert.equal(answer.status, "answered");
    assert.ok(["claude_analysis_grounded_retrieval_v1", "rules_initial_five_v1"].includes(answer.provider));
    assert.match(answer.answer, /규칙 기반|핵심|문제|쟁점|요약/);
  }
});

test("publishes coder agreement for every article and recomputes it per issue", () => {
  const { manifest, getIssueByRank } = buildInitialFive({ siteRoot });
  const published = manifest.coderAgreement;
  assert.ok(published, "manifest must publish coder agreement");
  assert.equal(published.summary.articleCount, 25);
  assert.equal(published.summary.failureCount, 0);
  assert.equal(published.method.coderKind, "ai", "코더가 사람이 아니라는 사실을 계약에 남긴다");
  assert.ok(published.summary.meanDimensionAgreement > 0 && published.summary.meanDimensionAgreement <= 1);

  const perIssue = [1, 2, 3, 4, 5].map((rank) => getIssueByRank(rank).coderAgreement);
  assert.ok(perIssue.every((entry) => entry && entry.articles.length === entry.articleCount));
  assert.equal(
    perIssue.reduce((sum, entry) => sum + entry.articleCount, 0),
    25,
    "의제별 행을 합치면 기사 전수가 된다",
  );
  // 의제 값은 전체 값의 복사가 아니어야 한다 — 하나라도 다르면 다시 센 것이다
  assert.ok(
    perIssue.some((entry) => entry.meanDimensionAgreement !== published.summary.meanDimensionAgreement),
    "per-issue agreement must be recomputed, not copied from the overall rate",
  );
});

test("builder refuses coder agreement that does not cover every article", () => {
  const sources = readInitialFiveSourcesSync({ siteRoot });
  const short = {
    ...sources.coderAgreement,
    articles: sources.coderAgreement.articles.slice(1),
  };
  assert.throws(
    () => buildInitialFiveManifest({ top5: sources.top5, metadata: sources.metadata, coderAgreement: short }),
    /coder agreement missing 1 article/,
  );
  const badRate = { ...sources.coderAgreement, summary: { ...sources.coderAgreement.summary, mean_dimension_agreement: 89.3 } };
  assert.throws(
    () => buildInitialFiveManifest({ top5: sources.top5, metadata: sources.metadata, coderAgreement: badRate }),
    /rate between 0 and 1/,
  );
});
