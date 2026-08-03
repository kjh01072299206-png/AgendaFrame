import { CommunityFeed } from "./community-feed";

export const metadata = { title: "커뮤니티 | AgendaFrame" };

export default function CommunityPage() {
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
      <CommunityFeed />
    </>
  );
}
