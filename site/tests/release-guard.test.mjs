import assert from "node:assert/strict";
import test from "node:test";

import { chooseRollback, evaluateReleaseGate, evaluateSlo, selectCanary } from "../worker/release-guard.mjs";

const thresholds = {
  release_policy: { require_semantic_review: true, require_staging_health_check: true, require_canary_observation: true, require_rollback_drill: true },
  human_review: { minimum_independent_annotators: 2 },
  clustering: { pairwise_f1: { operator: "gte", value: 0.9 } },
  framing: { macro_f1: { operator: "gte", value: 0.8 } },
  report: { citation_coverage: { operator: "gte", value: 0.95 } },
  calibration: { required_before_numeric_confidence: true },
};

test("release gate remains blocked before real adjudicated labels", () => {
  const result = evaluateReleaseGate({
    thresholds,
    metrics: { clustering: { pairwise_f1: 0.99 }, framing: { macro_f1: 0.99 }, report: { citation_coverage: 0.99 } },
    dataset: { kind: "real", status: "unlabeled", annotators: 0, adjudicated: false, agreementReport: false, lockedHoldout: true },
    holdout: { licensed: false, calibrationReady: false },
  });
  assert.equal(result.release_eligible, false);
  assert.match(result.reasons.join(","), /holdout/);
});

test("release gate passes only with a licensed double-annotated holdout", () => {
  const result = evaluateReleaseGate({
    thresholds,
    metrics: { clustering: { pairwise_f1: 0.91 }, framing: { macro_f1: 0.81 }, report: { citation_coverage: 0.96 } },
    dataset: { kind: "real", status: "labeled", annotators: 2, adjudicated: true, agreementReport: true, lockedHoldout: true },
    holdout: { licensed: true, calibrationReady: true, semantic_review: true, staging_health_check: true, canary_observation: true, rollback_drill: true },
  });
  assert.equal(result.release_eligible, true);
});

test("canary selection and automatic rollback are deterministic", () => {
  const canary = selectCanary({ candidates: [{ version: "v1" }, { version: "v2" }], trafficPercent: 5, now: 1 });
  assert.equal(canary.version, "v2");
  const slo = evaluateSlo({ metrics: { errorRate: 0.04 }, budgets: { errorRate: 0.02 } });
  const decision = chooseRollback({ current: { version: "v2" }, previous: { version: "v1" }, releaseGate: { release_eligible: true }, slo });
  assert.deepEqual(decision, { rollback: true, target: { version: "v1" }, reason: "slo_breached" });
});
