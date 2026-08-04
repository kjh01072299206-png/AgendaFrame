import { initialFiveManifest } from "../../../../lib/initial-five/artifacts";
import { CommunityFeed, type CommunityIssue } from "./community-feed";

export const metadata = { title: "커뮤니티 | AgendaFrame" };

export default function CommunityPage() {
  // 의제 목록은 이 사이트가 분석한 다섯 건이다. 다른 데이터셋을 끌어오면 사이드바 집계와 어긋난다.
  const issues: CommunityIssue[] = initialFiveManifest.issues
    .slice()
    .sort((a, b) => a.rank - b.rank)
    .map((issue) => ({ id: issue.issueId, rank: issue.rank, title: issue.title }));

  return (
    <>
      <header className="afs-head">
        <span className="afs-eyebrow">커뮤니티</span>
        <h1>같은 근거를 보고 다르게 읽은 사람들</h1>
        <p>
          닉네임 옆에 자가점검에서 나온 읽기 유형이 붙습니다. 누가 말했는지가 아니라 <b>어떤 방식으로 읽는 사람이 말했는지</b>가
          함께 보이면, 의견 차이의 출처를 짚기 쉬워집니다.
        </p>
      </header>
      <CommunityFeed issues={issues} />
    </>
  );
}
