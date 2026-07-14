const frameMeta = {
  conflict: { label: "갈등·논쟁", color: "#d64b70" },
  responsibility: { label: "책임 소재", color: "#7058a3" },
  economy: { label: "경제·생활", color: "#bf7b20" },
  law: { label: "법·제도", color: "#315da8" },
  policy: { label: "정책 효과", color: "#11745b" },
  citizen: { label: "시민 영향", color: "#248b9e" },
};

const issues = [
  {
    id: "youth-housing",
    rank: 1,
    category: "사회",
    title: "청년 주거 지원 확대안, 공급 방식과 재원 논의 본격화",
    summary: "청년 대상 공공임대와 보증금 지원 확대 방안을 두고 주요 매체가 재원, 공급 속도, 실제 수혜 범위를 서로 다르게 강조했습니다.",
    score: 92.4,
    change: 4.8,
    mediaCount: 5,
    articleCount: 18,
    repeated: 4,
    confidence: 91,
    scoreParts: [
      { name: "언론사 다양성", value: 100 },
      { name: "홈페이지 배치", value: 94 },
      { name: "기사 수", value: 88 },
      { name: "반복 노출", value: 76 },
    ],
    frames: { conflict: 18, responsibility: 24, economy: 19, law: 11, policy: 16, citizen: 12 },
    outlets: [
      { name: "한빛일보", count: 5, placement: "TOP", headline: "청년 주거 지원 확대…관건은 속도와 공급", accents: ["속도", "공급"] },
      { name: "새로신문", count: 4, placement: "MAIN", headline: "정부 주거안, 청년 체감까지 이어질까", accents: ["체감"] },
      { name: "포커스경제", count: 3, placement: "MAIN", headline: "보증금 지원 확대, 재원 조달 방식 주목", accents: ["재원 조달"] },
      { name: "정책저널", count: 3, placement: "SECTION", headline: "공공임대 확대안의 법·제도 과제", accents: ["법·제도"] },
      { name: "프레스온", count: 3, placement: "SECTION", headline: "청년들이 묻는 실제 입주 시점과 조건", accents: ["입주 시점"] },
    ],
    evidence: [
      { frame: "responsibility", outlet: "한빛일보", confidence: 94, quote: "사업 속도를 좌우할 실행 주체와 공급 일정이 함께 제시돼야 한다." },
      { frame: "responsibility", outlet: "새로신문", confidence: 89, quote: "정책 발표보다 실제 입주까지의 행정 책임을 분명히 해야 한다." },
      { frame: "economy", outlet: "포커스경제", confidence: 93, quote: "보증금 지원 확대에 필요한 재원을 어떤 방식으로 확보할지가 핵심이다." },
      { frame: "citizen", outlet: "프레스온", confidence: 90, quote: "청년이 체감하는 변화는 지원 금액보다 입주 가능 시점에서 갈릴 수 있다." },
      { frame: "law", outlet: "정책저널", confidence: 87, quote: "기존 주거 지원 사업과의 중복을 줄이는 제도 정비가 선행돼야 한다." },
      { frame: "conflict", outlet: "새로신문", confidence: 83, quote: "공급 확대와 재정 부담을 둘러싼 시각차가 본격적인 쟁점으로 떠올랐다." },
      { frame: "policy", outlet: "정책저널", confidence: 92, quote: "지원 대상 기준을 세분화해야 정책 효과를 필요한 계층에 집중할 수 있다." },
    ],
    report: {
      main: "다섯 매체 모두 지원 확대 자체보다 실행 가능성을 중심에 두었습니다. 한빛일보와 새로신문은 공급 속도와 책임 주체를, 포커스경제는 재원 조달을 상대적으로 크게 다뤘습니다.",
      missing: "법·제도 프레임은 전체의 11%로 가장 적었습니다. 기존 사업과의 중복, 지자체 집행 기준을 다룬 보도는 제한적이었습니다.",
      caution: "특정 방향의 편향으로 단정하기는 어렵습니다. 다만 발표 당일 기사들이 공급 물량과 재원 논쟁에 집중해 실제 수혜 조건은 상대적으로 덜 다뤄졌습니다.",
    },
    articles: [
      { outlet: "한빛일보", title: "청년 주거 지원 확대…관건은 속도와 공급", publishedAt: "17:42", collectedAt: "18:00", placement: "TOP" },
      { outlet: "새로신문", title: "정부 주거안, 청년 체감까지 이어질까", publishedAt: "16:58", collectedAt: "18:00", placement: "MAIN" },
      { outlet: "포커스경제", title: "보증금 지원 확대, 재원 조달 방식 주목", publishedAt: "15:31", collectedAt: "18:00", placement: "MAIN" },
      { outlet: "정책저널", title: "공공임대 확대안의 법·제도 과제", publishedAt: "14:26", collectedAt: "18:00", placement: "SECTION" },
      { outlet: "프레스온", title: "청년들이 묻는 실제 입주 시점과 조건", publishedAt: "13:48", collectedAt: "18:00", placement: "SECTION" },
    ],
  },
  {
    id: "energy-grid",
    rank: 2,
    category: "산업정책",
    title: "재생에너지 전력망 투자 계획, 지역 수용성과 비용이 쟁점",
    summary: "전력망 보강 계획을 두고 산업 경쟁력과 지역 부담, 사업비 조달을 둘러싼 보도 프레임이 나뉘었습니다.",
    score: 87.9,
    change: 2.1,
    mediaCount: 5,
    articleCount: 15,
    repeated: 3,
    confidence: 88,
    scoreParts: [
      { name: "언론사 다양성", value: 100 },
      { name: "홈페이지 배치", value: 86 },
      { name: "기사 수", value: 79 },
      { name: "반복 노출", value: 68 },
    ],
    frames: { conflict: 28, responsibility: 13, economy: 25, law: 14, policy: 16, citizen: 4 },
    outlets: [
      { name: "한빛일보", count: 4, placement: "MAIN", headline: "전력망 투자 속도전…지역 협의가 변수", accents: ["지역 협의"] },
      { name: "새로신문", count: 3, placement: "TOP", headline: "전력망 확충, 주민 부담과 국가 과제 사이", accents: ["주민 부담"] },
      { name: "포커스경제", count: 4, placement: "MAIN", headline: "대규모 전력망 투자, 산업 경쟁력의 기반", accents: ["산업 경쟁력"] },
      { name: "정책저널", count: 2, placement: "SECTION", headline: "전력망 특별법 이후 남은 제도 과제", accents: ["제도 과제"] },
      { name: "프레스온", count: 2, placement: "LIST", headline: "송전망 계획에 지역 목소리는 어떻게 담기나", accents: ["지역 목소리"] },
    ],
    evidence: [
      { frame: "conflict", outlet: "새로신문", confidence: 91, quote: "국가 차원의 전력망 확충 필요성과 지역 주민의 부담 사이에서 해법을 찾아야 한다." },
      { frame: "conflict", outlet: "한빛일보", confidence: 86, quote: "사업 속도를 높이려는 정부와 충분한 협의를 요구하는 지역의 입장이 맞서고 있다." },
      { frame: "economy", outlet: "포커스경제", confidence: 94, quote: "안정적인 전력망은 첨단 제조업 투자를 끌어오는 핵심 기반으로 꼽힌다." },
      { frame: "law", outlet: "정책저널", confidence: 89, quote: "특별법 시행 이후에도 보상과 인허가 기준을 구체화해야 한다." },
      { frame: "responsibility", outlet: "프레스온", confidence: 82, quote: "중앙정부와 사업자가 주민 설명과 사후 지원의 책임을 나눠야 한다." },
      { frame: "policy", outlet: "한빛일보", confidence: 88, quote: "투자 계획이 실제 계통 접속 지연을 얼마나 줄일지가 정책 효과의 기준이다." },
      { frame: "citizen", outlet: "프레스온", confidence: 78, quote: "주민 생활권 변화와 장기적인 지역 지원 방안이 함께 논의돼야 한다." },
    ],
    report: {
      main: "경제·생활과 갈등 프레임이 절반 이상을 차지했습니다. 포커스경제는 산업 기반을, 새로신문과 한빛일보는 지역 협의와 사업 속도의 긴장을 강조했습니다.",
      missing: "시민 영향 프레임은 4%로 드물었습니다. 송전망 주변 주민의 일상 변화나 장기 지원에 대한 구체적인 설명이 부족했습니다.",
      caution: "대부분의 보도가 투자 규모와 갈등 구도에 집중했습니다. 사업 지역의 장기적 편익과 부담을 함께 비교할 추가 자료가 필요합니다.",
    },
    articles: [
      { outlet: "새로신문", title: "전력망 확충, 주민 부담과 국가 과제 사이", publishedAt: "17:18", collectedAt: "18:00", placement: "TOP" },
      { outlet: "포커스경제", title: "대규모 전력망 투자, 산업 경쟁력의 기반", publishedAt: "16:43", collectedAt: "18:00", placement: "MAIN" },
      { outlet: "한빛일보", title: "전력망 투자 속도전…지역 협의가 변수", publishedAt: "15:52", collectedAt: "18:00", placement: "MAIN" },
      { outlet: "정책저널", title: "전력망 특별법 이후 남은 제도 과제", publishedAt: "14:10", collectedAt: "18:00", placement: "SECTION" },
    ],
  },
  {
    id: "essential-care",
    rank: 3,
    category: "복지",
    title: "지역 필수의료 지원책 발표, 인력 확보 책임에 보도 집중",
    summary: "지역 의료 인력과 응급 진료 공백을 줄이기 위한 지원책을 두고 정부, 지자체, 병원의 역할이 주요 쟁점으로 다뤄졌습니다.",
    score: 84.7,
    change: 1.4,
    mediaCount: 4,
    articleCount: 13,
    repeated: 3,
    confidence: 90,
    scoreParts: [
      { name: "언론사 다양성", value: 80 },
      { name: "홈페이지 배치", value: 89 },
      { name: "기사 수", value: 74 },
      { name: "반복 노출", value: 70 },
    ],
    frames: { conflict: 14, responsibility: 29, economy: 11, law: 12, policy: 18, citizen: 16 },
    outlets: [
      { name: "한빛일보", count: 4, placement: "TOP", headline: "필수의료 대책, 결국 사람을 남게 할 수 있나", accents: ["사람"] },
      { name: "새로신문", count: 3, placement: "MAIN", headline: "응급실 공백, 누가 책임지고 메울 것인가", accents: ["누가 책임"] },
      { name: "포커스경제", count: 2, placement: "SECTION", headline: "지역 의료 지원금, 지속 가능한 재원 필요", accents: ["지속 가능한 재원"] },
      { name: "정책저널", count: 4, placement: "MAIN", headline: "지자체·병원 역할 담은 필수의료 지원안", accents: ["역할"] },
      { name: "프레스온", count: 0, placement: "미보도", headline: "해당 시점 홈페이지 관련 보도 없음", accents: [] },
    ],
    evidence: [
      { frame: "responsibility", outlet: "새로신문", confidence: 95, quote: "인력 부족을 병원만의 문제로 둘 수 없으며 정부와 지자체의 책임이 함께 제시돼야 한다." },
      { frame: "responsibility", outlet: "정책저널", confidence: 92, quote: "지역별 인력 배치와 지원금 집행에서 지자체의 역할이 커진다." },
      { frame: "citizen", outlet: "한빛일보", confidence: 91, quote: "환자가 거주 지역에 따라 응급 진료 기회를 달리 받아서는 안 된다." },
      { frame: "economy", outlet: "포커스경제", confidence: 87, quote: "단기 지원금보다 의료 인력이 머무를 수 있는 지속 가능한 재원 구조가 필요하다." },
      { frame: "policy", outlet: "정책저널", confidence: 89, quote: "성과는 지원 병원 수보다 실제 진료 공백 감소로 평가해야 한다." },
      { frame: "law", outlet: "정책저널", confidence: 82, quote: "의료인력 배치와 권역 협력 체계를 뒷받침할 제도 정비가 요구된다." },
      { frame: "conflict", outlet: "새로신문", confidence: 79, quote: "의무 배치와 자율 선택을 둘러싼 의료계의 이견이 남아 있다." },
    ],
    report: {
      main: "책임 소재 프레임이 29%로 가장 컸습니다. 정부·지자체·병원 중 누가 의료 인력 확보와 공백 해소를 맡아야 하는지가 공통적인 보도 축이었습니다.",
      missing: "경제 프레임은 11%에 그쳤습니다. 장기 재원과 지역 근무 여건의 비용 구조를 다룬 설명은 제한적이었습니다.",
      caution: "정책 발표 직후라 실행 결과를 판단하기 어렵습니다. 향후 실제 응급 진료 시간과 인력 유지율을 함께 확인해야 합니다.",
    },
    articles: [
      { outlet: "한빛일보", title: "필수의료 대책, 결국 사람을 남게 할 수 있나", publishedAt: "17:25", collectedAt: "18:00", placement: "TOP" },
      { outlet: "정책저널", title: "지자체·병원 역할 담은 필수의료 지원안", publishedAt: "16:12", collectedAt: "18:00", placement: "MAIN" },
      { outlet: "새로신문", title: "응급실 공백, 누가 책임지고 메울 것인가", publishedAt: "15:09", collectedAt: "18:00", placement: "MAIN" },
      { outlet: "포커스경제", title: "지역 의료 지원금, 지속 가능한 재원 필요", publishedAt: "13:37", collectedAt: "18:00", placement: "SECTION" },
    ],
  },
  {
    id: "semiconductor-talent",
    rank: 4,
    category: "경제",
    title: "반도체 인력 양성 계획, 산업 효과와 교육 현장 부담 교차",
    summary: "첨단산업 인재 양성 확대를 두고 기업 경쟁력 기대와 대학 교육 여건, 지역 간 격차가 함께 조명됐습니다.",
    score: 79.5,
    change: -0.7,
    mediaCount: 4,
    articleCount: 11,
    repeated: 2,
    confidence: 86,
    scoreParts: [
      { name: "언론사 다양성", value: 80 },
      { name: "홈페이지 배치", value: 77 },
      { name: "기사 수", value: 69 },
      { name: "반복 노출", value: 55 },
    ],
    frames: { conflict: 12, responsibility: 17, economy: 31, law: 9, policy: 24, citizen: 7 },
    outlets: [
      { name: "한빛일보", count: 3, placement: "MAIN", headline: "반도체 인재 10만 명, 교육 현장이 받쳐줄까", accents: ["교육 현장"] },
      { name: "새로신문", count: 2, placement: "SECTION", headline: "첨단산업 인력 계획에 지역대학은 어디에", accents: ["지역대학"] },
      { name: "포커스경제", count: 4, placement: "TOP", headline: "반도체 인력 확대, 투자 경쟁의 새 기반", accents: ["투자 경쟁"] },
      { name: "정책저널", count: 2, placement: "SECTION", headline: "인력 양성 정책, 숫자보다 취업 연계가 관건", accents: ["취업 연계"] },
      { name: "프레스온", count: 0, placement: "미보도", headline: "해당 시점 홈페이지 관련 보도 없음", accents: [] },
    ],
    evidence: [
      { frame: "economy", outlet: "포커스경제", confidence: 94, quote: "전문 인력 공급은 글로벌 투자 유치와 생산시설 확장의 전제 조건이다." },
      { frame: "policy", outlet: "정책저널", confidence: 91, quote: "양성 인원보다 산업 현장 취업과 장기 정착률로 정책 효과를 확인해야 한다." },
      { frame: "responsibility", outlet: "한빛일보", confidence: 84, quote: "정원 확대에 필요한 교수와 실습 장비를 누가 확보할지가 남은 과제다." },
      { frame: "conflict", outlet: "새로신문", confidence: 81, quote: "수도권 집중과 지역대학 육성 목표가 동시에 달성될 수 있는지 논쟁이 이어진다." },
      { frame: "citizen", outlet: "새로신문", confidence: 77, quote: "지역 학생이 실제 교육과 취업 기회에 접근할 수 있는 경로가 필요하다." },
      { frame: "law", outlet: "정책저널", confidence: 80, quote: "학과 정원과 산학협력 기준을 유연하게 적용할 제도 보완이 요구된다." },
    ],
    report: {
      main: "경제·생활과 정책 효과 프레임이 55%를 차지했습니다. 포커스경제는 투자 경쟁력을, 한빛일보와 새로신문은 교육 여건과 지역 격차를 강조했습니다.",
      missing: "시민 영향 프레임은 7%였습니다. 학생의 교육 선택권과 취업 이동 비용에 관한 보도는 상대적으로 적었습니다.",
      caution: "정책 목표 수치가 크게 부각됐지만 실제 교수 인력, 실습 환경, 취업 연계 성과는 아직 확인되지 않았습니다.",
    },
    articles: [
      { outlet: "포커스경제", title: "반도체 인력 확대, 투자 경쟁의 새 기반", publishedAt: "16:46", collectedAt: "18:00", placement: "TOP" },
      { outlet: "한빛일보", title: "반도체 인재 10만 명, 교육 현장이 받쳐줄까", publishedAt: "15:22", collectedAt: "18:00", placement: "MAIN" },
      { outlet: "새로신문", title: "첨단산업 인력 계획에 지역대학은 어디에", publishedAt: "14:37", collectedAt: "18:00", placement: "SECTION" },
      { outlet: "정책저널", title: "인력 양성 정책, 숫자보다 취업 연계가 관건", publishedAt: "12:54", collectedAt: "18:00", placement: "SECTION" },
    ],
  },
];

