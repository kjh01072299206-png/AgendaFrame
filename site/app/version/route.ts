// 지금 실배포에 떠 있는 커밋을 사이트가 직접 답하는 단일 목적 경로.
//
// 배포 확인이 "200 이 떴다" 에서 멈추면, Vercel 이 아직 빌드 중인 동안 이전 빌드를
// 보고 초록불을 내게 된다. 배포 파이프라인은 "이 커밋이 떴다" 를 검증해야 한다.
// 요청 시점에 읽고 캐시하지 않는다 — 캐시된 응답은 확인 대상이 될 수 없다.
export const dynamic = "force-dynamic";

export function GET() {
  const commit = process.env.VERCEL_GIT_COMMIT_SHA ?? "";
  return Response.json(
    {
      commit: commit || "unknown",
      shortCommit: commit ? commit.slice(0, 7) : "unknown",
      ref: process.env.VERCEL_GIT_COMMIT_REF ?? null,
      buildEnv: process.env.VERCEL_ENV ?? "local",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
