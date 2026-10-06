export function getReleaseVersion(env: Record<string, string | undefined>) {
  const commit = [env.VERCEL_GIT_COMMIT_SHA, env.AGENDAFRAME_RELEASE_SHA]
    .map((value) => value?.trim())
    .find((value) => value);

  return {
    commit: commit ?? "unknown",
    shortCommit: commit ? commit.slice(0, 7) : "unknown",
    ref: env.VERCEL_GIT_COMMIT_REF || null,
    buildEnv: env.VERCEL_ENV || "local",
  };
}