const state = {
  category: "전체",
  selectedId: issues[0].id,
  tab: "outlets",
  frame: "responsibility",
  articleSort: "latest",
  liveOffset: 0,
  liveLimit: 50,
  liveTotal: 0,
  liveLoaded: 0,
  liveLoading: false,
};

const categories = ["전체", "정치", "경제", "사회", "복지", "산업정책"];
const $ = (selector, root = document) => root.querySelector(selector);
const escapeHtml = (value) => String(value).replace(/[&<>"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character]);
const placementLabels = { top: "TOP", main: "MAIN", section: "SECTION", list: "LIST" };

function formatKoreanDateTime(value) {
  const date = new Date(Number(value));
  if (!Number.isFinite(date.getTime())) return "시각 미확인";
  return new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(date);
}

function renderTodayDate() {
  $("#hero-date").textContent = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()).replace(/\. /g, ".").replace(/\.$/, "");
}

function highlight(text, words) {
  let result = escapeHtml(text);
  for (const word of words) {
    result = result.replace(escapeHtml(word), `<mark>${escapeHtml(word)}</mark>`);
  }
  return result;
}

function getSelectedIssue() {
  return issues.find((issue) => issue.id === state.selectedId) ?? issues[0];
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("show"), 2400);
}

async function refreshCollectionStatus({ announce = false } = {}) {
  try {
    const response = await fetch("/api/health", { headers: { accept: "application/json" }, cache: "no-store" });
    if (!response.ok) throw new Error("status unavailable");
    const health = await response.json();
    const collection = health.collection ?? {};
    $("#source-count").textContent = String(collection.configuredSources ?? 5);

    if (health.mode === "metadata" && Number(collection.articleCount) > 0) {
      $("#article-count").textContent = Number(collection.articleCount).toLocaleString("ko-KR");
      $("#article-count-note").textContent = "실제 메타데이터";
      $("#collection-status").textContent = "업로드 완료";
      $("#collection-status").style.color = "var(--green)";
      $("#collection-status-note").textContent = `${collection.latestSourceCount ?? 0}/5 매체 · 중복 제외`;
      $("#data-badge").innerHTML = `<i aria-hidden="true"></i> 실기사 메타데이터 연결`;
      $("#data-badge").classList.add("live");
      if (health.dataAsOf) {
        const observedAt = new Date(health.dataAsOf);
        $("#snapshot-time").textContent = `${observedAt.toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })} 확인`;
      }
      if (announce) showToast(`실데이터 ${collection.articleCount}건이 저장되어 있습니다.`);
      return;
    }

    $("#collection-status").textContent = "CSV 준비";
    $("#collection-status").style.color = "var(--amber)";
    $("#collection-status-note").textContent = "관리자 업로드 대기";
    $("#data-badge").innerHTML = `<i aria-hidden="true"></i> 시연용 합성 데이터`;
    $("#data-badge").classList.remove("live");
    if (announce) showToast("아직 업로드된 실데이터가 없습니다.");
  } catch {
    if (announce) showToast("수집 상태를 확인하지 못했습니다.");
  }
}

