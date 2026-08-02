import Link from "next/link";
import CommunityHub from "../../community/community-hub";
import SiteHeader from "../../site-header";

export default function ToolsCommunityPage() {
  return (
    <main className="af-page af-tool-page">
      <SiteHeader active="tools" />
      <div className="af-tool-shell">
        <Link className="af-back-link" href="/tools">← 도구로 돌아가기</Link>
        <header className="af-tool-intro"><span className="af-section-label">커뮤니티</span><h1>근거를 놓고 이야기하세요.</h1><p>선택한 의제의 원문 기사와 분석 근거를 확인한 뒤 의견을 남길 수 있습니다.</p></header>
        <div className="af-community-content"><CommunityHub /></div>
      </div>
    </main>
  );
}
