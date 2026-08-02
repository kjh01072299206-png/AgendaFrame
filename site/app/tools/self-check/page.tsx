import Link from "next/link";
import { SelfCheck } from "../../self-check";
import SiteHeader from "../../site-header";

export default function SelfCheckPage() {
  return (
    <main className="af-page af-tool-page">
      <SiteHeader active="tools" />
      <div className="af-tool-shell">
        <Link className="af-back-link" href="/tools">← 도구로 돌아가기</Link>
        <header className="af-tool-intro"><span className="af-section-label">읽기 자기점검</span><h1>읽는 방식을 잠시 점검하세요.</h1><p>여러 기사를 비교하기 전, 제목·본문·인용·배열을 분리해 확인하는 다섯 가지 질문입니다.</p></header>
        <SelfCheck />
      </div>
    </main>
  );
}