function liveArticleMarkup(article) {
  const placement = placementLabels[article.homepagePlacement] ?? "배치 미확인";
  const rank = article.homepageRank ? ` · 관측 ${article.homepageRank}위` : "";
  return `<article class="live-article">
    <div class="live-article-meta"><span class="live-source">${escapeHtml(article.source)}</span><span>${escapeHtml(article.section ?? "분야 미분류")}</span></div>
    <h3><a href="${escapeHtml(article.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(article.title)}</a></h3>
    <p class="live-article-detail">게시 ${formatKoreanDateTime(article.publishedAt)}<br />홈페이지 ${placement}${rank}</p>
    <a class="live-original" href="${escapeHtml(article.url)}" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(article.source)} 원문 기사 열기">원문 기사 보기 ↗</a>
  </article>`;
}

function liveFilterParameters() {
  const form = $("#live-filter-form");
  const values = new FormData(form);
  const parameters = new URLSearchParams();
  for (const key of ["q", "source", "section", "date"]) {
    const value = String(values.get(key) ?? "").trim();
    if (value) parameters.set(key, value);
  }
  return parameters;
}

async function refreshLiveArticles({ append = false, announce = false } = {}) {
  const section = $("#live-feed");
  if (state.liveLoading) return;
  state.liveLoading = true;
  const loadMore = $("#live-load-more");
  loadMore.disabled = true;
  try {
    if (!append) {
      state.liveOffset = 0;
      state.liveLoaded = 0;
    }
    const parameters = liveFilterParameters();
    const hasActiveFilters = parameters.size > 0;
    parameters.set("limit", String(state.liveLimit));
    parameters.set("offset", String(state.liveOffset));
    const response = await fetch(`/api/articles?${parameters}`, { headers: { accept: "application/json" }, cache: "no-store" });
    if (!response.ok) throw new Error("articles unavailable");
    const payload = await response.json();
    const articles = Array.isArray(payload.articles) ? payload.articles : [];
    const total = Number(payload.total) || 0;
    if (!articles.length && !append && !hasActiveFilters) {
      section.hidden = true;
      return;
    }

    section.hidden = false;
    const list = $("#live-article-list");
    const markup = articles.map(liveArticleMarkup).join("");
    if (append) list.insertAdjacentHTML("beforeend", markup);
    else list.innerHTML = markup;
    state.liveLoaded = append ? state.liveLoaded + articles.length : articles.length;
    state.liveOffset = state.liveLoaded;
    state.liveTotal = total;
    $("#live-feed-note").textContent = `${state.liveLoaded.toLocaleString("ko-KR")} / ${total.toLocaleString("ko-KR")}건 · 실제 게시순`;
    $("#live-empty").hidden = state.liveLoaded > 0;
    loadMore.hidden = !(payload.hasMore && articles.length);
    $("#data-disclosure").textContent = "위 실제 기사 링크는 운영 DB 메타데이터이며, 아래 의제·프레임 분석은 제품 검증용 합성 데이터입니다.";
    if (announce) showToast(total ? `조건에 맞는 실제 기사 ${total.toLocaleString("ko-KR")}건입니다.` : "조건에 맞는 기사가 없습니다.");
  } catch {
    if (announce) showToast("실제 기사 목록을 불러오지 못했습니다.");
  } finally {
    state.liveLoading = false;
    loadMore.disabled = false;
  }
}

