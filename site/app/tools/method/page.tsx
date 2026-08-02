import Link from "next/link";
import SiteHeader from "../../site-header";

const dimensions = ["문제 정의", "원인 해석", "책임 귀속", "규범적 평가", "해법·처방"];

export default function MethodToolPage() {
  return (
    <main className="af-page af-tool-page">
      <SiteHeader active="tools" />
      <div className="af-tool-shell">
        <Link className="af-back-link" href="/tools">← 도구로 돌아가기</Link>
        <header className="af-tool-intro"><span className="af-section-label">방법론</span><h1>무엇을 비교하고, 무엇을 말하지 않는가</h1><p>같은 사건에 연결된 기사에서 확인 가능한 설명 요소와 근거 위치를 비교합니다.</p></header>
        <div className="af-method-list">
          <section><span className="af-section-label">범위</span><h2>초기 5개 파일럿</h2><p>2026년 7월 26일 표본에서 상위 5개 의제, 25개 기사를 먼저 비교합니다. 기사 수와 참여 매체는 표본 안의 관측값이며 사회적 중요도나 사실성을 뜻하지 않습니다.</p></section>
          <section><span className="af-section-label">프레이밍 축</span><h2>다섯 가지 설명 요소</h2><div className="af-dimension-list">{dimensions.map((dimension) => <span key={dimension}>{dimension}</span>)}</div></section>
          <section><span className="af-section-label">AI 상태</span><h2>AI는 근거를 대신하지 않습니다</h2><p>본문 semantic 프로필이 연결된 기사만 AI 자동 초안으로 표시합니다. 호출 실패나 근거 부족은 검토 필요 상태로 남기며 규칙 기반 결과를 AI 분석으로 표시하지 않습니다.</p></section>
          <section><span className="af-section-label">원문 처리</span><h2>본문 전문은 공개하지 않습니다</h2><p>원문 링크, 문단·문장 위치, 비복원 지문과 분석 결과만 연결합니다. “확인되지 않음”은 분석 가능한 본문에서 직접 근거를 찾지 못했다는 뜻입니다.</p></section>
        </div>
      </div>
    </main>
  );
}
