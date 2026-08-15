import { getActiveSnapshot } from "../../../../../lib/active-snapshot";

const cacheHeaders = {
  "Cache-Control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
};

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ issueId: string }> },
) {
  const { issueId } = await params;
  const decodedIssueId = decodeURIComponent(issueId);
  const active = await getActiveSnapshot();
  const bundle = active.manifest.issues.some((issue) => issue.issueId === decodedIssueId)
    ? active.getIssueBundle(decodedIssueId)
    : null;
  if (!bundle) {
    return Response.json(
      { error: "initial_five_issue_not_found", issueId: decodedIssueId },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }
  return Response.json(bundle, { headers: cacheHeaders });
}
