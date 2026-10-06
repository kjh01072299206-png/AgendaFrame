import assert from "node:assert/strict";
import { test } from "node:test";
import { validateLiveActiveSnapshotEnvelope } from "../lib/active-snapshot";

const schemaVersion = "agenda.frame.active-snapshot.v1";
const snapshotId = "a".repeat(32);
const replayRunId = "oct5-public-override-20261007";
const replayMarker = "user_authorized_2026-10-05_replay";

function snapshot({
  authorizedReplay = false,
  bodyField = false,
}: { authorizedReplay?: boolean; bodyField?: boolean } = {}) {
  const issues = Array.from({ length: 5 }, (_, index) => ({
    issueId: `issue-${index + 1}`,
    articleCount: authorizedReplay ? 1 : 3,
    outletCount: authorizedReplay ? 1 : 2,
    payloadKey: `issues/issue-${index + 1}.json`,
  }));
  const bundles = Object.fromEntries(issues.map((issue, index) => [issue.issueId, {
    issue: { issueId: issue.issueId },
    articles: authorizedReplay
      ? [{ articleId: `article-${index + 1}`, outlet: "매체A" }]
      : [
        { articleId: `article-${index + 1}-a`, outlet: "매체A" },
        { articleId: `article-${index + 1}-b`, outlet: "매체B" },
        { articleId: `article-${index + 1}-c`, outlet: "매체A" },
      ],
  }]));
  if (bodyField) (bundles["issue-1"] as Record<string, unknown>).body_text = "placeholder";
  const qualityGate = {
    status: "pass",
    rawBodyAbsent: true,
    evidenceLineageComplete: true,
    ...(authorizedReplay ? { operatorOverride: replayMarker } : {}),
  };
  return {
    schemaVersion,
    snapshotId,
    basisDate: "2026-10-05",
    runId: authorizedReplay ? replayRunId : "ordinary-run",
    qualityGate,
    manifest: {
      schemaVersion,
      snapshotId,
      basisDate: "2026-10-05",
      issueCount: 5,
      issues,
      qualityGate,
    },
    bundles,
  };
}

test("serves the exact authorized Oct 5 replay without adding a UI warning", () => {
  const value = snapshot({ authorizedReplay: true });
  assert.equal(validateLiveActiveSnapshotEnvelope(value).snapshotId, snapshotId);
});

test("keeps ordinary live snapshots subject to per-issue publication requirements", () => {
  assert.throws(
    () => validateLiveActiveSnapshotEnvelope(snapshot()),
    /lacks an evidence-bound v2\.2 comparison result/,
  );
});

test("keeps body-free validation in force for the authorized replay", () => {
  assert.throws(
    () => validateLiveActiveSnapshotEnvelope(snapshot({ authorizedReplay: true, bodyField: true })),
    /공개 금지 필드/,
  );
});
