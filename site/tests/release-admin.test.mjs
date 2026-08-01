import assert from "node:assert/strict";
import test from "node:test";

import { handleReleaseAdminRequest } from "../worker/release-admin.mjs";

test("release admin evaluation is read-only and returns a rollback decision", async () => {
  const request = new Request("https://example.test/api/admin/release/evaluate", {
    method: "POST",
    body: JSON.stringify({
      dataset: { kind: "real", status: "unlabeled" },
      holdout: { licensed: false },
      currentVersion: { version: "v2" },
      previousVersion: { version: "v1" },
      candidates: [{ version: "v1" }, { version: "v2" }],
      sloMetrics: { errorRate: 0.04 },
      sloBudgets: { errorRate: 0.02 },
    }),
    headers: { "content-type": "application/json" },
  });
  const response = await handleReleaseAdminRequest(request, {}, { isAdmin: true });
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.gate.release_eligible, false);
  assert.equal(payload.rollback.target.version, "v1");
  assert.equal(payload.cloudMutation, "none");
});
