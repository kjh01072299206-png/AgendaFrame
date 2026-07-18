"use client";

import { FormEvent, KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

type Health = {
  status: string;
  mode: "demo" | "live_metadata" | "unavailable";
  dataAsOf: string | null;
  collection: { articleCount: number; authorizedContentCount: number; configuredSources: number; latestSourceCount: number; latestStatus: string };
  analysis?: { id: string; targetDate: string; provider: string; modelVersion: string; finishedAt: number; articleCount: number; issueCount: number } | null;
  freshness: { status: "normal" | "collection_delayed" | "partial_collection" | "analysis_pending" | "stale_snapshot"; label: string; staleDays: number | null };
  timestamps: { collectedAt: string | null; analyzedAt: number | null; publishedAt: number | null; nextScheduledAt: number | null };
};

type Issue = {
  id: string;
  issueDate: string;
  title: string;
  summary: string;
  category: string;
  articleCount: number;
  sourceCount: number;
  agendaScore: number | null;
  diversityScore: number;
  placementScore: number | null;
  volumeScore: number;
  repetitionScore: number;
  followUpVolumeScore: number;
  placementObservedCount: number;
  placementTotalCount: number;
  scoreStatus: "legacy_reanalysis_required" | "observed_components" | "placement_excluded";
  calibrationStatus: "not_calibrated";
  clusterQuality: "review_required" | "not_human_reviewed" | "cohesive" | "insufficient_evidence";
  contentAvailableCount: number;
  evidenceBasis: "headline_metadata_only" | "authorized_body_and_metadata";
};

type Article = {
  id: string;
  source: string;
  title: string;
  url: string;
  section?: string | null;
  publishedAt: number;
  homepagePlacement?: string | null;
  homepageRank?: number | null;
  placementObservationCount?: number;
  contentAvailable?: number | boolean;
  representative?: number;
  similarity?: number;
};

type Frame = { frame: string; score: number; calibrationStatus: string; evidenceBasis: "headline" | "body_private" | "body_public"; evidenceText?: string | null; source?: string | null; articleId?: string | null; sourceUrl?: string | null };
type Comparison = {
  status: "withheld_insufficient_evidence" | "available";
  evidenceBasis: "headline_metadata_only" | "authorized_body_signals_not_structured_comparison" | "evidence_spans";
  reason: string;
  commonFacts: Array<{ id: string; text: string; articleCount: number; sourceCount: number; evidence: Array<{ articleId: string; source: string; sourceUrl: string; text: string }> }>;
  divergenceQuestions: Array<{ id: string; question: string; status: string; answerGroups: Array<{ id: string; label: string; sources: string[]; evidence: Array<{ articleId: string; source: string; sourceUrl: string; text: string }> }> }>;
  sourceVoices: Array<{ sourceType: string; people: string[]; supports: string; evidence: Array<{ articleId: string; sourceUrl: string; text: string }> }>;
  recommendedPair: null | { primary: Article; complement: Article; reason: string };
  availableHeadlineEvidence?: Array<{ articleId: string; source: string; sourceUrl: string; text: string }>;
};
type IssueDetail = {
  issue: Issue & { provider: string; modelVersion: string; analyzedAt: number };
  articles: Article[];
  frames: Frame[];
  report: { summary: string; missingPerspective: string; caution: string; provider: string; modelVersion: string } | null;
  outlets: Array<{ source: string; articleCount: number; placement: string }>;
  comparison: Comparison;
};

type AnalysisTab = "compare" | "outlets" | "frames" | "articles";

const frameLabels: Record<string, string> = {
  conflict: "갈등·대립",
  responsibility: "책임 소재",
  economy: "경제·생활",
  law: "법·제도",
  policy: "정책 효과",
  citizen: "시민 영향",
};
const frameColors: Record<string, string> = {
  conflict: "#d64b70",
  responsibility: "#7058a3",
  economy: "#bf7b20",
  law: "#315da8",
  policy: "#11745b",
  citizen: "#248b9e",
};
const placementLabels: Record<string, string> = { top: "최상단", main: "주요 영역", section: "섹션", list: "목록" };
const outletPlacementLabels: Record<string, string> = { TOP: "최상단", MAIN: "주요 영역", SECTION: "섹션", LIST: "목록", 미확인: "관측 없음" };

function formatDateTime(value?: number | string | null) {
  if (!value) return "시각 미확인";
  const date = new Date(typeof value === "number" ? value : value);
  if (!Number.isFinite(date.getTime())) return "시각 미확인";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

function ScorePart({ label, value, note }: { label: string; value: number | null; note?: string }) {
  return (
    <div className="score-part">
      <header><span>{label}</span><b>{value === null ? "미확인" : value.toFixed(1)}</b></header>
      <div className="score-track"><i style={{ width: `${value === null ? 0 : Math.max(0, Math.min(100, value))}%` }} /></div>
      {note && <small>{note}</small>}
    </div>
  );
}

const analysisTabs: Array<[AnalysisTab, string]> = [
  ["compare", "핵심 비교"],
  ["outlets", "매체별 보도"],
  ["frames", "프레임 단서"],
  ["articles", "관련 원문"],
];

export default function AgendaDashboard() {
  const [health, setHealth] = useState<Health | null>(null);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [issueTotal, setIssueTotal] = useState(0);
  const [categories, setCategories] = useState<Array<{ category: string; count: number }>>([]);
  const [category, setCategory] = useState("전체");
  const [selectedIssueId, setSelectedIssueId] = useState("");
  const [detail, setDetail] = useState<IssueDetail | null>(null);
  const [detailRequestNonce, setDetailRequestNonce] = useState(0);
  const [tab, setTab] = useState<AnalysisTab>("compare");
  const [loadingIssues, setLoadingIssues] = useState(true);
  const [issueError, setIssueError] = useState("");
  const [detailError, setDetailError] = useState("");
  const [articles, setArticles] = useState<Article[]>([]);
  const [articleTotal, setArticleTotal] = useState(0);
  const [articleOffset, setArticleOffset] = useState(0);
  const [articleLoading, setArticleLoading] = useState(false);
  const [articleError, setArticleError] = useState("");
  const [filters, setFilters] = useState({ q: "", source: "", section: "", date: "" });
  const [appliedFilters, setAppliedFilters] = useState({ q: "", source: "", section: "", date: "" });
  const [methodOpen, setMethodOpen] = useState(false);
  const [urlReady, setUrlReady] = useState(false);
  const [healthError, setHealthError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMessage, setRefreshMessage] = useState("");
  const methodDialogRef = useRef<HTMLDialogElement>(null);

  const loadHealth = useCallback(async () => {
    try {
      const response = await fetch("/api/health", { cache: "no-store" });
      if (!response.ok) throw new Error("health unavailable");
      setHealth(await response.json());
      setHealthError(false);
    } catch {
      setHealthError(true);
    }
  }, []);

  const loadIssues = useCallback(async (nextCategory = category) => {
    setLoadingIssues(true);
    setIssueError("");
    try {
      const parameters = new URLSearchParams({ limit: "5" });
      if (nextCategory !== "전체") parameters.set("category", nextCategory);
      const response = await fetch(`/api/issues?${parameters}`, { cache: "no-store" });
      if (!response.ok) throw new Error("issues unavailable");
      const payload = await response.json();
      const nextIssues = Array.isArray(payload.issues) ? payload.issues : [];
      setIssues(nextIssues);
      setIssueTotal(Number(payload.total) || 0);
      setCategories(Array.isArray(payload.categories) ? payload.categories : []);
      const requestedIssue = typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("issue") ?? "";
      setSelectedIssueId((current) => nextIssues.some((issue: Issue) => issue.id === current) ? current : (nextIssues.find((issue: Issue) => issue.id === requestedIssue)?.id ?? nextIssues[0]?.id ?? ""));
    } catch {
      setIssueError("이슈를 새로 불러오지 못했습니다. 잠시 뒤 다시 시도해 주세요.");
    } finally {
      setLoadingIssues(false);
    }
  }, [category]);

  const loadArticles = useCallback(async ({ append = false, nextFilters = appliedFilters } = {}) => {
    if (articleLoading) return;
    setArticleLoading(true);
    setArticleError("");
    try {
      const offset = append ? articleOffset : 0;
      const parameters = new URLSearchParams({ limit: "12", offset: String(offset) });
      Object.entries(nextFilters).forEach(([key, value]) => { if (value.trim()) parameters.set(key, value.trim()); });
      const response = await fetch(`/api/articles?${parameters}`, { cache: "no-store" });
      if (!response.ok) throw new Error("articles unavailable");
      const payload = await response.json();
      const next = Array.isArray(payload.articles) ? payload.articles : [];
      setArticles((current) => append ? [...current, ...next] : next);
      setArticleTotal(Number(payload.total) || 0);
      setArticleOffset(offset + next.length);
    } catch {
      setArticleError("기사 목록을 새로 불러오지 못했습니다. 잠시 뒤 다시 시도해 주세요.");
    } finally {
      setArticleLoading(false);
    }
  }, [appliedFilters, articleLoading, articleOffset]);

  useEffect(() => {
    const parameters = typeof window === "undefined" ? new URLSearchParams() : new URLSearchParams(window.location.search);
    const initialCategory = parameters.get("category") || "전체";
    const requestedTab = parameters.get("tab") as AnalysisTab | null;
    const initialTab = analysisTabs.some(([value]) => value === requestedTab) ? requestedTab as AnalysisTab : "compare";
    const initialFilters = { q: parameters.get("q") ?? "", source: parameters.get("source") ?? "", section: parameters.get("section") ?? "", date: parameters.get("date") ?? "" };
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCategory(initialCategory);
    setTab(initialTab);
    setFilters(initialFilters);
    setAppliedFilters(initialFilters);
    setUrlReady(true);
    Promise.allSettled([loadHealth(), loadIssues(initialCategory), loadArticles({ nextFilters: initialFilters })]);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!selectedIssueId) return;
    let cancelled = false;
    fetch(`/api/issues/${encodeURIComponent(selectedIssueId)}`, { cache: "no-store" })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("detail unavailable")))
      .then((payload) => { if (!cancelled) setDetail(payload); })
      .catch(() => { if (!cancelled) { setDetail(null); setDetailError("이슈 근거를 불러오지 못했습니다."); } });
    return () => { cancelled = true; };
  }, [detailRequestNonce, selectedIssueId]);

  useEffect(() => {
    if (!urlReady || typeof window === "undefined") return;
    const parameters = new URLSearchParams(window.location.search);
    if (selectedIssueId) parameters.set("issue", selectedIssueId); else parameters.delete("issue");
    if (category !== "전체") parameters.set("category", category); else parameters.delete("category");
    parameters.set("tab", tab);
    Object.entries(appliedFilters).forEach(([key, value]) => { if (value) parameters.set(key, value); else parameters.delete(key); });
    const query = parameters.toString();
    const hash = window.location.hash || "#agenda-workspace";
    window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}${hash}`);
  }, [appliedFilters, category, selectedIssueId, tab, urlReady]);

  useEffect(() => {
    const dialog = methodDialogRef.current;
    if (!dialog) return;
    if (methodOpen && !dialog.open) dialog.showModal();
    if (!methodOpen && dialog.open) dialog.close();
  }, [methodOpen]);

  useEffect(() => {
    if (!methodOpen) return;
    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setMethodOpen(false);
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [methodOpen]);

  const handleCategory = (value: string) => {
    setCategory(value);
    setDetail(null);
    setDetailError("");
    setTab("compare");
    loadIssues(value);
  };

  const selectIssue = (issueId: string) => {
    setDetail(null);
    setDetailError("");
    setSelectedIssueId(issueId);
    setTab("compare");
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 780px)").matches) {
      requestAnimationFrame(() => document.getElementById("issue-analysis-panel")?.scrollIntoView({ behavior: "smooth", block: "start" }));
    }
  };

  const retryDetail = () => {
    setDetail(null);
    setDetailError("");
    setDetailRequestNonce((current) => current + 1);
  };

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, value: AnalysisTab) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const current = analysisTabs.findIndex(([candidate]) => candidate === value);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? analysisTabs.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + analysisTabs.length) % analysisTabs.length;
    const nextTab = analysisTabs[next][0];
    setTab(nextTab);
    requestAnimationFrame(() => document.getElementById(`analysis-tab-${nextTab}`)?.focus());
  };

  const submitFilters = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAppliedFilters(filters);
    loadArticles({ append: false, nextFilters: filters });
  };

  const resetFilters = () => {
    const empty = { q: "", source: "", section: "", date: "" };
    setFilters(empty);
    setAppliedFilters(empty);
    loadArticles({ append: false, nextFilters: empty });
  };

  const refreshAll = async () => {
    if (refreshing) return;
    setRefreshing(true);
    setRefreshMessage("");
    await Promise.allSettled([loadHealth(), loadIssues(category), loadArticles({ nextFilters: appliedFilters })]);
    setRefreshMessage(`${formatDateTime(Date.now())}에 화면 데이터를 확인했습니다.`);
    setRefreshing(false);
  };

  const selectedIssue = useMemo(() => issues.find((issue) => issue.id === selectedIssueId) ?? (detail?.issue.id === selectedIssueId ? detail.issue : null), [detail, issues, selectedIssueId]);
  const categoryOptions = ["전체", ...categories.map((entry) => entry.category)];
  const freshness = health?.freshness ?? { status: "analysis_pending", label: healthError ? "상태 확인 불가" : "상태 확인 중", staleDays: null };
  const currentSnapshot = freshness.status === "normal";
  const basisDate = health?.analysis?.targetDate ?? null;
  const detectedFrames = detail?.frames.filter((frame) => frame.score > 0 && frame.evidenceText) ?? [];
  const bodyBackedFrameCount = detail?.frames.filter((frame) => frame.evidenceBasis.startsWith("body_") && frame.score > 0).length ?? 0;
  const authorizedContentCount = health?.collection.authorizedContentCount ?? 0;

  return (
    <>
      <a className="skip-link" href="#main-content">본문으로 건너뛰기</a>
      <header className="topbar">
        <a className="brand" href="#top" aria-label="AgendaFrame 홈"><span className="brand-mark" aria-hidden="true">AF</span><span className="brand-copy"><b>AgendaFrame</b><small>뉴스 프레이밍 근거 탐색</small></span></a>
        <nav className="topnav" aria-label="주요 메뉴"><a href="#agenda-workspace">이슈 비교</a><a href="#live-feed">기사 원문</a><button type="button" onClick={() => setMethodOpen(true)}>분석 원칙</button></nav>
        <div className="top-actions"><span className={`demo-badge live freshness-${freshness.status}`}><i aria-hidden="true" /> {freshness.label}</span><button className="refresh-button" type="button" onClick={refreshAll} disabled={refreshing} aria-label={refreshing ? "화면 데이터 확인 중" : "화면 데이터 새로고침"} aria-describedby="refresh-status"><span aria-hidden="true">↻</span><span>{refreshing ? "확인 중" : "새로고침"}</span></button><span className="sr-only" id="refresh-status" role="status" aria-live="polite">{refreshMessage}</span></div>
      </header>

      <div id="top" />
      <main id="main-content" tabIndex={-1}>
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero-copy">
            <p className="eyebrow">뉴스 비교 도구 · 5개 전국 종합일간지 표본</p>
            <h1 id="hero-title">같은 사건,<br /><em>어디서 설명이 갈렸을까?</em></h1>
            <p className="hero-description">여러 매체의 보도를 사건별로 묶고, 공통 사실과 설명 차이를 원문 근거로 확인합니다. 근거가 부족한 분석은 그럴듯하게 채우지 않고 보류합니다.</p>
            <div className="hero-meta" aria-label="분석 범위 요약"><span>자료 기준 <strong>{basisDate?.replaceAll("-", ".") ?? "확인 중"}</strong></span><span>승인 본문 <strong>{authorizedContentCount.toLocaleString("ko-KR")}건</strong></span><span>사람 검토 <strong>미완료</strong></span></div>
            {!currentSnapshot && <p className="freshness-warning" role="status"><strong>{freshness.label}</strong>{freshness.staleDays ? ` · 기준일로부터 ${freshness.staleDays}일 지났습니다.` : " · 최신 수집 상태를 확인해 주세요."}</p>}
            <button className="text-button" type="button" onClick={() => setMethodOpen(true)}>숫자와 분석 한계 이해하기 <span aria-hidden="true">→</span></button>
          </div>
          <div className="snapshot" aria-label="데이터 현황">
            <div className="snapshot-heading"><span>현재 분석 범위</span><strong className={`freshness-text-${freshness.status}`}>{freshness.label}</strong></div>
            <div className="stat-grid">
              <article><span>분석 표본</span><strong>{health?.collection.configuredSources ?? 5}<small>곳</small></strong><p>한겨레 · 경향 · 한국일보 · 중앙 · 조선</p></article>
              <article><span>저장된 기사 메타데이터</span><strong>{(health?.collection.articleCount ?? 0).toLocaleString("ko-KR")}<small>건</small></strong><p>승인 본문 {authorizedContentCount.toLocaleString("ko-KR")}건 · 비공개</p></article>
              <article><span>묶인 이슈</span><strong>{health?.analysis?.issueCount ?? issueTotal}<small>개</small></strong><p>{health?.analysis?.targetDate ?? "분석 대기"} 기준</p></article>
              <article><span>현재 근거 수준</span><strong className="status-value">{authorizedContentCount ? "본문+제목" : "제목"}</strong><p>근거 범위 구분 · 사람 검토 전</p></article>
            </div>
            <dl className="snapshot-times"><div><dt>수집</dt><dd>{formatDateTime(health?.timestamps?.collectedAt)}</dd></div><div><dt>분석</dt><dd>{formatDateTime(health?.timestamps?.analyzedAt)}</dd></div><div><dt>공개</dt><dd>{formatDateTime(health?.timestamps?.publishedAt)}</dd></div></dl>
            <div className="pipeline-strip" aria-label="분석 과정"><span>배치·기사</span><i /><span>사건 묶음</span><i /><span>표현 단서</span><i /><span>근거 범위</span></div>
          </div>
        </section>

        <section className="workspace" id="agenda-workspace" aria-label="뉴스 이슈 비교">
          <aside className="ranking-panel" aria-labelledby="ranking-title">
            <div className="section-heading"><div><p className="eyebrow">오늘의 표본</p><h2 id="ranking-title">비교할 이슈</h2></div><span className="issue-count">{issues.length}개 표시 · 전체 {issueTotal}개</span></div>
            <div className="filter-row" aria-label="분야별 이슈 보기">
              {categoryOptions.map((value) => <button key={value} type="button" className={`filter-pill${category === value ? " active" : ""}`} aria-pressed={category === value} onClick={() => handleCategory(value)}>{value}</button>)}
            </div>
            <div className="agenda-list" aria-busy={loadingIssues}>
              {loadingIssues ? <div className="empty-state" role="status">이슈를 정리하고 있습니다…</div> : issueError ? <div className="empty-state error-state" role="alert"><strong>이슈를 불러오지 못했습니다.</strong><span>{issueError}</span><button type="button" onClick={() => loadIssues(category)}>이슈 다시 불러오기</button></div> : issues.length ? issues.map((issue, index) => (
                <button key={issue.id} type="button" className={`agenda-card${issue.id === selectedIssueId ? " active" : ""}`} aria-pressed={issue.id === selectedIssueId} aria-current={issue.id === selectedIssueId ? "true" : undefined} aria-controls="issue-analysis-panel" onClick={() => selectIssue(issue.id)}>
                  <span className="agenda-rank">{index + 1}</span>
                  <span className="agenda-copy"><span className="agenda-meta"><b className="category-tag">{issue.category}</b>5개 매체 중 {issue.sourceCount}곳 · 제목 {issue.articleCount}건</span><strong>{issue.title}</strong><small>{issue.scoreStatus === "legacy_reanalysis_required" ? "재분석 대기 · 이전 결과 숨김" : "제목 기반 묶음 · 사람 검토 전"}</small></span>
                  <span className="agenda-score"><strong>{issue.agendaScore === null ? "–" : Math.round(issue.agendaScore)}</strong><small>{issue.agendaScore === null ? "산출 보류" : "집중도 /100"}</small></span>
                </button>
              )) : <div className="empty-state"><strong>표시할 이슈가 없습니다.</strong><span>선택한 분야에 분석된 기사 제목이 아직 없습니다.</span></div>}
            </div>
            <p className="panel-note"><span aria-hidden="true">ⓘ</span> 첫 화면에는 보도 집중도 상위 5개만 표시합니다. 순위는 사건의 중요도·사실성·여론을 뜻하지 않습니다.</p>
          </aside>

          <article className="detail-panel" id="issue-analysis-panel">
            {!selectedIssue ? <div className="empty-state detail-empty"><strong>비교할 이슈를 선택해 주세요.</strong><span>이슈를 선택하면 매체별 제목과 현재 확인 가능한 근거가 여기에 나타납니다.</span></div> : detailError ? <div className="empty-state error-state" role="alert"><strong>이슈 근거를 불러오지 못했습니다.</strong><span>{detailError}</span><button type="button" onClick={retryDetail}>근거 다시 불러오기</button></div> : !detail || detail.issue.id !== selectedIssueId ? <div className="empty-state" role="status">이슈 근거를 확인하고 있습니다…</div> : (
              <>
                <div className="detail-kicker"><p>{detail.issue.category} · {detail.issue.issueDate} · {detail.issue.sourceCount}개 언론사</p><span className="confidence review">{detail.issue.scoreStatus === "legacy_reanalysis_required" ? "재분석 필요" : "사람 검토 전"}</span></div>
                <div className="detail-title-row"><div><h2>{detail.issue.title}</h2><p className="detail-summary">{detail.issue.summary}</p></div><div className="big-score"><strong>{detail.issue.agendaScore === null ? "–" : Math.round(detail.issue.agendaScore)}</strong><span>{detail.issue.agendaScore === null ? "산출 보류" : "표본 내 집중도 /100"}</span></div></div>
                <div className="detail-metrics"><span>관련 제목 <b>{detail.issue.articleCount}건</b></span><span>포함 매체 <b>{detail.issue.sourceCount}/5곳</b></span><span>승인 본문 <b>{detail.issue.contentAvailableCount}/{detail.issue.articleCount}건</b></span><span>사람 검토 <b>미완료</b></span></div>
                <details className="score-details"><summary>보도 집중도 산출 방식 보기</summary><div className="score-breakdown"><ScorePart label="매체 커버리지" value={detail.issue.diversityScore} /><ScorePart label="홈페이지 배치" value={detail.issue.placementScore} note={`${detail.issue.placementObservedCount}/${detail.issue.placementTotalCount}건에서 관측`} /><ScorePart label="기사량" value={detail.issue.volumeScore} /><ScorePart label="동일 매체 후속 보도량" value={detail.issue.followUpVolumeScore} /></div><p>관측된 메타데이터만 계산합니다. 이 점수는 중요도·진실성·여론을 뜻하지 않습니다.</p></details>
                <div className="analysis-tabs" role="tablist" aria-label="이슈 분석 보기">
                  {analysisTabs.map(([value, label]) => <button key={value} id={`analysis-tab-${value}`} type="button" role="tab" aria-selected={tab === value} aria-controls={`analysis-panel-${value}`} tabIndex={tab === value ? 0 : -1} className={tab === value ? "active" : ""} onKeyDown={(event) => handleTabKeyDown(event, value)} onClick={() => setTab(value)}>{label}</button>)}
                </div>
                {tab === "compare" && (
                  <div id="analysis-panel-compare" role="tabpanel" aria-labelledby="analysis-tab-compare" className="evidence-first">
                    <header>
                      <p className="eyebrow">현재 비교 결과</p>
                      <h3>{detail.comparison.status === "available" ? "근거가 확인된 설명 차이" : "구조화 비교를 보류했습니다"}</h3>
                      <p>{detail.comparison.reason}</p>
                    </header>
                    <div className="evidence-grid">
                      <section>
                        <div className="evidence-step"><span className="step-number">01</span><span className="step-status">{detail.comparison.commonFacts.length ? "확인됨" : "근거 부족"}</span></div>
                        <h4>공통으로 확인된 사실</h4>
                        {detail.comparison.commonFacts.length ? detail.comparison.commonFacts.map((fact) => <article key={fact.id}><strong>{fact.text}</strong><small>{fact.sourceCount}개 매체 · {fact.articleCount}건 근거</small></article>) : <p className="withheld">검증된 공통 사실 추출과 독립 출처 대조가 완료되지 않아 만들지 않았습니다.</p>}
                      </section>
                      <section>
                        <div className="evidence-step"><span className="step-number">02</span><span className="step-status">{detail.comparison.divergenceQuestions.length ? "확인됨" : "판단 보류"}</span></div>
                        <h4>보도가 갈린 질문</h4>
                        {detail.comparison.divergenceQuestions.length ? detail.comparison.divergenceQuestions.map((question) => <article key={question.id}><strong>{question.question}</strong><small>{question.answerGroups.length}개 설명 그룹</small></article>) : <p className="withheld">제목만으로 원인·책임·해법의 차이를 단정하지 않습니다.</p>}
                      </section>
                      <section>
                        <div className="evidence-step"><span className="step-number">03</span><span className="step-status">{detail.comparison.sourceVoices.length ? "확인됨" : "본문 필요"}</span></div>
                        <h4>누구의 목소리가 실렸나</h4>
                        {detail.comparison.sourceVoices.length ? detail.comparison.sourceVoices.map((voice) => <article key={`${voice.sourceType}-${voice.supports}`}><strong>{voice.sourceType}</strong><p>{voice.supports}</p></article>) : <p className="withheld">승인 본문이 없거나 취재원 추출이 검토되지 않아 발언 주체와 맥락을 판정하지 않습니다.</p>}
                      </section>
                      <section>
                        <div className="evidence-step"><span className="step-number">04</span><span className="step-status">{detail.comparison.recommendedPair ? "추천 가능" : "추천 보류"}</span></div>
                        <h4>기사 두 개만 읽는다면</h4>
                        {detail.comparison.recommendedPair ? <><p>{detail.comparison.recommendedPair.reason}</p><div className="pair-links"><a href={detail.comparison.recommendedPair.primary.url} target="_blank" rel="noopener noreferrer">첫 번째 기사 열기</a><a href={detail.comparison.recommendedPair.complement.url} target="_blank" rel="noopener noreferrer">보완 기사 열기</a></div></> : <><p className="withheld">두 기사의 상호보완성을 근거로 확인할 수 없어 추천하지 않습니다.</p><button className="inline-action" type="button" onClick={() => setTab("articles")}>관련 제목을 직접 비교하기</button></>}
                      </section>
                    </div>
                    {detail.articles.length > 0 && <section className="headline-evidence" aria-labelledby="headline-evidence-title"><div><p className="eyebrow">지금 확인 가능한 근거</p><h4 id="headline-evidence-title">매체별 기사 제목</h4></div><div>{detail.articles.slice(0, 5).map((article) => <a key={article.id} href={article.url} target="_blank" rel="noopener noreferrer"><span>{article.source}</span><strong>{article.title}</strong><small>원문 열기 →</small></a>)}</div></section>}
                  </div>
                )}
                {tab === "outlets" && <div id="analysis-panel-outlets" role="tabpanel" aria-labelledby="analysis-tab-outlets" className="outlet-list"><p className="expert-note"><strong>전문가 보기</strong> 기사 수와 홈페이지 배치는 편향·사실성·논조를 판정하는 값이 아닙니다.</p><div className="outlet-head"><span>포함 매체</span><span>제목 수</span><span>홈 배치</span><span>대표 제목</span></div>{detail.outlets.map((outlet) => { const article = detail.articles.find((entry) => entry.source === outlet.source); const placement = outletPlacementLabels[outlet.placement] ?? outlet.placement; return <div className="outlet-row" key={outlet.source}><strong>{outlet.source}</strong><b>{outlet.articleCount}건</b><span className={`placement-badge${placement === "관측 없음" ? " unknown" : ""}`}>{placement}</span><p>{article ? <a href={article.url} target="_blank" rel="noopener noreferrer">{article.title}</a> : "대표 제목 미확인"}</p></div>; })}</div>}
                {tab === "frames" && <div id="analysis-panel-frames" role="tabpanel" aria-labelledby="analysis-tab-frames" className="frame-layout">{detail.frames.length ? <><p className="expert-note frame-note"><strong>근거 범위</strong> {bodyBackedFrameCount ? `승인 본문 근거가 있는 단서 ${bodyBackedFrameCount}개와 제목 단서를 구분해 표시합니다.` : "현재는 제목에 포함된 표현 단서만 표시합니다."} 항목 합계는 100%가 아니며 독자의 인식 효과를 뜻하지 않습니다.</p><div className="frame-chart">{detail.frames.map((frame) => <div className="frame-row" key={frame.frame}><span>{frameLabels[frame.frame] ?? frame.frame}</span><div aria-hidden="true"><i style={{ width: `${frame.score}%`, background: frameColors[frame.frame] }} /></div><b>{frame.score > 0 ? `${frame.score.toFixed(1)}%` : "검출 없음"}</b></div>)}</div><div className="evidence-panel"><h3>검출된 표현 근거</h3>{detectedFrames.length ? detectedFrames.map((frame) => <article key={frame.frame}><span style={{ color: frameColors[frame.frame] }}>{frameLabels[frame.frame]}</span><p>{frame.evidenceText}</p><small><b>{frame.evidenceBasis === "headline" ? "제목 단서" : frame.evidenceBasis === "body_public" ? "승인 본문" : "비공개 본문·문장 검토 전"}</b>{frame.sourceUrl ? <> · <a href={frame.sourceUrl} target="_blank" rel="noopener noreferrer">{frame.source ?? "원문"}에서 확인 →</a></> : ` · ${frame.source ?? "출처 미확인"}`}</small></article>) : <p className="withheld">현재 근거 범위에서는 사전에 정의된 프레임 표현 단서를 검출하지 못했습니다.</p>}</div></> : <p className="withheld">기존 분석은 근거 오류 가능성이 있어 숨겼습니다. 재분석 뒤 실제로 검출된 단서만 표시합니다.</p>}</div>}
                {tab === "articles" && <div id="analysis-panel-articles" role="tabpanel" aria-labelledby="analysis-tab-articles" className="article-table"><div className="article-tools"><div><strong>관련 원문 {detail.articles.length}건</strong><p>제목 유사도는 같은 사건을 묶기 위한 참고값이며 기사 신뢰도 점수가 아닙니다.</p></div></div><div>{detail.articles.map((article) => <article className="article-item" key={article.id}><span className="article-outlet">{article.source}</span><div><strong>{article.title}</strong><small>{formatDateTime(article.publishedAt)} · 대표 제목과 단어 유사도 {Math.round((article.similarity ?? 0) * 100)}% · {article.contentAvailable ? "승인 본문 분석 가능" : "제목 근거만 있음"}</small></div><a className="article-link" href={article.url} target="_blank" rel="noopener noreferrer">원문 열기</a></article>)}</div></div>}
              </>
            )}
          </article>
        </section>

        <section className="live-feed" id="live-feed" aria-labelledby="live-feed-title">
          <div className="section-heading live-heading"><div><p className="eyebrow">원문 아카이브</p><h2 id="live-feed-title">기사 원문 찾기</h2><p className="section-description">분석에 사용된 기사 제목을 매체·분야·날짜별로 찾고 원문에서 직접 확인하세요.</p></div><p>현재 {articles.length.toLocaleString("ko-KR")}건 표시 · 전체 {articleTotal.toLocaleString("ko-KR")}건</p></div>
          <form className="live-filter-form" role="search" onSubmit={submitFilters}>
            <label><span>기사 제목</span><input type="search" maxLength={100} value={filters.q} onChange={(event) => setFilters({ ...filters, q: event.target.value })} placeholder="예: 주거 정책" /></label>
            <label><span>언론사</span><select value={filters.source} onChange={(event) => setFilters({ ...filters, source: event.target.value })}><option value="">전체</option>{["한겨레","경향신문","한국일보","중앙일보","조선일보"].map((source) => <option key={source}>{source}</option>)}</select></label>
            <label><span>분야</span><select value={filters.section} onChange={(event) => setFilters({ ...filters, section: event.target.value })}><option value="">전체</option>{["정치","경제","사회","문화","스포츠","지역","국제","IT_과학"].map((section) => <option key={section}>{section}</option>)}</select></label>
            <label><span>게시일</span><input type="date" value={filters.date} onChange={(event) => setFilters({ ...filters, date: event.target.value })} /></label>
            <div className="live-filter-actions"><button type="submit" disabled={articleLoading}>{articleLoading ? "찾는 중…" : "조건 적용"}</button><button type="button" onClick={resetFilters}>필터 지우기</button></div>
          </form>
          {articleError ? <p className="live-empty error-state" role="alert"><strong>기사 목록을 갱신하지 못했습니다.</strong><span>{articleError}</span><button type="button" onClick={() => loadArticles()}>기사 다시 불러오기</button></p> : articleLoading && !articles.length ? <p className="live-empty" role="status">조건에 맞는 기사를 찾고 있습니다…</p> : !articles.length ? <p className="live-empty"><strong>조건에 맞는 기사가 없습니다.</strong><span>검색어를 줄이거나 날짜·분야 필터를 지워 보세요.</span></p> : <div className="live-article-grid" aria-busy={articleLoading}>{articles.map((article) => <article className="live-article" key={article.id}><div className="live-article-meta"><span className="live-source">{article.source}</span><span>{article.section ?? "분야 미분류"}</span>{article.contentAvailable ? <span className="content-evidence-badge">승인 본문</span> : null}</div><h3><a href={article.url} target="_blank" rel="noopener noreferrer">{article.title}</a></h3><p className="live-article-detail">게시 {formatDateTime(article.publishedAt)}<br />홈페이지 {article.homepagePlacement ? placementLabels[article.homepagePlacement] : "배치 관측 없음"}{article.homepageRank ? ` · ${article.homepageRank}위` : ""}{article.placementObservationCount ? ` · ${article.placementObservationCount}회 관측` : ""}</p><a className="live-original" href={article.url} target="_blank" rel="noopener noreferrer">원문 열기 <span aria-hidden="true">→</span></a></article>)}</div>}
          <div className="live-pagination">{articleOffset < articleTotal && <button type="button" disabled={articleLoading} onClick={() => loadArticles({ append: true })}>{articleLoading ? "기사 불러오는 중…" : "기사 12건 더 보기"}</button>}</div>
          <p className="panel-note"><span aria-hidden="true">ⓘ</span> 기사 전문은 명시적인 이용 근거가 확인된 자료만 비공개 분석 저장소에 보관합니다. 공개 화면에는 전문을 제공하지 않습니다.</p>
        </section>

        <section className="method-preview" id="comparison" aria-labelledby="method-title"><div><p className="eyebrow">분석 원칙</p><h2 id="method-title">판정보다 <em>근거</em>를 먼저 보여줍니다.</h2><p>AgendaFrame은 ‘어느 언론이 옳은가’를 채점하지 않습니다. 사용자가 원문을 더 잘 비교하도록 관측 범위와 빈칸까지 함께 보여줍니다.</p></div><div className="principles"><article><span>01</span><h3>근거 없으면 만들지 않기</h3><p>본문에 없는 사실·원인·취재원을 추정하지 않고, 확인할 수 없는 이유를 표시합니다.</p></article><article><span>02</span><h3>사건과 설명 구분하기</h3><p>같은 주제 안의 다른 사건은 분리하고, 설명 차이는 인용 가능한 근거가 있을 때만 묶습니다.</p></article><article><span>03</span><h3>숫자의 뜻 제한하기</h3><p>보도 집중도는 표본의 노출량일 뿐입니다. 중요도·신뢰도·여론처럼 읽히지 않도록 범위를 붙입니다.</p></article></div></section>
      </main>

      <footer><div className="brand footer-brand"><span className="brand-mark" aria-hidden="true">AF</span><span className="brand-copy"><b>AgendaFrame</b><small>뉴스 프레이밍 근거 탐색</small></span></div><p>5개 전국 종합일간지 표본 · 승인 본문만 비공개 분석 · 사람 검토 전</p><button type="button" onClick={() => setMethodOpen(true)}>분석 원칙과 한계</button></footer>

      <dialog ref={methodDialogRef} className="modal" aria-labelledby="method-dialog-title" aria-describedby="method-dialog-description" onCancel={() => setMethodOpen(false)} onClose={() => setMethodOpen(false)}><form method="dialog"><button className="modal-close" aria-label="분석 원칙 닫기">×</button></form><p className="eyebrow">보도 집중도 v3</p><h2 id="method-dialog-title">이 숫자는 무엇을 뜻하나요?</h2><p className="modal-lead" id="method-dialog-description">5개 종합일간지 표본에서 한 사건이 얼마나 넓고 반복적으로 노출됐는지 보여주는 0–100 지표입니다. 사회적 중요도·진실성·기사 품질·여론을 평가하지 않습니다.</p><div className="formula" aria-label="보도 집중도 가중치"><span>매체 커버리지 <b>35%</b></span><i>+</i><span>관측된 홈 배치 <b>30%</b></span><i>+</i><span>기사량 <b>20%</b></span><i>+</i><span>후속 보도량 <b>15%</b></span></div><p className="modal-detail">홈페이지 배치는 반복 관측이 있으면 기사별 평균을 사용합니다. 관측이 없는 기사는 중립값으로 추정하지 않고 해당 항목의 가중치를 제외합니다.</p><p className="method-caution"><strong>현재 제공 범위</strong> 이용 권한이 확인된 본문만 비공개로 분석하며, 나머지는 제목 단서로 제한합니다. 본문 표현 단서가 있어도 원인·책임·해법·취재원 비교는 구조화 분석과 사람 검토 전까지 보류합니다.</p></dialog>
    </>
  );
}