function renderFilters() {
  const root = $("#category-filters");
  root.innerHTML = categories.map((category) => `<button type="button" class="filter-pill${state.category === category ? " active" : ""}" data-category="${escapeHtml(category)}" aria-pressed="${state.category === category}">${escapeHtml(category)}</button>`).join("");
}

function renderRanking() {
  const filtered = state.category === "전체" ? issues : issues.filter((issue) => issue.category === state.category);
  const root = $("#agenda-list");
  if (!filtered.length) {
    root.innerHTML = `<div class="empty-state"><strong>${escapeHtml(state.category)}</strong> 분야의 상위 의제가 아직 없습니다.</div>`;
    return;
  }
  if (!filtered.some((issue) => issue.id === state.selectedId)) {
    state.selectedId = filtered[0].id;
  }
  root.innerHTML = filtered.map((issue) => `
    <button type="button" class="agenda-card${issue.id === state.selectedId ? " active" : ""}" data-issue="${issue.id}" aria-pressed="${issue.id === state.selectedId}">
      <span class="agenda-rank">${issue.rank}</span>
      <span class="agenda-copy"><span class="agenda-meta"><b class="category-tag">${escapeHtml(issue.category)}</b>${issue.mediaCount}개 언론사 · ${issue.articleCount}건</span><strong>${escapeHtml(issue.title)}</strong><small>반복 노출 ${issue.repeated}회 · 분석 신뢰도 ${issue.confidence}%</small></span>
      <span class="agenda-score"><strong>${issue.score.toFixed(1)}</strong><small>${issue.change >= 0 ? "▲" : "▼"} ${Math.abs(issue.change).toFixed(1)}</small></span>
    </button>`).join("");
}

