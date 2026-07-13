export default function Home() {
  return (
    <>
      <a className="skip-link" href="#agenda-workspace">본문으로 건너뛰기</a>
      <header className="topbar">
        <a className="brand" href="#top" aria-label="AgendaFrame 홈">
          <span className="brand-mark" aria-hidden="true">AF</span>
          <span className="brand-copy"><b>AgendaFrame</b><small>의제·프레임 분석</small></span>
        </a>
        <nav className="topnav" aria-label="주요 메뉴">
          <a href="#agenda-workspace">오늘의 의제</a>
          <a href="#comparison">언론사 비교</a>
          <button type="button" data-open-method>분석 기준</button>
        </nav>
        <div className="top-actions">
          <span className="demo-badge"><i aria-hidden="true" /> 시연용 합성 데이터</span>
          <button className="refresh-button" id="refresh-button" type="button" aria-label="데모 데이터 갱신">
            <span aria-hidden="true">↻</span><span>갱신</span>
          </button>
        </div>
      </header>

      <div id="top" />
      <main>
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero-copy">
            <p className="eyebrow">2026.07.13 · KST · 오늘의 미디어 의제</p>
            <h1 id="hero-title">오늘, 언론은<br /><em>무엇을 크게</em> 다뤘을까?</h1>
            <p className="hero-description">주요 언론사의 홈페이지 배치와 보도 빈도를 읽고, 같은 이슈를 어떤 프레임으로 설명했는지 근거와 함께 비교합니다.</p>
            <button className="text-button" type="button" data-open-method>의제 점수는 어떻게 계산하나요? <span aria-hidden="true">↗</span></button>
          </div>
          <div className="snapshot" aria-label="오늘의 데이터 현황">
            <div className="snapshot-heading"><span>DATA SNAPSHOT</span><strong id="snapshot-time">18:00 기준</strong></div>
            <div className="stat-grid">
              <article><span>분석 언론사</span><strong>5</strong><small>개 매체</small></article>
              <article><span>오늘 수집 기사</span><strong>142</strong><small>건</small></article>
              <article><span>오늘 이슈</span><strong>18</strong><small>개 묶음</small></article>
              <article><span>수집 상태</span><strong className="status-value">정상</strong><small>5/5 성공</small></article>
            </div>
            <div className="pipeline-strip"><span>수집</span><i /><span>클러스터링</span><i /><span>점수화</span><i /><span>프레임 분석</span></div>
          </div>
        </section>

        <section className="workspace" id="agenda-workspace" aria-label="오늘의 의제 분석 화면">
          <aside className="ranking-panel" aria-labelledby="ranking-title">
            <div className="section-heading">
              <div><p className="eyebrow">AGENDA RANKING</p><h2 id="ranking-title">오늘의 의제</h2></div>
              <span className="issue-count">상위 4 / 전체 18</span>
            </div>
            <div className="filter-row" id="category-filters" aria-label="정책 분야 필터" />
            <div className="agenda-list" id="agenda-list" aria-live="polite" />
            <p className="panel-note"><span aria-hidden="true">ⓘ</span> 점수는 언론사 다양성, 기사 수, 배치 위치, 반복 노출을 종합한 상대 지표입니다.</p>
          </aside>

          <article className="detail-panel" id="issue-detail" aria-live="polite" />
        </section>

        <section className="method-preview" id="comparison" aria-labelledby="method-title">
          <div>
            <p className="eyebrow">EXPLAINABLE BY DESIGN</p>
            <h2 id="method-title">판정보다 <em>근거</em>를 먼저 보여줍니다.</h2>
          </div>
          <div className="principles">
            <article><span>01</span><h3>배치 기반 의제</h3><p>조회수가 아닌 홈페이지 편집 위치와 반복 노출을 읽습니다.</p></article>
            <article><span>02</span><h3>이슈별 프레임</h3><p>매체를 고정 분류하지 않고 같은 이슈 안의 강조 차이를 비교합니다.</p></article>
            <article><span>03</span><h3>근거 있는 AI</h3><p>프레임 점수와 함께 제목 표현, 짧은 근거, 신뢰도를 제공합니다.</p></article>
          </div>
        </section>
      </main>

      <footer>
        <div className="brand footer-brand"><span className="brand-mark" aria-hidden="true">AF</span><span className="brand-copy"><b>AgendaFrame</b><small>Capstone MVP</small></span></div>
        <p>이 화면의 기사·언론사·분석 결과는 제품 검증을 위한 합성 데이터입니다.</p>
        <button type="button" data-open-method>분석 방법론 보기</button>
      </footer>

      <dialog className="modal" id="method-dialog" aria-labelledby="method-dialog-title">
        <form method="dialog"><button className="modal-close" aria-label="닫기">×</button></form>
        <p className="eyebrow">AGENDA SCORE v0.1</p>
        <h2 id="method-dialog-title">의제 점수 산식</h2>
        <p className="modal-lead">네 가지 요소를 0~100으로 정규화한 뒤 가중 합산합니다. 모든 결과에는 산식 버전과 계산 시각을 기록합니다.</p>
        <div className="formula"><span>다양성 <b>35%</b></span><i>+</i><span>배치 <b>30%</b></span><i>+</i><span>기사 수 <b>20%</b></span><i>+</i><span>반복 <b>15%</b></span></div>
        <dl className="definition-list">
          <div><dt>언론사 다양성</dt><dd>전체 분석 매체 중 해당 이슈를 다룬 매체의 비율</dd></div>
          <div><dt>홈페이지 배치</dt><dd>TOP·MAIN·SECTION·LIST로 정규화한 편집 위치</dd></div>
          <div><dt>기사 수</dt><dd>같은 시간대 다른 이슈와 비교한 상대 보도량</dd></div>
          <div><dt>반복 노출</dt><dd>6시간 단위 홈페이지 관측에서 다시 등장한 정도</dd></div>
        </dl>
        <p className="method-caution">점수는 사실의 중요도나 언론사의 옳고 그름을 판정하지 않습니다. 관측된 편집·보도 패턴을 설명하는 지표입니다.</p>
      </dialog>

      <dialog className="modal article-modal" id="article-dialog" aria-labelledby="article-dialog-title">
        <form method="dialog"><button className="modal-close" aria-label="닫기">×</button></form>
        <p className="eyebrow">DEMO ARTICLE</p>
        <h2 id="article-dialog-title">기사 정보</h2>
        <div id="article-dialog-content" />
      </dialog>

      <div className="toast" id="toast" role="status" aria-live="polite" />
      <script src="/app.js" defer />
    </>
  );
}
