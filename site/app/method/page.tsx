import Link from "next/link";

const dimensions = ["문제 정의", "원인 해석", "책임 귀속", "규범적 평가", "해법·처방"];

export default function MethodPage() {
  return (
    <main className="standalone-tool-page method-page">
      <header className="standalone-tool-header">
        <Link href="/">← 의제 비교로 돌아가기</Link>
        <span>METHOD</span>
        <h1>무엇을 비교하고, 무엇을 말하지 않는가</h1>
        <p>AgendaFrame은 기사 수를 중요도나 진실성으로 바꾸지 않습니다. 같은 사건에 연결된 기사에서 확인 가능한 설명 요소와 그 근거 위치를 비교합니다.</p>
      </header>
      <div className="standalone-tool-content method-content">
        <section><span className="initial-five-section-label">01 · 범위</span><h2>초기 5개 파일럿</h2><p>2026년 7월 26일 국내 종합일간지 표본에서 상위 5개 의제를 먼저 비교합니다. 기사 수와 참여 매체는 표본 안의 관측값이며 사회적 중요도·사실성·여론을 뜻하지 않습니다.</p></section>
        <section><span className="initial-five-section-label">02 · 프레이밍 축</span><h2>다섯 가지 설명 요소</h2><div className="method-dimension-list">{dimensions.map((dimension, index) => <div key={dimension}><strong>{String(index + 1).padStart(2, "0")}</strong><span>{dimension}</span></div>)}</div></section>
        <section><span className="initial-five-section-label">03 · AI 상태</span><h2>AI는 근거를 대신하지 않습니다</h2><p>AI 의미 분석 결과가 연결되면 모델·프롬프트·스키마 버전과 검토 상태를 함께 공개합니다. AI 호출이 실패하거나 근거가 부족하면 규칙 기반 fallback 또는 보류 상태로 표시하며, 결과를 AI 분석으로 가장하지 않습니다.</p></section>
        <section><span className="initial-five-section-label">04 · 원문 처리</span><h2>본문 전문은 공개하지 않습니다</h2><p>기사별 원문 링크, 문단·문장 위치, 비복원 지문과 분석 결과만 연결합니다. “확인되지 않음”은 실제 부재나 의도적 누락을 뜻하지 않습니다.</p></section>
      </div>
    </main>
  );
}