function renderScoreBreakdown(issue) {
  return `<div class="score-breakdown" aria-label="의제 점수 구성">${issue.scoreParts.map((part) => `<div class="score-part"><header><span>${escapeHtml(part.name)}</span><b>${part.value}</b></header><div class="score-track"><i style="width:${part.value}%"></i></div></div>`).join("")}</div>`;
}

function renderOutlets(issue) {
  return `
    <div class="analysis-heading"><h3>언론사별 보도 비교</h3><p>수집 시점의 홈페이지 기준</p></div>
    <div class="outlet-table" role="table" aria-label="언론사별 보도 비교">
      ${issue.outlets.map((outlet) => `<div class="outlet-row" role="row"><span class="outlet-name">${escapeHtml(outlet.name)}</span><span class="outlet-count">${outlet.count ? `${outlet.count}건` : "0건"}</span><span class="placement${outlet.count ? "" : " none"}">${escapeHtml(outlet.placement)}</span><span class="headline">${highlight(outlet.headline, outlet.accents)}</span></div>`).join("")}
    </div>`;
}

function renderFrames(issue) {
  const evidence = issue.evidence.filter((item) => item.frame === state.frame);
  return `
    <div class="analysis-heading"><h3>6종 프레임 분포</h3><p>복수 프레임을 100% 비중으로 환산</p></div>
    <div class="frame-layout">
      <div class="frame-bars">${Object.entries(frameMeta).map(([key, meta]) => `<div class="frame-row"><button type="button" class="${state.frame === key ? "active" : ""}" data-frame="${key}" aria-pressed="${state.frame === key}">${meta.label}</button><div class="frame-bar"><i style="width:${issue.frames[key]}%;background:${meta.color}"></i></div><strong>${issue.frames[key]}%</strong></div>`).join("")}</div>
      <aside class="evidence-panel"><header><strong>${frameMeta[state.frame].label} 근거</strong><span>AI 추정 · 사람 검토 전</span></header>${evidence.length ? evidence.map((item) => `<figure class="evidence-card"><blockquote>“${escapeHtml(item.quote)}”</blockquote><footer><span>${escapeHtml(item.outlet)}</span><span>신뢰도 ${item.confidence}%</span></footer></figure>`).join("") : `<p class="panel-note">이 프레임으로 분류된 근거가 없습니다. 판정을 보류합니다.</p>`}</aside>
    </div>`;
}

