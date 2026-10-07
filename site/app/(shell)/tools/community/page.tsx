import { getActiveSnapshot } from "../../../../lib/active-snapshot";
import { CommunityFeed, type CommunityIssue } from "./community-feed";

export const metadata = { title: "커뮤니티 | AgendaFrame" };

export const dynamic = "force-dynamic";

export default async function CommunityPage() {
  const active = await getActiveSnapshot();
  const issues: CommunityIssue[] = active.manifest.issues
    .slice()
    .sort((a, b) => a.rank - b.rank)
    .map((issue) => ({ id: issue.issueId, rank: issue.rank, title: issue.title }));

  return (
    <>
      <header className="afs-head">
        <h1>커뮤니티</h1>
        <p>같은 사건, 서로 다른 읽기</p>
      </header>
      <CommunityFeed issues={issues} basisDate={active.manifest.basisDate} />
    </>
  );
}
