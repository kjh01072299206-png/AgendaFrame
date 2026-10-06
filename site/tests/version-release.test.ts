import assert from "node:assert/strict";
import test from "node:test";

import { getReleaseVersion } from "../lib/release-version";

test("reports the commit supplied to the Vercel deployment", () => {
  assert.deepEqual(
    getReleaseVersion({
      VERCEL_GIT_COMMIT_SHA: "a".repeat(40),
      AGENDAFRAME_RELEASE_SHA: "b".repeat(40),
      VERCEL_GIT_COMMIT_REF: "codex/oct5-full-day-review",
      VERCEL_ENV: "production",
    }),
    {
      commit: "a".repeat(40),
      shortCommit: "a".repeat(7),
      ref: "codex/oct5-full-day-review",
      buildEnv: "production",
    },
  );
});

test("uses the per-deployment release SHA when Vercel Git metadata is absent", () => {
  const version = getReleaseVersion({
    VERCEL_GIT_COMMIT_SHA: " ",
    AGENDAFRAME_RELEASE_SHA: "c".repeat(40),
    VERCEL_ENV: "production",
  });
  assert.equal(version.commit, "c".repeat(40));
  assert.equal(version.shortCommit, "c".repeat(7));
  assert.equal(version.ref, null);
});

test("keeps unknown when no release identity is available", () => {
  assert.deepEqual(getReleaseVersion({}), {
    commit: "unknown",
    shortCommit: "unknown",
    ref: null,
    buildEnv: "local",
  });
});