function reportText(issue) {
  return `주요 관점\n${issue.report.main}\n\n상대적으로 적게 다뤄진 관점\n${issue.report.missing}\n\n해석 유의\n${issue.report.caution}`;
}

function renderReport(issue) {
  return `
    <div class="analysis-heading"><h3>AI 이슈 리포트</h3><p>근거 기사 ${issue.articleCount}건 · prompt v0.1</p></div>
    <div class="report-card"><article class="report-block"><span>주요 관점</span><p>${escapeHtml(issue.report.main)}</p></article><article class="report-block"><span>적게 다뤄진 관점</span><p>${escapeHtml(issue.report.missing)}</p></article><article class="report-block"><span>해석 유의</span><p>${escapeHtml(issue.report.caution)}</p></article></div>
    <div class="report-actions"><small>이 문장은 언론사를 평가하지 않고 관측 패턴만 설명합니다.</small><button type="button" class="copy-button" data-copy-report>리포트 복사</button></div>`;
}

function sortedArticles(issue) {
  const articles = [...issue.articles];
  if (state.articleSort === "outlet") return articles.sort((a, b) => a.outlet.localeCompare(b.outlet, "ko"));
  return articles.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}

function renderArticles(issue) {
  return `
    <div class="article-tools"><p>게시 시각이 없으면 수집 시각을 대신 표시합니다.</p><label><span class="sr-only">기사 정렬</span><select id="article-sort"><option value="latest"${state.articleSort === "latest" ? " selected" : ""}>최신순</option><option value="outlet"${state.articleSort === "outlet" ? " selected" : ""}>언론사순</option></select></label></div>
    <div class="article-list">${sortedArticles(issue).map((article, index) => `<article class="article-item"><span>${escapeHtml(article.outlet)}</span><div><strong>${escapeHtml(article.title)}</strong><small>게시 ${article.publishedAt} · 수집 ${article.collectedAt} · ${article.placement}</small></div><button type="button" class="article-link" data-article="${index}">기사 정보</button></article>`).join("")}</div>`;
}

