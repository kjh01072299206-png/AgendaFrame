import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { readCollectionWorkflowStatus } from "../worker/collection-status.mjs";

const policy = JSON.parse(readFileSync(new URL("../data/discovery-sources.json", import.meta.url), "utf8"));

function fakeDb(resultSets) {
  const statements = [];
  return {
    statements,
    prepare(sql) {
      const state = { sql, values: [] };
      const prepared = {
        bind(...values) {
          state.values = values;
          return prepared;
        },
        _state: state,
      };
      statements.push(state);
      return prepared;
    },
    async batch() {
      return resultSets.map((results) => ({ results }));
    },
  };
}

test("reports body-free workflow progress for all 12 approved sources", async () => {
  const db = fakeDb([
    [{ id: "run-1", status: "success", articleCount: 4, duplicateCount: 1, errorCount: 0 }],
    [{ articleCount: 4, sourceCount: 2, latestCollectedAt: 100 }],
    [{ activeCount: 3, expiredCount: 1, revokedCount: 0, nextExpiryAt: 200 }],
    [{ analyzedCount: 2, failedCount: 1, latestAnalyzedAt: 150 }],
    [{ id: "analysis-1", targetDate: "2026-08-10", status: "success", articleCount: 4, issueCount: 2 }],
    [{ sourceId: "khan", articleCount: 3, latestCollectedAt: 100 }, { sourceId: "kbs", articleCount: 1, latestCollectedAt: 90 }],
  ]);
  const status = await readCollectionWorkflowStatus({ DB: db }, policy, { now: 123, scheduleConfigured: false });
  assert.equal(status.articles.count, 4);
  assert.equal(status.contents.active, 3);
  assert.equal(status.profiles.analyzed, 2);
  assert.equal(status.sources.length, 12);
  assert.equal(status.sources.find((source) => source.id === "khan").articleCount, 3);
  assert.equal(status.sources.find((source) => source.id === "sbs").articleCount, 0);
  assert.equal(status.scheduleConfigured, false);
  const serialized = JSON.stringify(status);
  assert.doesNotMatch(serialized, /bodyText|raw_body|article-content\//i);
});
