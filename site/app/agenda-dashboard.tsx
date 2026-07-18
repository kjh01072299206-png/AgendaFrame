"use client";

import { FormEvent, KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

type Health = {
  status: string;
  mode: "demo" | "live_metadata" | "unavailable";
  dataAsOf: string | null;
  collection: { articleCount: number; configuredSources: number; latestSourceCount: number; latestStatus: string };
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
  evidenceBasis: "headline_metadata_only";
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
  representative?: number;
  similarity?: number;
};

type Frame = { frame: string; score: number; calibrationStatus: string; evidenceBasis: "headline"; evidenceText?: string | null; source?: string | null; articleId?: string | null; sourceUrl?: string | null };
type Comparison = {
  status: "withheld_insufficient_evidence" | "available";
  evidenceBasis: "headline_metadata_only" | "evidence_spans";
  reason: string;
  commonFacts: Array<{ id: string; text: string; articleCount: number; sourceCount: number; evidence: Array<{ articleId: string; source: string; sourceUrl: string; text: string }> }>;
  divergenceQuestions: Array<{ id: string; question: string; status: string; answerGroups: Array<{ id: string; label: string; sources: string[]; evidence: Array<{ articleId: string; source: string; sourceUrl: string; text: string }> }> }>;
  sourceVoices: Array<{ sourceType: string; people: string[]; supports: string; evidence: Array<{ articleId: string; sourceUrl: string; text: string }> }>;
  recommendedPair: null | { primary: Article; complement: Article; reason: string };
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
const placementLabels: Record<string, string> = { top: "TOP", main: "MAIN", section: "SECTION", list: "LIST" };

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

function todayKst() {
  return new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date())
    .replace(/\. /g, ".")
    .replace(/\.$/, "");
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
  ["compare", "같은 사건, 다른 설명"],
  ["outlets", "전문가: 언론사"],
  ["frames", "전문가: 제목 신호"],
  ["articles", "관련 기사"],
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
  const methodDialogRef = useRef<HTMLDialogElement>(null);

  const loadHealth = useCallback(async () => {
    try {
      const response = await fetch("/api/health", { cache: "no-store" });
      if (!response.ok) throw new Error("health unavailable");
      setHealth(await response.json());
    } catch {
      setHealth(null);
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
      setIssueError("의제 데이터를 불러오지 못했습니다. 기존 스냅샷은 변경되지 않았습니다.");
      setIssues([]);
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
      setArticleError("기사 목록을 불러오지 못했습니다. 잠시 뒤 다시 시도해 주세요.");
      if (!append) setArticles([]);
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
    window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}#agenda-workspace`);
  }, [appliedFilters, category, selectedIssueId, tab, urlReady]);

  useEffect(() => {
    const dialog = methodDialogRef.current;
    if (!dialog) return;
    if (methodOpen && !dialog.open) dialog.showModal();
    if (!methodOpen && dialog.open) dialog.close();
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

  const selectedIssue = useMemo(() => issues.find((issue) => issue.id === selectedIssueId) ?? null, [issues, selectedIssueId]);
  const categoryOptions = ["전체", ...categories.map((entry) => entry.category)];
  const freshness = health?.freshness ?? { status: "analysis_pending", label: "상태 확인 중", staleDays: null };
  const currentSnapshot = freshness.status === "normal";
  const basisDate = health?.analysis?.targetDate ?? null;

  return (
    <>
      <a className="skip-link" href="#main-content">본문으로 건너뛰기</a>
      <header className="topbar">
        <a className="brand" href="#top" aria-label="AgendaFrame 홈"><span className="brand-mark" aria-hidden="true">AF</span><span className="brand-copy"><b>AgendaFrame</b><small>의제·프레임 분석</small></span></a>
        <nav className="topnav" aria-label="주요 메뉴"><a href="#agenda-workspace">분석 의제</a><a href="#live-feed">기사 탐색</a><button type="button" onClick={() => setMethodOpen(true)}>분석 기준</button></nav>
        <div className="top-actions"><span className={`demo-badge live freshness-${freshness.status}`}><i aria-hidden="true" /> {freshness.label}</span><button className="refresh-button" type="button" onClick={() => Promise.allSettled([loadHealth(), loadIssues(category), loadArticles()])}><span aria-hidden="true">↻</span><span>화면 새로고침</span></button></div>
      </header>

      <div id="top" />
      <main id="main-content" tabIndex={-1}>
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero-copy">
            <p className="eyebrow">{basisDate?.replaceAll("-", ".") ?? todayKst()} · KST · 5개 전국 종합일간지 표본</p>
            <h1 id="hero-title">{currentSnapshot ? <>오늘의 보도에서<br /><em>무엇이 같고 달랐을까?</em></> : <>{basisDate ?? "최근"} 분석 스냅샷<br /><em>현재 최신 자료가 아닙니다</em></>}</h1>
            <p className="hero-description">한 언론만 읽었을 때 놓칠 수 있는 사실·설명·취재원의 차이를 원문 근거와 불확실성까지 포함해 보여줍니다. 현재는 제목 메타데이터만 있어 본문 근거가 필요한 분석은 보류합니다.</p>
            {!currentSnapshot && <p className="freshness-warning" role="status"><strong>{freshness.label}</strong>{freshness.staleDays ? ` · 기준일로부터 ${freshness.staleDays}일 경과` : ""} · 화면에 표시된 날짜를 먼저 확인해 주세요.</p>}
            <button className="text-button" type="button" onClick={() => setMethodOpen(true)}>의제 점수와 분석 한계 보기 <span aria-hidden="true">↗</span></button>
          </div>
          <div className="snapshot" aria-label="데이터 현황">
            <div className="snapshot-heading"><span>DATA SNAPSHOT</span><strong>{formatDateTime(health?.analysis?.finishedAt ?? health?.dataAsOf)} 확인</strong></div>
            <div className="stat-grid">
              <article><span>분석 언론사</span><strong>{health?.collection.configuredSources ?? 5}</strong><small>2 · 1 · 2 표본</small></article>
              <article><span>저장 기사</span><strong>{(health?.collection.articleCount ?? 0).toLocaleString("ko-KR")}</strong><small>본문 미저장</small></article>
              <article><span>분석 이슈</span><strong>{health?.analysis?.issueCount ?? issueTotal}</strong><small>{health?.analysis?.targetDate ?? "분석 보류"}</small></article>
              <article><span>공개 상태</span><strong className="status-value">{freshness.label}</strong><small>{health?.analysis?.modelVersion ?? "분석 버전 미확인"}</small></article>
            </div>
            <div className="snapshot-times"><span>수집 {formatDateTime(health?.timestamps?.collectedAt)}</span><span>분석 {formatDateTime(health?.timestamps?.analyzedAt)}</span><span>게시 {formatDateTime(health?.timestamps?.publishedAt)}</span><span>다음 예정 시각 미정</span></div>
            <div className="pipeline-strip"><span>허용된 메타데이터</span><i /><span>사건 묶음</span><i /><span>관측 의제성</span><i /><span>근거 공개</span></div>
          </div>
        </section>

        <section className="workspace" id="agenda-workspace" aria-label="실제 의제 분석 화면">
          <aside className="ranking-panel" aria-labelledby="ranking-title">
            <div className="section-heading"><div><p className="eyebrow">AGENDA SNAPSHOT</p><h2 id="ranking-title">분석 의제</h2></div><span className="issue-count">상위 {issues.length} / 전체 {issueTotal}</span></div>
            <div className="filter-row" aria-label="정책 분야 필터">
              {categoryOptions.map((value) => <button key={value} type="button" className={`filter-pill${category === value ? " active" : ""}`} aria-pressed={category === value} onClick={() => handleCategory(value)}>{value}</button>)}
            </div>
            <div className="agenda-list">
              {loadingIssues ? <div className="empty-state" role="status">분석 의제를 불러오는 중입니다.</div> : issueError ? <div className="empty-state error-state" role="alert">{issueError}<button type="button" onClick={() => loadIssues(category)}>다시 시도</button></div> : issues.length ? issues.map((issue, index) => (
                <button key={issue.id} type="button" className={`agenda-card${issue.id === selectedIssueId ? " active" : ""}`} aria-pressed={issue.id === selectedIssueId} aria-controls="issue-analysis-panel" onClick={() => selectIssue(issue.id)}>
                  <span className="agenda-rank">{index + 1}</span>
                  <span className="agenda-copy"><span className="agenda-meta"><b className="category-tag">{issue.category}</b>{issue.sourceCount}개 언론사 · {issue.articleCount}건</span><strong>{issue.title}</strong><small>{issue.scoreStatus === "legacy_reanalysis_required" ? "기존 분석 · 재분석 필요" : "제목 기반 묶음 · 사람 검토 전"}</small></span>
                  <span className="agenda-score"><strong>{issue.agendaScore === null ? "–" : issue.agendaScore.toFixed(1)}</strong><small>{issue.agendaScore === null ? "산출 보류" : "관측 의제성"}</small></span>
                </button>
              )) : <div className="empty-state"><strong>분석 결과가 아직 없습니다.</strong><br />관리자 화면에서 실제 기사 분석을 실행하면 여기에 표시됩니다.</div>}
            </div>
            <p className="panel-note"><span aria-hidden="true">ⓘ</span> 첫 화면에는 상위 5개만 표시합니다. 이 수치는 사회적 중요도가 아니라 표본에서 관측된 보도 의제성입니다.</p>
          </aside>

          <article className="detail-panel" id="issue-analysis-panel">
            {!selectedIssue ? <div className="empty-state">분석할 의제를 선택해 주세요.</div> : detailError ? <div className="empty-state error-state" role="alert">{detailError}<button type="button" onClick={retryDetail}>다시 시도</button></div> : !detail || detail.issue.id !== selectedIssueId ? <div className="empty-state" role="status">이슈 근거를 불러오는 중입니다.</div> : (
              <>
                <div className="detail-kicker"><p>{detail.issue.category} · {detail.issue.issueDate} · {detail.issue.sourceCount}개 언론사</p><span className="confidence review">{detail.issue.scoreStatus === "legacy_reanalysis_required" ? "재분석 필요" : "사람 검토 전"}</span></div>
                <div className="detail-title-row"><div><h2>{detail.issue.title}</h2><p className="detail-summary">{detail.issue.summary}</p></div><div className="big-score"><strong>{detail.issue.agendaScore === null ? "–" : detail.issue.agendaScore.toFixed(1)}</strong><span>{detail.issue.agendaScore === null ? "SCORE WITHHELD" : "OBSERVED AGENDA"}</span></div></div>
                <div className="detail-metrics"><span>관련 제목 {detail.issue.articleCount}건</span><span>언론사 {detail.issue.sourceCount}곳</span><span>근거 수준: 제목 메타데이터</span><span>확률 표시 안 함</span></div>
                <div className="score-breakdown"><ScorePart label="언론사 커버리지" value={detail.issue.diversityScore} /><ScorePart label="홈페이지 배치" value={detail.issue.placementScore} note={`${detail.issue.placementObservedCount}/${detail.issue.placementTotalCount}건 관측`} /><ScorePart label="기사량" value={detail.issue.volumeScore} /><ScorePart label="동일 매체 후속 보도량" value={detail.issue.followUpVolumeScore} /></div>
                <div className="analysis-tabs" role="tablist" aria-label="이슈 분석 보기">
                  {analysisTabs.map(([value, label]) => <button key={value} id={`analysis-tab-${value}`} type="button" role="tab" aria-selected={tab === value} aria-controls={`analysis-panel-${value}`} tabIndex={tab === value ? 0 : -1} className={tab === value ? "active" : ""} onKeyDown={(event) => handleTabKeyDown(event, value)} onClick={() => setTab(value)}>{label}</button>)}
                </div>
                {tab === "compare" && <div id="analysis-panel-compare" role="tabpanel" aria-labelledby="analysis-tab-compare" className="evidence-first"><header><p className="eyebrow">EVIDENCE FIRST</p><h3>같은 사건, 다른 설명</h3><p>{detail.comparison.reason}</p></header><div className="evidence-grid"><section><span className="step-number">01</span><h4>공통으로 확인된 사실</h4>{detail.comparison.commonFacts.length ? detail.comparison.commonFacts.map((fact) => <article key={fact.id}><strong>{fact.text}</strong><small>{fact.sourceCount}개 언론사 · {fact.articleCount}건 근거</small></article>) : <p className="withheld">근거 부족 · 기사 본문과 독립 출처 관계를 확인할 수 없어 생성하지 않았습니다.</p>}</section><section><span className="step-number">02</span><h4>보도가 갈린 질문</h4>{detail.comparison.divergenceQuestions.length ? detail.comparison.divergenceQuestions.map((question) => <article key={question.id}><strong>{question.question}</strong><small>{question.answerGroups.length}개 답변 그룹</small></article>) : <p className="withheld">판단 불가 · 제목만으로 원인·책임·해법의 차이를 만들지 않습니다.</p>}</section><section><span className="step-number">03</span><h4>누구의 목소리가 실렸나</h4>{detail.comparison.sourceVoices.length ? detail.comparison.sourceVoices.map((voice) => <article key={`${voice.sourceType}-${voice.supports}`}><strong>{voice.sourceType}</strong><p>{voice.supports}</p></article>) : <p className="withheld">검토 필요 · 본문 인용문이 없어 취재원을 판정하지 않습니다.</p>}</section><section><span className="step-number">04</span><h4>기사 두 개만 읽는다면</h4>{detail.comparison.recommendedPair ? <p>{detail.comparison.recommendedPair.reason}</p> : <p className="withheld">추천 보류 · 두 기사의 상호보완성을 근거로 확인할 수 없습니다.</p>}</section></div></div>}
                {tab === "outlets" && <div id="analysis-panel-outlets" role="tabpanel" aria-labelledby="analysis-tab-outlets" className="outlet-list"><p className="expert-note">전문가 보기 · 기사 수와 배치는 편향이나 사실성 판정이 아닙니다.</p><div className="outlet-head"><span>언론사</span><span>기사 수</span><span>배치</span><span>대표 제목</span></div>{detail.outlets.map((outlet) => { const article = detail.articles.find((entry) => entry.source === outlet.source); return <div className="outlet-row" key={outlet.source}><strong>{outlet.source}</strong><b>{outlet.articleCount}건</b><span className="placement-badge">{outlet.placement}</span><p>{article?.title ?? "제목 미확인"}</p></div>; })}</div>}
                {tab === "frames" && <div id="analysis-panel-frames" role="tabpanel" aria-labelledby="analysis-tab-frames" className="frame-layout">{detail.frames.length ? <><div className="frame-chart">{detail.frames.map((frame) => <div className="frame-row" key={frame.frame}><span>{frameLabels[frame.frame] ?? frame.frame}</span><div><i style={{ width: `${frame.score}%`, background: frameColors[frame.frame] }} /></div><b>{frame.score.toFixed(1)}%</b></div>)}</div><div className="evidence-panel"><h3>제목 신호 근거</h3>{detail.frames.map((frame) => <article key={frame.frame}><span style={{ color: frameColors[frame.frame] }}>{frameLabels[frame.frame]}</span><p>{frame.evidenceText ?? "제목에서 직접 근거 표현이 검출되지 않았습니다."}</p><small>{frame.sourceUrl ? <a href={frame.sourceUrl} target="_blank" rel="noopener noreferrer">{frame.source ?? "원문 근거"} ↗</a> : frame.source ?? "출처 없음"} · 제목 포함 기사 비율, 확률 아님</small></article>)}</div></> : <p className="withheld">기존 v1 프레임 결과는 근거 오류 가능성이 있어 숨겼습니다. v2 재분석 후 제목 신호만 표시합니다.</p>}</div>}
                {tab === "articles" && <div id="analysis-panel-articles" role="tabpanel" aria-labelledby="analysis-tab-articles" className="article-table"><div className="article-tools"><strong>관련 기사 {detail.articles.length}건</strong></div><div>{detail.articles.map((article) => <article className="article-item" key={article.id}><span className="article-outlet">{article.source}</span><div><strong>{article.title}</strong><small>{formatDateTime(article.publishedAt)} · 대표 제목과의 제목 유사도 {Math.round((article.similarity ?? 0) * 100)}%</small></div><a className="article-link" href={article.url} target="_blank" rel="noopener noreferrer">원문 ↗</a></article>)}</div></div>}
              </>
            )}
          </article>
        </section>

        <section className="live-feed" id="live-feed" aria-labelledby="live-feed-title">
          <div className="section-heading live-heading"><div><p className="eyebrow">EXPLORE ARTICLE LINKS</p><h2 id="live-feed-title">기사 탐색</h2></div><p>{articles.length.toLocaleString("ko-KR")} / {articleTotal.toLocaleString("ko-KR")}건 · 게시순</p></div>
          <form className="live-filter-form" role="search" onSubmit={submitFilters}>
            <label><span>제목 검색</span><input type="search" maxLength={100} value={filters.q} onChange={(event) => setFilters({ ...filters, q: event.target.value })} placeholder="검색어 입력" /></label>
            <label><span>언론사</span><select value={filters.source} onChange={(event) => setFilters({ ...filters, source: event.target.value })}><option value="">전체</option>{["한겨레","경향신문","한국일보","중앙일보","조선일보"].map((source) => <option key={source}>{source}</option>)}</select></label>
            <label><span>분야</span><select value={filters.section} onChange={(event) => setFilters({ ...filters, section: event.target.value })}><option value="">전체</option>{["정치","경제","사회","문화","스포츠","지역","국제","IT_과학"].map((section) => <option key={section}>{section}</option>)}</select></label>
            <label><span>날짜</span><input type="date" value={filters.date} onChange={(event) => setFilters({ ...filters, date: event.target.value })} /></label>
            <div className="live-filter-actions"><button type="submit" disabled={articleLoading}>검색</button><button type="button" onClick={resetFilters}>초기화</button></div>
          </form>
          {articleError ? <p className="live-empty error-state" role="alert">{articleError} <button type="button" onClick={() => loadArticles()}>다시 시도</button></p> : !articles.length && !articleLoading ? <p className="live-empty">조건에 맞는 기사가 없습니다.</p> : <div className="live-article-grid" aria-busy={articleLoading}>{articles.map((article) => <article className="live-article" key={article.id}><div className="live-article-meta"><span className="live-source">{article.source}</span><span>{article.section ?? "분야 미분류"}</span></div><h3><a href={article.url} target="_blank" rel="noopener noreferrer">{article.title}</a></h3><p className="live-article-detail">게시 {formatDateTime(article.publishedAt)}<br />홈페이지 {article.homepagePlacement ? placementLabels[article.homepagePlacement] : "배치 미확인"}{article.homepageRank ? ` · ${article.homepageRank}위` : ""}</p><a className="live-original" href={article.url} target="_blank" rel="noopener noreferrer">원문 기사 보기 ↗</a></article>)}</div>}
          <div className="live-pagination">{articleOffset < articleTotal && <button type="button" disabled={articleLoading} onClick={() => loadArticles({ append: true })}>{articleLoading ? "불러오는 중" : "기사 더 보기"}</button>}</div>
          <p className="panel-note"><span aria-hidden="true">ⓘ</span> 제목·원문 주소·게시 시각·분류만 저장하며 기사 본문은 저장하지 않습니다.</p>
        </section>

        <section className="method-preview" id="comparison" aria-labelledby="method-title"><div><p className="eyebrow">EXPLAINABLE BY DESIGN</p><h2 id="method-title">판정보다 <em>근거</em>를 먼저 보여줍니다.</h2></div><div className="principles"><article><span>01</span><h3>근거 없으면 보류</h3><p>기사에 없는 사실·설명·취재원을 생성하지 않고 판단 불가 상태를 공개합니다.</p></article><article><span>02</span><h3>사건과 설명을 분리</h3><p>같은 주제라도 다른 사건은 분리하고, 설명 차이는 근거가 있을 때만 보여줍니다.</p></article><article><span>03</span><h3>확률처럼 보이지 않게</h3><p>보정되지 않은 신뢰도 대신 표본·커버리지·관측률·검토 상태를 표시합니다.</p></article></div></section>
      </main>

      <footer><div className="brand footer-brand"><span className="brand-mark" aria-hidden="true">AF</span><span className="brand-copy"><b>AgendaFrame</b><small>Google Capstone</small></span></div><p>실제 기사 메타데이터 · agenda-rules-v2 · 본문 근거 없는 비교는 보류</p><button type="button" onClick={() => setMethodOpen(true)}>분석 방법론 보기</button></footer>

      <dialog ref={methodDialogRef} className="modal" aria-labelledby="method-dialog-title" onCancel={() => setMethodOpen(false)} onClose={() => setMethodOpen(false)}><form method="dialog"><button className="modal-close" aria-label="닫기">×</button></form><p className="eyebrow">OBSERVED AGENDA v2</p><h2 id="method-dialog-title">분석 기준과 현재 한계</h2><p className="modal-lead">이 점수는 사회적 중요도가 아니라 5개 종합일간지 표본에서 관측된 보도 의제성입니다. 홈페이지 배치가 없으면 고정 중립값을 넣지 않고 해당 항목을 제외해 나머지 관측값의 가중치를 다시 계산합니다.</p><div className="formula"><span>언론사 커버리지 <b>35</b></span><i>+</i><span>관측 배치 <b>30</b></span><i>+</i><span>기사량 <b>20</b></span><i>+</i><span>후속 보도량 <b>15</b></span></div><p className="method-caution">기사 본문을 저장하지 않으므로 공통 사실, 원인·책임·해법, 취재원, 상호보완 기사 추천은 현재 보류합니다. 기존 v1 스냅샷은 재분석 전까지 점수를 숨깁니다.</p></dialog>
    </>
  );
}