function renderAnalysis(issue) {
  if (state.tab === "frames") return renderFrames(issue);
  if (state.tab === "report") return renderReport(issue);
  if (state.tab === "articles") return renderArticles(issue);
  return renderOutlets(issue);
}

function renderDetail() {
  const issue = getSelectedIssue();
  const root = $("#issue-detail");
  root.innerHTML = `
    <div class="detail-kicker"><p>ISSUE ${String(issue.rank).padStart(2, "0")} · ${escapeHtml(issue.category)} · 2026.07.13</p><span class="confidence">분석 신뢰도 ${issue.confidence}%</span></div>
    <div class="detail-title-row"><h2>${escapeHtml(issue.title)}</h2><div class="big-score"><strong>${issue.score.toFixed(1)}</strong><span>의제 점수</span></div></div>
    <p class="detail-summary">${escapeHtml(issue.summary)}</p>
    <div class="detail-metrics"><span>관련 언론사 <b>${issue.mediaCount}</b></span><span>관련 기사 <b>${issue.articleCount}</b></span><span>반복 노출 <b>${issue.repeated}회</b></span><span>계산식 <b>v0.1</b></span></div>
    ${renderScoreBreakdown(issue)}
    <div class="analysis-tabs" role="tablist" aria-label="이슈 분석 보기">
      <button type="button" class="analysis-tab${state.tab === "outlets" ? " active" : ""}" data-tab="outlets" role="tab" aria-selected="${state.tab === "outlets"}">언론사 비교</button>
      <button type="button" class="analysis-tab${state.tab === "frames" ? " active" : ""}" data-tab="frames" role="tab" aria-selected="${state.tab === "frames"}">프레임 분석</button>
      <button type="button" class="analysis-tab${state.tab === "report" ? " active" : ""}" data-tab="report" role="tab" aria-selected="${state.tab === "report"}">AI 리포트</button>
      <button type="button" class="analysis-tab${state.tab === "articles" ? " active" : ""}" data-tab="articles" role="tab" aria-selected="${state.tab === "articles"}">관련 기사</button>
    </div>
    <div class="analysis-view" role="tabpanel">${renderAnalysis(issue)}</div>`;
}

