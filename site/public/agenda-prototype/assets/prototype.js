(() => {
  "use strict";

  const page = document.body.dataset.page || "overview";

  const pages = [
    { id: "overview", href: "index.html", label: "이슈 개요", mark: "O" },
    { id: "issues", href: "issues.html", label: "이슈 탐색", mark: "I" },
    { id: "outlets", href: "outlets.html", label: "언론사 비교", mark: "M" },
    { id: "framing", href: "framing.html", label: "프레이밍 분석", mark: "F" },
    { id: "self-check", href: "self-check.html", label: "자가점검", mark: "S" },
    { id: "chat", href: "chat.html", label: "AI 대화", mark: "A" },
    { id: "report", href: "report.html", label: "리포트", mark: "R" },
  ];

  const outlets = [
    {
      id: "haesol",
      name: "해솔일보",
      articleCount: 3,
      focus: "절차·공개",
      angle: "결정 과정의 공개성과 이용자 의견수렴을 중심 질문으로 둠",
      tone: "검증 질문 중심",
      coverage: 86,
      color: "#2859dc",
    },
    {
      id: "donghae",
      name: "동해경제",
      articleCount: 3,
      focus: "수요·효율",
      angle: "시간대별 수요와 추가 운행비를 함께 확인해야 한다고 설명",
      tone: "조건·지표 중심",
      coverage: 72,
      color: "#14785d",
    },
    {
      id: "citizen",
      name: "시민포커스",
      articleCount: 3,
      focus: "접근성·귀가",
      angle: "외곽 주민과 교대노동자의 추가 이동을 핵심 결과로 보여 줌",
      tone: "당사자 경험 중심",
      coverage: 64,
      color: "#7353bc",
    },
  ];

  const articles = [
    { id: "H1", outlet: "해솔일보", time: "07.26 09:10", title: "N-7 개편안, 설명회 뒤 8일 만에 확정", tag: "문제 정의", subIssue: "절차·공개", excerpt: "자료 공개와 의견수렴의 범위를 확인하는 기사" },
    { id: "H2", outlet: "해솔일보", time: "07.27 13:35", title: "시의회, 노선 산정자료 공개 요구", tag: "원인·책임", subIssue: "절차·공개", excerpt: "행정 절차와 산정 근거를 질문하는 기사" },
    { id: "H3", outlet: "해솔일보", time: "07.28 08:50", title: "시범운행 전 주민 설명을 더 해야 하나", tag: "해법", subIssue: "시범운행", excerpt: "추가 설명과 공개를 후속 조치로 둔 기사" },
    { id: "D1", outlet: "동해경제", time: "07.26 11:40", title: "심야버스 증편, 시간대별 수요가 관건", tag: "문제 정의", subIssue: "수요·효율", excerpt: "이용량 변화와 운행 구조를 비교하는 기사" },
    { id: "D2", outlet: "동해경제", time: "07.27 15:20", title: "연 3억2천만원 추가 예산, 검증 지표는", tag: "평가", subIssue: "수요·효율", excerpt: "탑승률과 승객 1인당 운행비를 제시한 기사" },
    { id: "D3", outlet: "동해경제", time: "07.28 10:10", title: "3개월 시범운행 뒤 배차 재조정 제안", tag: "해법", subIssue: "시범운행", excerpt: "측정값 공개 뒤 재조정을 제안한 기사" },
    { id: "C1", outlet: "시민포커스", time: "07.26 17:10", title: "외곽 정류장 4곳 폐지, 귀가 경로 길어져", tag: "문제 정의", subIssue: "접근성·귀가", excerpt: "정류장 폐지 뒤 추가 이동을 보인 기사" },
    { id: "C2", outlet: "시민포커스", time: "07.27 07:55", title: "교대노동자 27명 ‘막차를 탈 수 없다’", tag: "발화권", subIssue: "접근성·귀가", excerpt: "당사자의 시간표와 보행 경험을 담은 기사" },
    { id: "C3", outlet: "시민포커스", time: "07.28 18:20", title: "보완 셔틀 없으면 개편 효과 반감", tag: "해법", subIssue: "시범운행", excerpt: "대체수단 유무를 후속 조건으로 둔 기사" },
  ];

  const issueCandidates = [
    { id: "n7", title: "N-7 심야버스 노선 개편", category: "정책·교통", frame: "문제 정의", count: 9, outlets: 3, update: "07.28 18:20", summary: "같은 개편안을 절차, 효율, 접근성의 서로 다른 질문으로 읽은 가상 표본입니다." },
    { id: "procedure", title: "개편 결정 절차와 자료 공개", category: "정책·교통", frame: "원인·책임", count: 3, outlets: 1, update: "07.28 08:50", summary: "설명회와 산정자료 공개가 충분했는지 확인하는 관련 보도 묶음입니다." },
    { id: "efficiency", title: "심야 운송 수요와 추가 예산", category: "생활·경제", frame: "평가", count: 3, outlets: 1, update: "07.28 10:10", summary: "시간대별 탑승률과 비용을 어떤 기준으로 판단할지 다루는 관련 보도 묶음입니다." },
    { id: "access", title: "외곽 정류장과 심야 귀가 접근성", category: "사회·노동", frame: "발화권", count: 3, outlets: 1, update: "07.28 18:20", summary: "정류장 변경이 특정 이용자의 귀가 경로에 미치는 영향을 다루는 관련 보도 묶음입니다." },
  ];

  const axisRows = [
    {
      id: "problem",
      label: "문제 정의",
      prompt: "무엇을 핵심 문제로 보았나",
      haesol: ["검증되지 않은 결정 절차", "자료 공개와 의견수렴의 부족을 중심에 둠"],
      donghae: ["수요와 어긋난 운행 구조", "낮은 탑승률과 추가 운행비를 중심에 둠"],
      citizen: ["귀가 선택지가 줄어드는 격차", "폐지 정류장 이용자의 추가 이동을 중심에 둠"],
    },
    {
      id: "cause",
      label: "원인·책임",
      prompt: "왜 생겼고 누구에게 돌렸나",
      haesol: ["이용자 조사·공개 검증 부족", "행정 절차와 산정 근거에 질문을 둠"],
      donghae: ["과거 수요에 고정된 노선", "시간대별 변화가 반영되지 않았다고 설명"],
      citizen: ["평균 이용량 중심의 결정", "소수 이용자의 필수 이동이 가려졌다고 설명"],
    },
    {
      id: "evaluation",
      label: "평가",
      prompt: "어떤 기준으로 판단했나",
      haesol: ["근거 공개 없이 확정한 공공정책", "절차적 정당성을 판단 기준으로 제시"],
      donghae: ["추가 예산은 효율로 검증돼야 함", "탑승률과 운행비를 판단 기준으로 제시"],
      citizen: ["효율이 필수 이동을 지워선 안 됨", "대체수단 유무를 판단 기준으로 제시"],
    },
    {
      id: "treatment",
      label: "해법",
      prompt: "무엇을 후속 조치로 제시했나",
      haesol: ["자료 공개와 추가 의견수렴", "시의회 요구와 시민 설명을 후속 조치로 제시"],
      donghae: ["3개월 시범운행과 수요 재조정", "지표 공개 뒤 시간대별 조정을 제안"],
      citizen: ["폐지 정류장 보완 셔틀", "개편 유지와 접근성 보완을 함께 제안"],
    },
    {
      id: "voice",
      label: "발화권",
      prompt: "누구의 목소리를 실었나",
      haesol: ["시청·시의회 발언이 다수", "기관의 설명과 검증 요구가 두드러짐"],
      donghae: ["전문가·운수업계 발언이 다수", "비용과 수요 해석이 두드러짐"],
      citizen: ["이용자·노동자 발언이 다수", "귀가 경험과 대체수단 문제가 두드러짐"],
    },
  ];

  const evidence = {
    haesol: {
      id: "H2", outlet: "해솔일보", location: "본문 5문단", tag: "원인·책임", voice: "가상 기자 서술", title: "시의회, 노선 산정자료 공개 요구", quote: "“주민설명회 뒤 8일 만에 개편안을 확정했지만, 노선별 승하차 산정자료는 공개하지 않았다.”", reason: "가상 기사에서 자료 비공개와 짧은 의견수렴을 절차 문제의 원인으로 연결한 문장입니다.",
    },
    donghae: {
      id: "D2", outlet: "동해경제", location: "본문 6문단", tag: "평가", voice: "가상 전문가 발언", title: "연 3억2천만원 추가 예산, 검증 지표는", quote: "“추가 예산의 효과는 시간대별 탑승률과 승객 1인당 운행비를 함께 공개해야 판단할 수 있다.”", reason: "가상 전문가 발언을 통해 정책 판단을 측정 가능한 효율 지표와 연결한 문장입니다.",
    },
    citizen: {
      id: "C2", outlet: "시민포커스", location: "본문 4문단", tag: "문제 정의", voice: "가상 당사자 발언", title: "교대노동자 27명 ‘막차를 탈 수 없다’", quote: "“밤 11시 40분에 일이 끝나면 새 정류장까지 걸어서 26분이 걸려 막차를 탈 수 없다.”", reason: "가상 당사자 발언이 시간표와 보행 시간을 연결해 특정 이용자의 접근성 문제를 드러냅니다.",
    },
  };

  const selfCheckQuestions = [
    { id: "q1", label: "이 기사에서 가장 두드러진 문제 정의는 무엇이었나요?", options: ["결정 절차와 자료 공개", "수요·예산 효율", "심야 귀가 접근성", "잘 모르겠다"] },
    { id: "q2", label: "기사의 설명은 원인을 어디에 두었나요?", options: ["행정 절차", "수요 산정 방식", "대체수단 부족", "명시되지 않음"] },
    { id: "q3", label: "어떤 목소리가 가장 많이 보였나요?", options: ["기관·의회", "전문가·업계", "이용자·노동자", "판단하기 어렵다"] },
    { id: "q4", label: "본문에서 거의 보이지 않은 관점은 무엇인가요?", options: ["당사자 경험", "수요 자료", "자료 공개 범위", "다른 기사를 더 봐야 한다"] },
    { id: "q5", label: "공유 전에 추가로 확인할 정보는 무엇인가요?", options: ["정책 일정", "통계·산정 근거", "다른 이해관계자", "원문과 문단 위치"] },
  ];

  const chatSuggestions = [
    { id: "responsibility", label: "결정 과정의 책임을 어디에 두었나?", response: "가상 표본에서는 해솔일보가 자료 공개와 의견수렴의 범위를 중심 질문으로 두었고, 동해경제는 과거 수요 산정 방식, 시민포커스는 평균 이용량 중심 결정이 놓친 이용자를 각각 설명합니다. 이는 매체 의도나 성향 판정이 아니라 해당 가상 기사에서 관측한 설명의 차이입니다.", evidence: "haesol" },
    { id: "citizen", label: "시민 피해를 드러낸 근거는?", response: "가상 표본에서 시민포커스는 교대노동자의 퇴근 시각과 새 정류장까지의 보행 시간을 함께 제시했습니다. 이 문장은 정류장 변경을 추상적 효율 문제가 아니라 특정 이용자의 귀가 가능성 문제로 읽게 하는 근거입니다.", evidence: "citizen" },
    { id: "efficiency", label: "효율을 확인하려면 무엇이 필요한가?", response: "가상 표본에서 동해경제는 시간대별 탑승률과 승객 1인당 운행비를 함께 공개해야 한다는 가상 전문가 발언을 실었습니다. 따라서 비용만으로 성공·실패를 결론내리지 않고, 수요와 비용을 함께 확인하는 질문으로 남깁니다.", evidence: "donghae" },
  ];

  function escapeHTML(value) {
    return String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
  }

  function navMarkup() {
    return pages.map((item) => `<a href="${item.href}"${item.id === page ? ' aria-current="page"' : ""}><span class="afp-nav-mark" aria-hidden="true">${item.mark}</span><span>${item.label}</span></a>`).join("");
  }

  function mobileNavMarkup() {
    return pages.map((item) => `<a href="${item.href}"${item.id === page ? ' aria-current="page"' : ""}>${item.label}</a>`).join("");
  }

  function shell(content) {
    return `
      <a class="afp-skip" href="#afp-main">분석 본문으로 건너뛰기</a>
      <div class="afp-shell">
        <aside class="afp-sidebar" aria-label="주요 메뉴">
          <a class="afp-brand" href="index.html" aria-label="AgendaFrame 이슈 개요">
            <span class="afp-brand-mark" aria-hidden="true">AF</span>
            <span class="afp-brand-copy"><strong>Agenda<span>Frame</span></strong><small>가상 사례 프로토타입</small></span>
          </a>
          <nav class="afp-side-nav" aria-label="프로토타입 화면">${navMarkup()}</nav>
          <div class="afp-side-help"><strong>피드백을 남길까요?</strong><p>모든 화면은 같은 가상 사건과 9개 기사 표본을 사용합니다.</p><a href="report.html">리포트 화면 보기 →</a></div>
        </aside>
        <header class="afp-topbar">
          <div class="afp-search" role="note" aria-label="전체 검색은 이슈 탐색 화면에서 제공합니다"><span class="afp-search-symbol" aria-hidden="true">⌕</span><span>이슈·키워드 검색은 이슈 탐색에서 이용하세요</span></div>
          <div class="afp-top-actions"><span class="afp-date">2026.07.26–07.28 · 가상 사례</span><span class="afp-status"><i aria-hidden="true"></i>검토 초안</span></div>
        </header>
        <nav class="afp-mobile-nav" aria-label="모바일 화면 이동">${mobileNavMarkup()}</nav>
        <main class="afp-main" id="afp-main">${content}</main>
      </div>
      <div class="afp-toast" id="afp-toast" role="status" hidden></div>
    `;
  }

  function pageHead(title, description, actions = "") {
    return `<section class="afp-page-head"><div><h1>${title}</h1><p>${description}</p><div class="afp-badge-row"><span class="afp-badge synthetic">가상 사례</span><span class="afp-badge">해솔시 심야버스 N-7</span><span class="afp-badge purple">기사 9건 · 매체 3곳</span></div></div>${actions ? `<div class="afp-page-actions">${actions}</div>` : ""}</section>`;
  }

  function scopeMarkup() {
    return `<section class="afp-scope" aria-label="분석 범위">
      <div><small>사건 경계</small><strong>7월 26일 개편 발표와 7월 28일까지의 후속 가상 보도</strong></div>
      <div><small>텍스트 범위</small><strong>제목 · 가상 본문 발췌</strong></div>
      <div><small>근거 표기</small><strong>기사 ID · 가상 문단 위치</strong></div>
      <div class="afp-status-cell"><small>공개 상태</small><strong>자동 초안 · 사람 검토 전</strong></div>
    </section>`;
  }

  function footerMarkup() {
    return `<footer class="afp-footer"><span>AgendaFrame은 여러 기사의 관측 가능한 차이를 근거와 함께 비교하는 분석 도구입니다.</span><span>가상 사례 · 외부 통신 없음 · 원문 재현 없음</span></footer>`;
  }

  function statGridMarkup() {
    return `<section class="afp-stat-grid" aria-label="가상 표본 요약">
      <article class="afp-stat"><div class="afp-stat-head"><span class="afp-stat-token">A</span>가상 기사 수</div><b>9건</b><small>동일 사건으로 묶은 가상 기사 표본</small></article>
      <article class="afp-stat"><div class="afp-stat-head"><span class="afp-stat-token green">M</span>매체 수</div><b>3곳</b><small>같은 사건을 다룬 가상 매체</small></article>
      <article class="afp-stat"><div class="afp-stat-head"><span class="afp-stat-token purple">F</span>비교 축</div><b>5개</b><small>Entman 4기능과 발화권 보조축</small></article>
      <article class="afp-stat"><div class="afp-stat-head"><span class="afp-stat-token amber">R</span>검토 상태</div><b>초안</b><small>해석 전 사람 검토가 필요함</small></article>
    </section>`;
  }

  function articleRows(limit = articles.length) {
    return articles.slice(0, limit).map((article, index) => `<tr>
      <td>${index + 1}</td><td><a class="afp-link" href="framing.html#evidence">${article.title}</a></td><td>${article.outlet}</td><td>${article.time}</td><td><span class="afp-chip blue">${article.tag}</span></td><td>${article.excerpt}</td>
    </tr>`).join("");
  }

  function renderOverview() {
    return `${pageHead("해솔시 심야버스 N-7 노선 개편", "가상 표본을 기준으로 공통 사실과 서로 다른 설명의 중심을 빠르게 확인합니다.", `<a class="afp-button" href="framing.html">프레이밍 분석</a><a class="afp-button primary" href="report.html">리포트 보기</a>`)}
      ${scopeMarkup()}${statGridMarkup()}
      <section class="afp-grid overview">
        <article class="afp-card"><header><div><h2>매체별 가상 보도량</h2><p>기사 수는 관심의 질이나 영향력 점수가 아닙니다.</p></div><small>표본 9건</small></header>
          <div class="afp-bar-list">${outlets.map((outlet) => `<div class="afp-bar-row"><strong>${outlet.name}</strong><span class="afp-bar-track"><i style="width:${outlet.coverage}%"></i></span><b>${outlet.articleCount}건</b></div>`).join("")}</div>
          <a class="afp-link" href="outlets.html" style="display:inline-flex;margin-top:16px;font-size:11px;">언론사 비교 보기 →</a>
        </article>
        <article class="afp-card"><header><div><h2>이번 사건에서 비교할 질문</h2><p>같은 사실을 어떤 문제·원인·해법으로 조직했는지 읽습니다.</p></div></header>
          <ul class="afp-finding-list"><li><span>공통 사실</span><strong>배차 간격 단축과 정류장 조정</strong><p>세 매체가 공통으로 전한 가상 사건의 골자입니다.</p></li><li><span>갈린 질문</span><strong>공개성, 효율, 심야 귀가 중 무엇을 우선 확인할 것인가</strong><p>서로 다른 문제 정의가 다음 취재 질문을 바꿉니다.</p></li><li><span>해석 경계</span><strong>매체의 의도나 고정 성향은 판정하지 않음</strong><p>표본에서 확인되지 않은 요소는 명시되지 않음으로 남깁니다.</p></li></ul>
        </article>
        <article class="afp-card"><header><div><h2>기사량 흐름</h2><p>가상 표본의 관측 시점</p></div></header><div class="afp-trend" aria-label="가상 기사량 변화">${[28, 45, 37, 53, 42, 65, 77, 59, 73, 46, 55, 62].map((height) => `<i style="height:${height}%"></i>`).join("")}</div><div class="afp-trend-labels"><span>07.26</span><span>07.27</span><span>07.28</span></div><p class="afp-inline-note">시간 순서만으로 원인이나 영향 관계를 확정하지 않습니다.</p></article>
      </section>
      <section class="afp-card" style="margin-top:17px;"><header><div><h2>가상 핵심 기사 목록</h2><p>각 제목은 대표 근거 카드와 기사 ID로 이어집니다.</p></div><a class="afp-link" href="issues.html">이슈 탐색 →</a></header><div class="afp-data-table-wrap"><table class="afp-data-table"><thead><tr><th>순위</th><th>가상 기사 제목</th><th>매체</th><th>시각</th><th>분석 축</th><th>가상 요약</th></tr></thead><tbody>${articleRows(5)}</tbody></table></div></section>
      ${footerMarkup()}`;
  }

  function issueCardsMarkup(list) {
    if (!list.length) return `<div class="afp-empty"><div><strong>조건에 맞는 관련 묶음이 없습니다.</strong><p>검색어나 필터를 지우고 다시 확인해 보세요.</p></div></div>`;
    return `<div class="afp-issue-grid">${list.map((issue) => `<article class="afp-issue-card"><div class="afp-issue-meta"><span>${issue.category}</span><span class="afp-chip blue">${issue.frame}</span></div><h3>${issue.title}</h3><p>${issue.summary}</p><div class="afp-issue-foot"><span>가상 기사 ${issue.count}건 · 매체 ${issue.outlets}곳</span><a class="afp-link" href="framing.html">분석 보기 →</a></div></article>`).join("")}</div>`;
  }

  function renderIssues() {
    return `${pageHead("이슈 탐색", "동일한 가상 사건 표본을 주제·분석 축·업데이트 순으로 좁혀 보세요.", `<a class="afp-button primary" href="report.html">선택 항목 리포트</a>`)}${scopeMarkup()}
      <section class="afp-filter-bar" aria-label="이슈 필터">
        <div class="afp-field"><label for="afp-issue-search">이슈명 또는 키워드</label><input id="afp-issue-search" type="search" placeholder="예: 정류장, 수요, 절차"></div>
        <div class="afp-field"><label for="afp-issue-category">분야</label><select id="afp-issue-category"><option value="all">전체</option><option value="정책·교통">정책·교통</option><option value="생활·경제">생활·경제</option><option value="사회·노동">사회·노동</option></select></div>
        <div class="afp-field"><label for="afp-issue-frame">분석 축</label><select id="afp-issue-frame"><option value="all">전체</option><option value="문제 정의">문제 정의</option><option value="원인·책임">원인·책임</option><option value="평가">평가</option><option value="발화권">발화권</option></select></div>
        <div class="afp-field"><label for="afp-issue-sort">정렬</label><select id="afp-issue-sort"><option value="coverage">기사 수 많은 순</option><option value="recent">업데이트 최신 순</option><option value="outlets">매체 수 많은 순</option></select></div>
        <div class="afp-filter-actions"><button class="afp-button" type="button" id="afp-issue-reset">초기화</button></div>
      </section>
      <p class="afp-result-count" id="afp-issue-count" aria-live="polite"></p><section id="afp-issue-results" aria-live="polite"></section>
      <section class="afp-card" style="margin-top:17px;"><header><div><h2>가상 기사 아카이브</h2><p>표본 안의 제목·매체·가상 요약을 함께 확인합니다.</p></div></header><div class="afp-data-table-wrap"><table class="afp-data-table"><thead><tr><th>ID</th><th>제목</th><th>매체</th><th>관련 묶음</th><th>분석 축</th></tr></thead><tbody>${articles.map((article) => `<tr><td>${article.id}</td><td><a class="afp-link" href="framing.html#evidence">${article.title}</a></td><td>${article.outlet}</td><td>${article.subIssue}</td><td><span class="afp-chip blue">${article.tag}</span></td></tr>`).join("")}</tbody></table></div></section>${footerMarkup()}`;
  }

  function outletCardsMarkup() {
    return outlets.map((outlet) => `<article class="afp-outlet-card" data-outlet-card="${outlet.id}"><header><h3>${outlet.name}</h3><span>가상 기사 ${outlet.articleCount}건</span></header><p>${outlet.angle}</p><dl><div><dt>설명의 중심</dt><dd>${outlet.focus}</dd></div><div><dt>서술 방식</dt><dd>${outlet.tone}</dd></div></dl></article>`).join("");
  }

  function renderOutlets() {
    return `${pageHead("언론사 비교", "매체별 차이는 고정 성향이 아니라 이 가상 사건 표본에서 관측한 설명·질문·발화의 차이로만 읽습니다.", `<a class="afp-button" href="framing.html">근거 기반 분석</a><a class="afp-button primary" href="report.html">비교 리포트</a>`)}${scopeMarkup()}
      <section class="afp-card"><header><div><h2>매체별 설명의 중심</h2><p>한 매체에 집중하면 해당 매체의 가상 기사 셀과 대표 질문을 강조합니다.</p></div><span class="afp-badge synthetic">가상 표본 3건씩</span></header><div class="afp-outlet-tabs" role="group" aria-label="집중 매체 선택"><button type="button" data-outlet-filter="all" aria-pressed="true">전체 비교</button>${outlets.map((outlet) => `<button type="button" data-outlet-filter="${outlet.id}" aria-pressed="false">${outlet.name}</button>`).join("")}</div><div class="afp-outlet-summary" id="afp-outlet-summary"><strong>전체 비교</strong> · 같은 노선 개편을 절차·공개, 수요·효율, 접근성·귀가의 서로 다른 질문으로 읽은 가상 표본입니다.</div><div class="afp-outlet-grid" id="afp-outlet-cards">${outletCardsMarkup()}</div></section>
      <section class="afp-grid two"><article class="afp-card"><header><div><h2>분석 축별 강조도</h2><p>가상 기사 3건에서 해당 질문이 중심에 나타난 정도를 4단계로 표시합니다.</p></div></header><div class="afp-data-table-wrap"><table class="afp-heatmap"><thead><tr><th>분석 축</th><th data-outlet-cell="haesol">해솔일보</th><th data-outlet-cell="donghae">동해경제</th><th data-outlet-cell="citizen">시민포커스</th></tr></thead><tbody><tr><td>문제 정의</td><td class="p4" data-outlet-cell="haesol">절차</td><td class="p3" data-outlet-cell="donghae">수요</td><td class="p4" data-outlet-cell="citizen">귀가</td></tr><tr><td>원인·책임</td><td class="p4" data-outlet-cell="haesol">공개</td><td class="p3" data-outlet-cell="donghae">산정</td><td class="p3" data-outlet-cell="citizen">평균</td></tr><tr><td>평가</td><td class="p3" data-outlet-cell="haesol">정당성</td><td class="p4" data-outlet-cell="donghae">비용</td><td class="p3" data-outlet-cell="citizen">필수 이동</td></tr><tr><td>해법</td><td class="p3" data-outlet-cell="haesol">공개</td><td class="p4" data-outlet-cell="donghae">시범</td><td class="p4" data-outlet-cell="citizen">셔틀</td></tr></tbody></table></div><p class="afp-inline-note">색의 농도는 가상 표본 안에서 해당 질문이 앞에 놓인 정도이며, 정확성·영향력·찬반 점수가 아닙니다.</p></article><article class="afp-card"><header><div><h2>기사 톤 관찰</h2><p>가상 기사 문장에 나타난 문제 제기·조건 설명·중립 서술을 단순 관찰값으로 표시합니다.</p></div></header><div class="afp-tone-list">${outlets.map((outlet, index) => `<div class="afp-tone-row" data-outlet-card="${outlet.id}"><strong>${outlet.name}</strong><span class="afp-tone-meter"><i class="calm" style="width:${[22, 32, 26][index]}%"></i><i class="neutral" style="width:${[46, 51, 38][index]}%"></i><i class="critical" style="width:${[32, 17, 36][index]}%"></i></span></div>`).join("")}</div><p class="afp-inline-note">기자 서술과 취재원 발언을 구분하지 않은 가상 보조 관찰값이며, 매체의 태도 판정으로 사용하지 않습니다.</p></article></section>
      <section class="afp-card" style="margin-top:17px;"><header><div><h2>대표 근거와 다음 질문</h2><p>서로 다른 설명을 결론이 아니라 추가 취재 질문으로 연결합니다.</p></div><a class="afp-link" href="chat.html">근거 기반 대화 →</a></header><ul class="afp-finding-list"><li><span>공개</span><strong>노선 산정자료와 의견수렴 과정은 어떤 범위까지 공개됐나?</strong><p>절차 중심 기사가 남기는 질문입니다.</p></li><li><span>효율</span><strong>시간대별 탑승률과 승객 1인당 운행비를 함께 확인할 수 있나?</strong><p>수요·비용 중심 기사가 남기는 질문입니다.</p></li><li><span>접근성</span><strong>폐지 정류장 이용자의 추가 보행과 막차 연결은 어떻게 달라졌나?</strong><p>당사자 경험 중심 기사가 남기는 질문입니다.</p></li></ul></section>${footerMarkup()}`;
  }

  function axisTableMarkup() {
    return `<div class="afp-data-table-wrap"><table class="afp-axis-table"><thead><tr><th>분석 축</th>${outlets.map((outlet) => `<th data-outlet-cell="${outlet.id}">${outlet.name}</th>`).join("")}</tr></thead><tbody>${axisRows.map((row) => `<tr data-axis-row="${row.id}"><th>${row.label}</th>${outlets.map((outlet) => `<td data-outlet-cell="${outlet.id}"><strong>${row[outlet.id][0]}</strong><small>${row[outlet.id][1]}</small></td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
  }

  function evidenceCardsMarkup() {
    return Object.values(evidence).map((item) => `<article class="afp-evidence-card" data-outlet-card="${outlets.find((outlet) => outlet.name === item.outlet).id}"><div class="afp-evidence-tags"><span class="afp-chip blue">${item.tag}</span><span class="afp-chip purple">${item.voice}</span></div><blockquote>${item.quote}</blockquote><footer><span>${item.outlet} · ${item.id} · ${item.location}</span><button type="button" data-evidence="${outlets.find((outlet) => outlet.name === item.outlet).id}">근거 보기</button></footer></article>`).join("");
  }

  function renderFraming() {
    return `${pageHead("프레이밍 분석", "가상 기사 표본에서 관측한 문제 정의·원인·평가·해법·발화권을 근거 카드와 함께 비교합니다.", `<button class="afp-button" type="button" data-copy="framing">검토 메모 복사</button><a class="afp-button primary" href="report.html">리포트 구성</a>`)}${scopeMarkup()}
      <section class="afp-framing-grid">
        <aside class="afp-axis-nav" aria-label="분석 축 선택"><header><div><h2>분석 축</h2><p>비교 질문을 선택하면 해당 행을 강조합니다.</p></div><span class="afp-badge">5개</span></header>${axisRows.map((row, index) => `<button type="button" data-axis="${row.id}" aria-pressed="${index === 0 ? "true" : "false"}"><span class="afp-axis-number">${index + 1}</span><span><strong>${row.label}</strong><small>${row.prompt}</small></span><b aria-hidden="true">›</b></button>`).join("")}</aside>
        <section class="afp-framing-main"><article class="afp-summary-card"><span>이 사건에서 관측한 차이</span><h2 id="afp-framing-summary">같은 개편안이 절차, 효율, 심야 이동권이라는 서로 다른 문제로 읽혔다</h2><p>세 매체 모두 배차 간격 단축과 정류장 조정을 전했습니다. 그러나 해솔일보는 결정 과정의 공개성과 행정 책임을, 동해경제는 운송 효율과 예산을, 시민포커스는 외곽 주민과 교대노동자의 귀가 경로를 설명의 중심에 뒀습니다.</p><div class="afp-key-question"><span>핵심 비교 질문</span><strong id="afp-framing-question">같은 정책 변화라도 무엇을 ‘성과’ 또는 ‘손실’로 정의하는가에 따라, 필요한 해법과 확인할 정보가 달라지는가?</strong></div></article><div class="afp-outlet-tabs" role="group" aria-label="집중 매체 선택"><button type="button" data-outlet-filter="all" aria-pressed="true">전체 비교</button>${outlets.map((outlet) => `<button type="button" data-outlet-filter="${outlet.id}" aria-pressed="false">${outlet.name}</button>`).join("")}</div><article class="afp-axis-report"><header><h2>Entman 4기능과 발화권 비교</h2><p>자동 초안 · 대표 근거 3개 연결</p></header>${axisTableMarkup()}</article><article class="afp-evidence-zone" id="evidence"><header><h2>대표 근거 문장</h2><p>가상 기사 · 원문 재현 없음</p></header><div class="afp-evidence-grid">${evidenceCardsMarkup()}</div></article></section>
        <aside><article class="afp-review-card"><h2>분석 상태</h2><div class="afp-review-state">사람 검토가 필요한 초안</div><ul class="afp-review-list"><li><span>사건 동일성</span><b>날짜·정책 대상·발표 주체로 묶음</b></li><li><span>본문 근거</span><b>대표 근거 3개에 ID·문단 위치 연결</b></li><li><span>미관측 항목</span><b>임의 추론 대신 ‘명시되지 않음’</b></li><li><span>해석 범위</span><b>매체의 고정 성향이나 의도는 판정하지 않음</b></li></ul></article><article class="afp-question-card"><h2>이 결과에서 이어지는 질문</h2><p>비교 결과를 결론이 아니라 다음 취재 질문으로 연결합니다.</p><button type="button" data-follow-up><span>노선 산정자료는 공개 가능한가?</span><b>›</b></button><button type="button" data-follow-up><span>폐지 정류장의 추가 보행은 얼마인가?</span><b>›</b></button><button type="button" data-follow-up><span>시범운행의 중단 기준은 무엇인가?</span><b>›</b></button></article><article class="afp-inspector" tabindex="-1" aria-live="polite"><h2>선택한 근거</h2><div class="afp-inspector-meta"><span id="afp-inspector-id">H2</span><span id="afp-inspector-outlet">해솔일보</span><span id="afp-inspector-location">본문 5문단</span></div><h3 id="afp-inspector-title">시의회, 노선 산정자료 공개 요구</h3><blockquote id="afp-inspector-quote">${evidence.haesol.quote}</blockquote><dl><div><dt>관측 요소</dt><dd id="afp-inspector-axis">원인·책임</dd></div><div><dt>발화 주체</dt><dd id="afp-inspector-voice">가상 기자 서술</dd></div><div><dt>해석 경로</dt><dd id="afp-inspector-reason">${evidence.haesol.reason}</dd></div></dl></article></aside>
      </section>
      <section class="afp-deep"><header><div><h2 id="afp-deep-title">심화 분석</h2><p>핵심 결과를 읽은 뒤 필요할 때만 여는 보조 관찰값입니다. 이 값들은 매체의 의도나 고정 성향을 판정하지 않습니다.</p></div><span class="afp-badge">탐색용</span></header><div class="afp-tab-row" role="group" aria-label="심화 분석 항목"><button type="button" data-deep="expression" aria-pressed="true">표현 단서</button><button type="button" data-deep="voice" aria-pressed="false">취재원 구성</button><button type="button" data-deep="timeline" aria-pressed="false">시간 흐름</button></div><div class="afp-deep-panel" id="afp-deep-expression"><div class="afp-expression-grid">${outlets.map((outlet, index) => `<div><h3>${outlet.name}</h3><div class="afp-chip-cloud">${[["의견수렴 7", "공개 5", "절차 4"], ["탑승률 8", "효율 6", "예산 5"], ["퇴근 8", "도보 6", "외곽 5"]][index].map((word) => `<span>${word}</span>`).join("")}</div></div>`).join("")}</div><p class="afp-muted-note">동의어와 활용형을 묶어 2회 이상 관측된 가상 표현입니다. 빈도는 논조·영향력·정확성의 점수가 아닙니다.</p></div><div class="afp-deep-panel" id="afp-deep-voice" hidden><div class="afp-data-table-wrap"><table class="afp-voice-table"><thead><tr><th>매체</th><th>주요 발화자</th><th>확인된 발화</th><th>구성</th></tr></thead><tbody><tr><td>해솔일보</td><td>시청 5 · 시의회 3 · 이용자 2</td><td>11회</td><td><span class="afp-voice-bar"><i style="width:45%;background:#3f5c96"></i><i style="width:27%;background:#7353bc"></i><i style="width:18%;background:#147589"></i><i style="width:10%;background:#28715c"></i></span></td></tr><tr><td>동해경제</td><td>시청 4 · 전문가 3 · 운수업계 2</td><td>10회</td><td><span class="afp-voice-bar"><i style="width:40%;background:#3f5c96"></i><i style="width:30%;background:#28715c"></i><i style="width:20%;background:#a56600"></i><i style="width:10%;background:#147589"></i></span></td></tr><tr><td>시민포커스</td><td>이용자 6 · 노동자 3 · 시청 2</td><td>12회</td><td><span class="afp-voice-bar"><i style="width:50%;background:#147589"></i><i style="width:25%;background:#7353bc"></i><i style="width:17%;background:#3f5c96"></i><i style="width:8%;background:#28715c"></i></span></td></tr></tbody></table></div><p class="afp-muted-note">가상 기사에서 인용된 발화 횟수입니다. 발화자의 등장은 매체의 동의나 배제를 뜻하지 않습니다.</p></div><div class="afp-deep-panel" id="afp-deep-timeline" hidden><ol class="afp-timeline"><li><time>07.26 오전</time><strong>개편안 발표</strong><p>세 매체가 배차 단축과 정류장 조정을 공통 사실로 전함.</p></li><li><time>07.26 오후</time><strong>설명회 반응</strong><p>절차와 추가 보행 문제가 가상 기사에 등장함.</p></li><li><time>07.27</time><strong>시의회 검증</strong><p>자료 공개 요구가 행정 책임 질문으로 확장됨.</p></li><li><time>07.28</time><strong>시범운행 논의</strong><p>효율 지표와 보완 셔틀이 서로 다른 해법으로 제시됨.</p></li></ol><p class="afp-muted-note">최초 관측 시점은 해당 설명을 누가 만들었는지 판정하는 값이 아니라, 이번 가상 표본에서 처음 확인된 시점입니다.</p></div></section>
      <details class="afp-disclosure"><summary>이 보고서를 읽는 방법과 한계</summary><div class="afp-disclosure-body"><section><h3>포함한 방법</h3><ul><li>같은 정책 변화에 속하는 기사를 사건 단위로 묶습니다.</li><li>문제 정의 · 원인 해석 · 규범적 평가 · 해법 제시는 Entman의 네 기능을 참고한 비교 축입니다.</li><li>책임 귀인과 취재원 구성은 보조 축으로 따로 확인합니다.</li></ul></section><section><h3>여기서 멈춥니다</h3><ul><li>가상 사례이며 실제 보도나 언론사에 대한 평가가 아닙니다.</li><li>본문에서 확인되지 않은 요소는 명시되지 않음으로 남깁니다.</li><li>취재원의 발언은 해당 발화자에게 귀속하며 매체 주장으로 자동 변환하지 않습니다.</li></ul></section></div></details>${footerMarkup()}`;
  }

  function renderSelfCheck() {
    return `${pageHead("자가점검", "가상 기사를 읽으며 무엇이 강조되고 무엇이 빠졌는지 스스로 확인하는 5문항 시연입니다.", `<button class="afp-button" type="button" id="afp-check-reset">답변 초기화</button><a class="afp-button primary" href="framing.html">프레이밍 비교</a>`)}${scopeMarkup()}
      <section class="afp-check-layout"><div><div class="afp-check-progress"><strong>읽기 점검</strong><span class="afp-progress-track" aria-hidden="true"><i id="afp-check-progress-bar"></i></span><span id="afp-check-progress-text">0 / 5</span></div><form class="afp-check-form" id="afp-check-form">${selfCheckQuestions.map((question, questionIndex) => `<fieldset class="afp-question"><span>Q${questionIndex + 1}</span><legend>${question.label}</legend><div class="afp-choice-grid">${question.options.map((option, optionIndex) => `<label class="afp-choice"><input type="radio" name="${question.id}" value="${escapeHTML(option)}"><span>${option}</span></label>`).join("")}</div></fieldset>`).join("")}</form></div><aside class="afp-check-side"><article class="afp-card"><h2>지금까지의 읽기</h2><p>정답률이나 성향 점수를 만들지 않습니다. 선택한 답을 통해 다른 기사에서 추가로 확인할 질문을 남깁니다.</p><ul class="afp-selected-list" id="afp-selected-list"><li><b>아직 답변 없음</b>가상 기사에서 관측한 문제 정의와 근거 위치를 먼저 확인해 보세요.</li></ul></article><article class="afp-card"><h2>다음으로 확인할 관점</h2><p>기사 한 편에서 보이지 않는 관점은 결함으로 단정하지 말고, 다른 가상 기사와 비교하거나 자료 출처를 확인해 보세요.</p><a class="afp-link" href="outlets.html" style="display:inline-flex;margin-top:12px;font-size:11px;">언론사 비교로 이동 →</a></article><article class="afp-card"><h2>분석 경계</h2><p>이 자가점검은 가상 사례의 읽기 보조 도구입니다. 실제 기사·실제 독자·실제 매체에 대한 판정이나 진단을 제공하지 않습니다.</p></article></aside></section>${footerMarkup()}`;
  }

  function chatMessagesMarkup(messages) {
    return messages.map((message) => `<article class="afp-message ${message.role === "user" ? "user" : "assistant"}"><label>${message.role === "user" ? "나의 질문" : "AgendaFrame · 고정된 가상 응답"}</label><p>${escapeHTML(message.text)}</p>${message.evidence ? `<div class="afp-chat-evidence"><strong>${message.evidence.outlet} · ${message.evidence.id} · ${message.evidence.location}</strong><br>${escapeHTML(message.evidence.quote)}</div>` : ""}</article>`).join("");
  }

  function renderChat() {
    return `${pageHead("AI 대화", "가상 표본에 미리 연결한 근거 카드로 질문을 연습하는 화면입니다. 실제 생성형 AI나 외부 데이터 호출은 하지 않습니다.", `<a class="afp-button" href="framing.html">근거 매트릭스</a><button class="afp-button primary" type="button" id="afp-chat-clear">대화 초기화</button>`)}${scopeMarkup()}
      <section class="afp-chat-layout"><article class="afp-chat-card"><header><div><h2>해솔시 N-7 가상 표본 대화</h2><p>답변은 미리 작성한 가상 문장과 대표 근거 카드만 사용합니다.</p></div><span class="afp-badge synthetic">생성 없음</span></header><div class="afp-chat-log" id="afp-chat-log" aria-live="polite"></div><form class="afp-chat-form" id="afp-chat-form"><label class="afp-sr-only" for="afp-chat-input">가상 표본에 대한 질문</label><input id="afp-chat-input" type="text" maxlength="120" placeholder="예: 시민 피해를 드러낸 근거는?"><button class="afp-button primary" type="submit">질문 보내기</button></form></article><aside class="afp-chat-side"><article class="afp-card"><h2>추천 질문</h2><p>아래 질문을 누르면 해당 가상 답변과 대표 근거가 대화에 추가됩니다.</p><div class="afp-suggestion-list">${chatSuggestions.map((suggestion) => `<button type="button" data-chat-suggestion="${suggestion.id}"><span>${suggestion.label}</span><b>›</b></button>`).join("")}</div></article><article class="afp-card"><h2>근거 사용 원칙</h2><p>답변은 대표 근거 3개로 제한됩니다. 표본에서 확인되지 않은 사실은 추론하지 않고, 매체의 의도나 고정 성향을 판정하지 않습니다.</p><a class="afp-link" href="framing.html#evidence" style="display:inline-flex;margin-top:12px;font-size:11px;">대표 근거 보기 →</a></article></aside></section>${footerMarkup()}`;
  }

  function reportSectionsMarkup() {
    return `<div class="afp-report-sections" id="afp-report-sections"><section class="afp-report-section" data-report-section="summary"><h2>핵심 요약</h2><p>해솔시 N-7 개편은 배차 간격 단축과 정류장 조정을 포함한 가상 정책 변화다. 이 표본은 같은 사건을 절차·공개, 수요·효율, 심야 귀가 접근성이라는 서로 다른 질문으로 읽는 방식을 보여 준다.</p></section><section class="afp-report-section" data-report-section="indicators"><h2>의제 지표 스냅샷</h2><div class="afp-report-snaps"><div><span>가상 기사</span><b>9</b></div><div><span>가상 매체</span><b>3</b></div><div><span>비교 축</span><b>5</b></div><div><span>대표 근거</span><b>3</b></div></div></section><section class="afp-report-section" data-report-section="outlets"><h2>언론사 비교</h2><p>해솔일보는 결정 과정의 공개성과 검증을, 동해경제는 시간대별 수요와 운행비를, 시민포커스는 외곽 이용자의 귀가 경로를 중심에 뒀다. 이 비교는 가상 표본의 설명 차이를 정리한 것이며, 실제 언론사 성향 판정이 아니다.</p></section><section class="afp-report-section" data-report-section="framing"><h2>프레이밍 분석 요약</h2><p>문제 정의, 원인·책임, 평가, 해법, 발화권을 분리해 살펴보면 같은 개편안에서도 필요한 추가 정보가 달라진다. 대표 근거 3개에는 가상 기사 ID와 문단 위치가 연결된다.</p></section><section class="afp-report-section" data-report-section="check"><h2>자가점검 인사이트</h2><p>기사 한 편에서 보이지 않는 관점은 결함으로 단정하지 않는다. 다른 기사와 비교하고, 통계·일정·이해관계자의 위치를 추가로 확인하는 질문으로 남긴다.</p></section><section class="afp-report-section" data-report-section="limits"><h2>방법론 및 한계</h2><p>이 문서는 가상 사례 시연이다. 실제 보도·실제 매체·실제 독자에 대한 결론을 제공하지 않으며, 시간 순서나 표현 유사성만으로 영향 관계를 확정하지 않는다.</p></section></div>`;
  }

  function renderReport() {
    return `${pageHead("가상 사례 리포트", "포함할 항목과 가상 표본 범위를 선택하면 화면 안의 미리보기 구성이 갱신됩니다.", `<button class="afp-button" type="button" id="afp-report-copy">구성 메모 복사</button>`)}${scopeMarkup()}
      <section class="afp-report-layout"><article class="afp-card afp-report-preview"><header><div><h2>해솔시 심야버스 N-7 노선 개편</h2><p id="afp-report-meta">2026.07.26–07.28 · 가상 기사 9건 · 매체 3곳</p></div><span class="afp-badge synthetic">연구·브리핑용 시연</span></header>${reportSectionsMarkup()}<details class="afp-disclosure"><summary>이 리포트의 해석 경계</summary><div class="afp-disclosure-body"><section><h3>표시하는 것</h3><ul><li>가상 기사 표본 안에서 관측한 문제 정의와 대표 근거</li><li>기사 ID·가상 문단 위치·검토 전 상태</li><li>다음 취재를 위한 확인 질문</li></ul></section><section><h3>표시하지 않는 것</h3><ul><li>실제 언론사 성향, 편향, 영향력의 판정</li><li>실제 기사 원문이나 외부 통신 결과</li><li>시간 순서만으로 추정한 인과 관계</li></ul></section></div></details></article><aside class="afp-config"><h2>리포트 구성 설정</h2><p>체크와 라디오 선택은 이 브라우저 안의 미리보기만 바꿉니다.</p><div class="afp-config-group"><strong>포함 항목</strong>${[["summary", "핵심 요약"], ["indicators", "의제 지표 스냅샷"], ["outlets", "언론사 비교"], ["framing", "프레이밍 분석 요약"], ["check", "자가점검 인사이트"], ["limits", "방법론 및 한계"]].map(([value, label]) => `<label class="afp-config-choice"><input type="checkbox" name="report-section" value="${value}" checked><span>${label}</span></label>`).join("")}</div><div class="afp-config-group"><strong>기간</strong><label class="afp-config-choice"><input type="radio" name="report-period" value="3일" checked><span>7월 26일–28일</span></label><label class="afp-config-choice"><input type="radio" name="report-period" value="1일"><span>7월 26일 발표일만</span></label><label class="afp-config-choice"><input type="radio" name="report-period" value="전체"><span>가상 표본 전체</span></label></div><div class="afp-config-group"><strong>대상 매체</strong><label class="afp-config-choice"><input type="radio" name="report-outlet" value="전체 3곳" checked><span>전체 매체 3곳</span></label>${outlets.map((outlet) => `<label class="afp-config-choice"><input type="radio" name="report-outlet" value="${outlet.name}"><span>${outlet.name}만</span></label>`).join("")}</div><div class="afp-config-summary" id="afp-report-summary">6개 항목 · 3일 · 전체 매체 3곳을 포함합니다.</div><button type="button" class="afp-button primary" id="afp-report-copy-side">구성 메모 복사</button></aside></section>${footerMarkup()}`;
  }

  const renderers = {
    overview: renderOverview,
    issues: renderIssues,
    outlets: renderOutlets,
    framing: renderFraming,
    "self-check": renderSelfCheck,
    chat: renderChat,
    report: renderReport,
  };

  function showToast(message) {
    const toast = document.getElementById("afp-toast");
    if (!toast) return;
    toast.textContent = message;
    toast.hidden = false;
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => { toast.hidden = true; }, 2600);
  }

  async function copyText(text, successMessage) {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        throw new Error("clipboard unavailable");
      }
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.append(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
    }
    showToast(successMessage);
  }

  function initIssues() {
    const search = document.getElementById("afp-issue-search");
    const category = document.getElementById("afp-issue-category");
    const frame = document.getElementById("afp-issue-frame");
    const sort = document.getElementById("afp-issue-sort");
    const output = document.getElementById("afp-issue-results");
    const count = document.getElementById("afp-issue-count");
    const reset = document.getElementById("afp-issue-reset");

    const update = () => {
      const keyword = search.value.trim().toLowerCase();
      const filtered = issueCandidates.filter((issue) => {
        const text = `${issue.title} ${issue.category} ${issue.frame} ${issue.summary}`.toLowerCase();
        return (!keyword || text.includes(keyword)) && (category.value === "all" || issue.category === category.value) && (frame.value === "all" || issue.frame === frame.value);
      }).sort((left, right) => {
        if (sort.value === "recent") return right.update.localeCompare(left.update);
        if (sort.value === "outlets") return right.outlets - left.outlets || right.count - left.count;
        return right.count - left.count || right.outlets - left.outlets;
      });
      count.innerHTML = `<b>${filtered.length}</b>개의 가상 관련 묶음을 표시하고 있습니다.`;
      output.innerHTML = issueCardsMarkup(filtered);
    };
    [search, category, frame, sort].forEach((element) => element.addEventListener(element === search ? "input" : "change", update));
    reset.addEventListener("click", () => { search.value = ""; category.value = "all"; frame.value = "all"; sort.value = "coverage"; update(); search.focus(); });
    update();
  }

  function initOutlets() {
    const buttons = [...document.querySelectorAll("[data-outlet-filter]")];
    const summary = document.getElementById("afp-outlet-summary");
    const descriptions = {
      all: "같은 노선 개편을 절차·공개, 수요·효율, 접근성·귀가의 서로 다른 질문으로 읽은 가상 표본입니다.",
      haesol: "해솔일보의 가상 기사 3건을 강조합니다. 결정 과정의 공개성과 이용자 의견수렴이 중심 질문으로 관측됩니다.",
      donghae: "동해경제의 가상 기사 3건을 강조합니다. 시간대별 수요와 추가 운행비의 검증 조건이 중심 질문으로 관측됩니다.",
      citizen: "시민포커스의 가상 기사 3건을 강조합니다. 외곽 이용자와 교대노동자의 귀가 경로가 중심 질문으로 관측됩니다.",
    };
    const setOutlet = (outlet) => {
      buttons.forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.outletFilter === outlet)));
      document.querySelectorAll("[data-outlet-card], [data-outlet-cell]").forEach((element) => {
        const target = element.dataset.outletCard || element.dataset.outletCell;
        element.classList.toggle("is-muted", outlet !== "all" && target !== outlet);
        element.classList.toggle("is-selected", outlet !== "all" && target === outlet);
      });
      const label = outlet === "all" ? "전체 비교" : outlets.find((item) => item.id === outlet).name;
      summary.innerHTML = `<strong>${label}</strong> · ${descriptions[outlet]}`;
    };
    buttons.forEach((button) => button.addEventListener("click", () => setOutlet(button.dataset.outletFilter)));
  }

  function initFraming() {
    const outletButtons = [...document.querySelectorAll("[data-outlet-filter]")];
    const summaries = {
      all: ["같은 개편안이 절차, 효율, 심야 이동권이라는 서로 다른 문제로 읽혔다", "같은 정책 변화라도 무엇을 ‘성과’ 또는 ‘손실’로 정의하는가에 따라, 필요한 해법과 확인할 정보가 달라지는가?"],
      haesol: ["해솔일보는 결정 절차의 공개성과 검증을 핵심 문제로 읽었다", "노선 산정자료와 의견수렴 과정은 어떤 범위까지 공개됐는가?"],
      donghae: ["동해경제는 시간대별 수요와 운행비의 검증 조건을 중심에 뒀다", "추가 예산과 배차 개선은 실제 수요·운행비와 함께 확인되는가?"],
      citizen: ["시민포커스는 심야 귀가 선택지가 줄어드는 접근성 문제를 앞에 뒀다", "정류장 변경 뒤 특정 이용자의 추가 보행과 막차 연결은 어떻게 달라졌는가?"],
    };
    const setOutlet = (outlet) => {
      outletButtons.forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.outletFilter === outlet)));
      document.querySelectorAll("[data-outlet-card], [data-outlet-cell]").forEach((element) => {
        const target = element.dataset.outletCard || element.dataset.outletCell;
        element.classList.toggle("is-muted", outlet !== "all" && target !== outlet);
        element.classList.toggle("is-focused", outlet !== "all" && target === outlet);
      });
      document.getElementById("afp-framing-summary").textContent = summaries[outlet][0];
      document.getElementById("afp-framing-question").textContent = summaries[outlet][1];
    };
    outletButtons.forEach((button) => button.addEventListener("click", () => setOutlet(button.dataset.outletFilter)));

    const axisButtons = [...document.querySelectorAll("[data-axis]")];
    axisButtons.forEach((button) => button.addEventListener("click", () => {
      const axis = button.dataset.axis;
      axisButtons.forEach((item) => item.setAttribute("aria-pressed", String(item === button)));
      document.querySelectorAll("[data-axis-row]").forEach((row) => row.classList.toggle("is-highlighted", row.dataset.axisRow === axis));
      document.querySelector(`[data-axis-row="${axis}"]`)?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "nearest" });
    }));

    function showEvidence(outlet) {
      const item = evidence[outlet];
      document.getElementById("afp-inspector-id").textContent = item.id;
      document.getElementById("afp-inspector-outlet").textContent = item.outlet;
      document.getElementById("afp-inspector-location").textContent = item.location;
      document.getElementById("afp-inspector-title").textContent = item.title;
      document.getElementById("afp-inspector-quote").textContent = item.quote;
      document.getElementById("afp-inspector-axis").textContent = item.tag;
      document.getElementById("afp-inspector-voice").textContent = item.voice;
      document.getElementById("afp-inspector-reason").textContent = item.reason;
      const inspector = document.querySelector(".afp-inspector");
      if (window.matchMedia("(max-width: 1220px)").matches) inspector.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "nearest" });
      inspector.focus({ preventScroll: true });
    }
    document.querySelectorAll("[data-evidence]").forEach((button) => button.addEventListener("click", () => showEvidence(button.dataset.evidence)));
    document.querySelectorAll("[data-follow-up]").forEach((button) => button.addEventListener("click", () => copyText(button.textContent.replace("›", "").trim(), "후속 취재 질문을 복사했습니다.")));
    document.querySelector("[data-copy=\"framing\"]")?.addEventListener("click", () => copyText("AgendaFrame 가상 사례 프레이밍 검토 메모\n\n공통 사실 → 갈린 질문 → Entman 4기능 → 대표 근거 → 해석 경계\n\n확인 필요: 실제 데이터에서는 기사 ID, 근거 위치, 분석 버전, 사람 검토 상태를 함께 보존합니다.", "검토 메모를 복사했습니다."));

    const deepButtons = [...document.querySelectorAll("[data-deep]")];
    deepButtons.forEach((button) => button.addEventListener("click", () => {
      const target = button.dataset.deep;
      deepButtons.forEach((item) => item.setAttribute("aria-pressed", String(item === button)));
      document.querySelectorAll(".afp-deep-panel").forEach((panel) => { panel.hidden = panel.id !== `afp-deep-${target}`; });
    }));
  }

  function initSelfCheck() {
    const form = document.getElementById("afp-check-form");
    const progress = document.getElementById("afp-check-progress-text");
    const progressBar = document.getElementById("afp-check-progress-bar");
    const output = document.getElementById("afp-selected-list");
    const reset = document.getElementById("afp-check-reset");
    const update = () => {
      const answers = selfCheckQuestions.map((question) => ({ question, input: form.querySelector(`input[name="${question.id}"]:checked`) })).filter((entry) => entry.input);
      progress.textContent = `${answers.length} / ${selfCheckQuestions.length}`;
      progressBar.style.width = `${(answers.length / selfCheckQuestions.length) * 100}%`;
      output.innerHTML = answers.length ? answers.map((entry) => `<li><b>${entry.question.label}</b>${escapeHTML(entry.input.value)}</li>`).join("") : `<li><b>아직 답변 없음</b>가상 기사에서 관측한 문제 정의와 근거 위치를 먼저 확인해 보세요.</li>`;
      if (answers.length === selfCheckQuestions.length) showToast("5개 질문을 모두 확인했습니다. 다른 매체와 근거 위치를 비교해 보세요.");
    };
    form.addEventListener("change", update);
    reset.addEventListener("click", () => { form.reset(); update(); });
  }

  function initChat() {
    const log = document.getElementById("afp-chat-log");
    const form = document.getElementById("afp-chat-form");
    const input = document.getElementById("afp-chat-input");
    const clear = document.getElementById("afp-chat-clear");
    const messages = [
      { role: "user", text: "같은 개편안을 두고 가상 매체들은 무엇을 다르게 보았나요?" },
      { role: "assistant", text: "해솔일보는 공개성과 절차, 동해경제는 수요와 비용, 시민포커스는 심야 귀가 접근성을 설명의 중심에 뒀습니다. 이는 가상 표본에서 관측한 질문의 차이이며, 매체의 의도나 고정 성향을 판정한 결과가 아닙니다.", evidence: evidence.haesol },
    ];
    const render = () => { log.innerHTML = chatMessagesMarkup(messages); log.scrollTop = log.scrollHeight; };
    const addSuggestion = (suggestion) => { messages.push({ role: "user", text: suggestion.label }); messages.push({ role: "assistant", text: suggestion.response, evidence: evidence[suggestion.evidence] }); render(); };
    document.querySelectorAll("[data-chat-suggestion]").forEach((button) => button.addEventListener("click", () => addSuggestion(chatSuggestions.find((item) => item.id === button.dataset.chatSuggestion))));
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const question = input.value.trim();
      if (!question) { input.focus(); return; }
      const normalized = question.toLowerCase();
      const suggestion = chatSuggestions.find((item) => normalized.includes("책임") ? item.id === "responsibility" : normalized.includes("피해") || normalized.includes("시민") ? item.id === "citizen" : normalized.includes("효율") || normalized.includes("예산") || normalized.includes("수요") ? item.id === "efficiency" : false);
      messages.push({ role: "user", text: question });
      if (suggestion) {
        messages.push({ role: "assistant", text: suggestion.response, evidence: evidence[suggestion.evidence] });
      } else {
        messages.push({ role: "assistant", text: "이 프로토타입은 미리 준비된 세 가지 가상 질문만 답합니다. 책임·시민 피해·효율 중 하나를 포함해 다시 질문하거나, 오른쪽 추천 질문을 선택해 보세요.", evidence: evidence.haesol });
      }
      input.value = "";
      render();
    });
    clear.addEventListener("click", () => { messages.splice(0, messages.length); messages.push({ role: "assistant", text: "대화를 초기화했습니다. 오른쪽 추천 질문이나 직접 입력으로 가상 표본을 살펴보세요.", evidence: evidence.haesol }); render(); });
    render();
  }

  function initReport() {
    const sections = [...document.querySelectorAll('input[name="report-section"]')];
    const periods = [...document.querySelectorAll('input[name="report-period"]')];
    const outletChoices = [...document.querySelectorAll('input[name="report-outlet"]')];
    const summary = document.getElementById("afp-report-summary");
    const meta = document.getElementById("afp-report-meta");
    const update = () => {
      const selected = sections.filter((item) => item.checked).map((item) => item.value);
      document.querySelectorAll("[data-report-section]").forEach((section) => { section.hidden = !selected.includes(section.dataset.reportSection); });
      const period = periods.find((item) => item.checked).value;
      const outlet = outletChoices.find((item) => item.checked).value;
      summary.textContent = `${selected.length}개 항목 · ${period} · ${outlet}을 포함합니다.`;
      meta.textContent = `${period === "1일" ? "2026.07.26" : period === "전체" ? "가상 표본 전체 기간" : "2026.07.26–07.28"} · 가상 기사 ${outlet === "전체 3곳" ? "9건" : "3건"} · ${outlet}`;
    };
    const copy = () => {
      const selectedLabels = sections.filter((item) => item.checked).map((item) => item.parentElement.textContent.trim());
      const period = periods.find((item) => item.checked).parentElement.textContent.trim();
      const outlet = outletChoices.find((item) => item.checked).parentElement.textContent.trim();
      copyText(`AgendaFrame 가상 사례 리포트 구성\n\n포함 항목: ${selectedLabels.join(", ")}\n기간: ${period}\n대상 매체: ${outlet}\n\n이 구성은 가상 사례 시연이며 실제 분석 결과가 아닙니다.`, "리포트 구성 메모를 복사했습니다.");
    };
    [...sections, ...periods, ...outletChoices].forEach((input) => input.addEventListener("change", update));
    document.getElementById("afp-report-copy").addEventListener("click", copy);
    document.getElementById("afp-report-copy-side").addEventListener("click", copy);
    update();
  }

  const app = document.getElementById("afp-app");
  if (!app || !renderers[page]) return;
  app.innerHTML = shell(renderers[page]());

  if (page === "issues") initIssues();
  if (page === "outlets") initOutlets();
  if (page === "framing") initFraming();
  if (page === "self-check") initSelfCheck();
  if (page === "chat") initChat();
  if (page === "report") initReport();
})();
