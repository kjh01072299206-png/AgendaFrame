import Link from "next/link";
import CommunityHub from "./community-hub";

export default function CommunityPage() {
  return (
    <main className="standalone-tool-page">
      <header className="standalone-tool-header">
        <Link href="/">← 의제 비교로 돌아가기</Link>
        <span>COMMUNITY</span>
        <h1>근거를 읽고 의견 나누기</h1>
        <p>사람에 대한 평가보다 기사와 근거에 대해 이야기해 주세요. 신고된 댓글은 운영 검토 대상이 됩니다.</p>
      </header>
      <div className="standalone-tool-content"><CommunityHub /></div>
    </main>
  );
}