function renderAll() {
  renderFilters();
  renderRanking();
  renderDetail();
}

function openDialog(dialog) {
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
}

function openArticle(index) {
  const issue = getSelectedIssue();
  const article = sortedArticles(issue)[index];
  if (!article) return;
  $("#article-dialog-title").textContent = article.title;
  $("#article-dialog-content").innerHTML = `<dl><div><dt>언론사</dt><dd>${escapeHtml(article.outlet)}</dd></div><div><dt>게시 시각</dt><dd>2026.07.13 ${article.publishedAt} KST</dd></div><div><dt>수집 시각</dt><dd>2026.07.13 ${article.collectedAt} KST</dd></div><div><dt>홈페이지 배치</dt><dd>${escapeHtml(article.placement)}</dd></div><div><dt>저장 범위</dt><dd>제목·시각·배치·분석 결과만 저장</dd></div></dl><p class="method-caution">시연용 합성 기사이므로 외부 원문 링크는 제공하지 않습니다. 라이브 연동 시 원문 URL이 이 위치에 표시됩니다.</p>`;
  openDialog($("#article-dialog"));
}

document.addEventListener("click", async (event) => {
  const target = event.target.closest("button, a");
  if (!target) return;

  if (target.matches("[data-category]")) {
    state.category = target.dataset.category;
    renderAll();
  }
  if (target.matches("[data-issue]")) {
    state.selectedId = target.dataset.issue;
    state.tab = "outlets";
    state.frame = "responsibility";
    renderAll();
  }
  if (target.matches("[data-tab]")) {
    state.tab = target.dataset.tab;
    renderDetail();
  }
  if (target.matches("[data-frame]")) {
    state.frame = target.dataset.frame;
    renderDetail();
  }
  if (target.matches("[data-open-method]")) openDialog($("#method-dialog"));
  if (target.matches("[data-article]")) openArticle(Number(target.dataset.article));
  if (target.matches("[data-copy-report]")) {
    try {
      await navigator.clipboard.writeText(reportText(getSelectedIssue()));
      showToast("AI 리포트를 클립보드에 복사했습니다.");
    } catch {
      showToast("복사 권한을 확인해 주세요.");
    }
  }
});

document.addEventListener("change", (event) => {
  if (event.target.matches("#article-sort")) {
    state.articleSort = event.target.value;
    renderDetail();
  }
});

$("#refresh-button").addEventListener("click", async () => {
  const button = $("#refresh-button");
  button.disabled = true;
  button.querySelector("span:last-child").textContent = "확인 중";
  await Promise.all([refreshCollectionStatus(), refreshLiveArticles({ announce: true })]);
  button.disabled = false;
  button.querySelector("span:last-child").textContent = "갱신";
});

$("#live-filter-form").addEventListener("submit", (event) => {
  event.preventDefault();
  refreshLiveArticles({ announce: true });
});

$("#live-filter-form").addEventListener("reset", () => {
  window.setTimeout(() => refreshLiveArticles({ announce: true }), 0);
});

$("#live-load-more").addEventListener("click", () => {
  refreshLiveArticles({ append: true });
});

renderTodayDate();
renderAll();
Promise.all([refreshCollectionStatus(), refreshLiveArticles()]);
