"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

type Health = {
  status: string;
  dataAsOf: string | null;
  collection: { articleCount: number; configuredSources: number; latestSourceCount: number; latestStatus: string };
  analysis?: { targetDate: string; provider: string; modelVersion: string; finishedAt: number; articleCount: number; issueCount: number } | null;
};

type Issue = {
  id: string;
  issueDate: string;
  title: string;
  summary: string;
  category: string;
  articleCount: number;
  sourceCount: number;
  agendaScore: number;
  diversityScore: number;
  placementScore: number;
  volumeScore: number;
  repetitionScore: number;
  confidence: number;
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

type Frame = { frame: string; score: number; confidence: number; evidenceText?: string | null; source?: string | null; articleId?: string | null };
type IssueDetail = {
  issue: Issue & { provider: string; modelVersion: string; analyzedAt: number };
  articles: Article[];
  frames: Frame[];
  report: { summary: string; missingPerspective: string; caution: string; provider: string; modelVersion: string } | null;
  outlets: Array<{ source: string; articleCount: number; placement: string }>;
};

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

function ScorePart({ label, value }: { label: string; value: number }) {
  return (
    <div className="score-part">
      <header><span>{label}</span><b>{value.toFixed(1)}</b></header>
      <div className="score-track"><i style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></div>
    </div>
  );
}

export default function AgendaDashboard() {
  const [health, setHealth] = useState<Health | null>(null);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [issueTotal, setIssueTotal] = useState(0);
  const [categories, setCategories] = useState<Array<{ category: string; count: number }>>([]);
  const [category, setCategory] = useState("전체");
  const [selectedIssueId, setSelectedIssueId] = useState("");
  const [detail, setDetail] = useState<IssueDetail | null>(null);
  const [tab, setTab] = useState<"outlets" | "frames" | "report" | "articles">("outlets");
  const [loadingIssues, setLoadingIssues] = useState(true);
  const [articles, setArticles] = useState<Article[]>([]);
  const [articleTotal, setArticleTotal] = useState(0);
  const [articleOffset, setArticleOffset] = useState(0);
  const [articleLoading, setArticleLoading] = useState(false);
  const [filters, setFilters] = useState({ q: "", source: "", section: "", date: "" });
  const [methodOpen, setMethodOpen] = useState(false);

  const loadHealth = useCallback(async () => {
    const response = await fetch("/api/health", { cache: "no-store" });
    if (response.ok) setHealth(await response.json());
  }, []);

  const loadIssues = useCallback(async (nextCategory = category) => {
    setLoadingIssues(true);
    try {
      const parameters = new URLSearchParams({ limit: "30" });
      if (nextCategory !== "전체") parameters.set("category", nextCategory);
      const response = await fetch(`/api/issues?${parameters}`, { cache: "no-store" });
      if (!response.ok) throw new Error("issues unavailable");
      const payload = await response.json();
      const nextIssues = Array.isArray(payload.issues) ? payload.issues : [];
      setIssues(nextIssues);
      setIssueTotal(Number(payload.total) || 0);
      setCategories(Array.isArray(payload.categories) ? payload.categories : []);
      setSelectedIssueId((current) => nextIssues.some((issue: Issue) => issue.id === current) ? current : (nextIssues[0]?.id ?? ""));
    } finally {
      setLoadingIssues(false);
    }
  }, [category]);

  const loadArticles = useCallback(async ({ append = false, nextFilters = filters } = {}) => {
    if (articleLoading) return;
    setArticleLoading(true);
    try {
      const offset = append ? articleOffset : 0;
      const parameters = new URLSearchParams({ limit: "50", offset: String(offset) });
      Object.entries(nextFilters).forEach(([key, value]) => { if (value.trim()) parameters.set(key, value.trim()); });
      const response = await fetch(`/api/articles?${parameters}`, { cache: "no-store" });
      if (!response.ok) throw new Error("articles unavailable");
      const payload = await response.json();
      const next = Array.isArray(payload.articles) ? payload.articles : [];
      setArticles((current) => append ? [...current, ...next] : next);
      setArticleTotal(Number(payload.total) || 0);
      setArticleOffset(offset + next.length);
    } finally {
      setArticleLoading(false);
    }
  }, [articleLoading, articleOffset, filters]);

  useEffect(() => {
    // Initial API synchronization; each loader owns its loading state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    Promise.allSettled([loadHealth(), loadIssues("전체"), loadArticles()]);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!selectedIssueId) return;
    let cancelled = false;
    fetch(`/api/issues/${encodeURIComponent(selectedIssueId)}`, { cache: "no-store" })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("detail unavailable")))
      .then((payload) => { if (!cancelled) setDetail(payload); })
      .catch(() => { if (!cancelled) setDetail(null); });
    return () => { cancelled = true; };
  }, [selectedIssueId]);

  const handleCategory = (value: string) => {
    setCategory(value);
    setDetail(null);
    loadIssues(value);
  };

  const submitFilters = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    loadArticles({ append: false, nextFilters: filters });
  };

  const resetFilters = () => {
    const empty = { q: "", source: "", section: "", date: "" };
    setFilters(empty);
    loadArticles({ append: false, nextFilters: empty });
  };

  const selectedIssue = useMemo(() => issues.find((issue) => issue.id === selectedIssueId) ?? null, [issues, selectedIssueId]);
  const categoryOptions = ["전체", ...categories.map((entry) => entry.category)];

  return (
    <>
      <a className="skip-link" href="#agenda-workspace">본문으로 건너뛰기</a>
      <header className="topbar">
        <a className="brand" href="#top" aria-label="AgendaFrame 홈"><span className="brand-mark" aria-hidden="true">AF</span><span className="brand-copy"><b>AgendaFrame</b><small>의제·프레임 분석</small></span></a>
        <nav className="topnav" aria-label="주요 메뉴"><a href="#agenda-workspace">오늘의 의제</a><a href="#live-feed">실제 기사</a><button type="button" onClick={() => setMethodOpen(true)}>분석 기준</button></nav>
        <div className="top-actions"><span className="demo-badge live"><i aria-hidden="true" /> 실제 기사 · 규칙 분석</span><button className="refresh-button" type="button" onClick={() => Promise.allSettled([loadHealth(), loadIssues(category), loadArticles()])}><span aria-hidden="true">↻</span><span>갱신</span></button></div>
      </header>

      <div id="top" />
      <main>
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero-copy">
            <p className="eyebrow">{health?.analysis?.targetDate?.replaceAll("-", ".") ?? todayKst()} · KST · 실제 미디어 의제</p>
            <h1 id="hero-title">오늘, 언론은<br /><em>무엇을 크게</em> 다뤘을까?</h1>
            <p className="hero-description">5개 전국 종합일간지의 실제 기사 메타데이터를 이슈로 묶고, 의제 점수와 제목 기반 프레임 근거를 투명하게 비교합니다.</p>
            <button className="text-button" type="button" onClick={() => setMethodOpen(true)}>의제 점수와 분석 한계 보기 <span aria-hidden="true">↗</span></button>
          </div>
          <div className="snapshot" aria-label="데이터 현황">
            <div className="snapshot-heading"><span>DATA SNAPSHOT</span><strong>{formatDateTime(health?.analysis?.finishedAt ?? health?.dataAsOf)} 확인</strong></div>
            <div className="stat-grid">
              <article><span>분석 언론사</span><strong>{health?.collection.configuredSources ?? 5}</strong><small>2 · 1 · 2 표본</small></article>
              <article><span>저장 기사</span><strong>{(health?.collection.articleCount ?? 0).toLocaleString("ko-KR")}</strong><small>본문 미저장</small></article>
              <article><span>분석 이슈</span><strong>{health?.analysis?.issueCount ?? issueTotal}</strong><small>{health?.analysis?.targetDate ?? "분석 대기"}</small></article>
              <article><span>분석 방식</span><strong className="status-value">무료</strong><small>규칙 기반 v1</small></article>
            </div>
            <div className="pipeline-strip"><span>BigKinds</span><i /><span>클러스터링</span><i /><span>점수화</span><i /><span>프레임 분석</span></div>
          </div>
        </section>

        <section className="workspace" id="agenda-workspace" aria-label="실제 의제 분석 화면">
          <aside className="ranking-panel" aria-labelledby="ranking-title">
            <div className="section-heading"><div><p className="eyebrow">AGENDA RANKING</p><h2 id="ranking-title">실제 의제</h2></div><span className="issue-count">상위 {issues.length} / 전체 {issueTotal}</span></div>
            <div className="filter-row" aria-label="정책 분야 필터">
              {categoryOptions.map((value) => <button key={value} type="button" className={`filter-pill${category === value ? " active" : ""}`} aria-pressed={category === value} onClick={() => handleCategory(value)}>{value}</button>)}
            </div>
            <div className="agenda-list" aria-live="polite">
              {loadingIssues ? <div className="empty-state">실제 의제를 불러오는 중입니다.</div> : issues.length ? issues.map((issue, index) => (
                <button key={issue.id} type="button" className={`agenda-card${issue.id === selectedIssueId ? " active" : ""}`} aria-pressed={issue.id === selectedIssueId} onClick={() => { setSelectedIssueId(issue.id); setTab("outlets"); }}>
                  <span className="agenda-rank">{index + 1}</span>
                  <span className="agenda-copy"><span className="agenda-meta"><b className="category-tag">{issue.category}</b>{issue.sourceCount}개 언론사 · {issue.articleCount}건</span><strong>{issue.title}</strong><small>규칙 분석 신뢰도 {issue.confidence}%</small></span>
                  <span className="agenda-score"><strong>{issue.agendaScore.toFixed(1)}</strong><small>의제 점수</small></span>
                </button>
              )) : <div className="empty-state"><strong>분석 결과가 아직 없습니다.</strong><br />관리자 화면에서 실제 기사 분석을 실행하면 여기에 표시됩니다.</div>}
            </div>
            <p className="panel-note"><span aria-hidden="true">ⓘ</span> 현재는 비용 없는 제목·분류 규칙으로 분석하며, 향후 Vertex AI 연결 시 같은 화면과 데이터 구조를 유지합니다.</p>
          </aside>

          <article className="detail-panel" aria-live="polite">
            {!selectedIssue ? <div className="empty-state">분석할 의제를 선택해 주세요.</div> : !detail ? <div className="empty-state">이슈 근거를 불러오는 중입니다.</div> : (
              <>
                <div className="detail-kicker"><p>{detail.issue.category} · {detail.issue.issueDate} · {detail.issue.sourceCount}개 언론사</p><span className="confidence">신뢰도 {detail.issue.confidence}%</span></div>
                <div className="detail-title-row"><div><h2>{detail.issue.title}</h2><p className="detail-summary">{detail.issue.summary}</p></div><div className="big-score"><strong>{detail.issue.agendaScore.toFixed(1)}</strong><span>AGENDA SCORE</span></div></div>
                <div className="detail-metrics"><span>관련 기사 {detail.issue.articleCount}건</span><span>언론사 {detail.issue.sourceCount}곳</span><span>분석 {detail.issue.provider}</span></div>
                <div className="score-breakdown"><ScorePart label="언론사 다양성" value={detail.issue.diversityScore} /><ScorePart label="홈페이지 배치" value={detail.issue.placementScore} /><ScorePart label="기사 수" value={detail.issue.volumeScore} /><ScorePart label="반복 노출" value={detail.issue.repetitionScore} /></div>
                <div className="analysis-tabs" role="tablist" aria-label="이슈 분석 보기">
                  {([['outlets','언론사 비교'],['frames','프레임'],['report','분석 리포트'],['articles','관련 기사']] as const).map(([value, label]) => <button key={value} type="button" role="tab" aria-selected={tab === value} className={tab === value ? "active" : ""} onClick={() => setTab(value)}>{label}</button>)}
                </div>
                {tab === "outlets" && <div className="outlet-list"><div className="outlet-head"><span>언론사</span><span>기사 수</span><span>배치</span><span>대표 제목</span></div>{detail.outlets.map((outlet) => { const article = detail.articles.find((entry) => entry.source === outlet.source); return <div className="outlet-row" key={outlet.source}><strong>{outlet.source}</strong><b>{outlet.articleCount}건</b><span className="placement-badge">{outlet.placement}</span><p>{article?.title ?? "제목 미확인"}</p></div>; })}</div>}
                {tab === "frames" && <div className="frame-layout"><div className="frame-chart">{detail.frames.map((frame) => <div className="frame-row" key={frame.frame}><span>{frameLabels[frame.frame] ?? frame.frame}</span><div><i style={{ width: `${frame.score}%`, background: frameColors[frame.frame] }} /></div><b>{frame.score.toFixed(1)}%</b></div>)}</div><div className="evidence-panel"><h3>제목 근거</h3>{detail.frames.map((frame) => <article key={frame.frame}><span style={{ color: frameColors[frame.frame] }}>{frameLabels[frame.frame]}</span><p>{frame.evidenceText ?? "직접 근거 표현이 확인되지 않았습니다."}</p><small>{frame.source ?? "출처 미확인"} · 신뢰도 {frame.confidence}%</small></article>)}</div></div>}
                {tab === "report" && detail.report && <div className="report-card"><section className="report-block"><span>주요 관찰</span><p>{detail.report.summary}</p></section><section className="report-block"><span>상대적으로 적은 관점</span><p>{detail.report.missingPerspective}</p></section><section className="report-block caution"><span>해석 주의</span><p>{detail.report.caution}</p></section></div>}
                {tab === "articles" && <div className="article-table"><div className="article-tools"><strong>관련 기사 {detail.articles.length}건</strong></div><div>{detail.articles.map((article) => <article className="article-item" key={article.id}><span className="article-outlet">{article.source}</span><div><strong>{article.title}</strong><small>{formatDateTime(article.publishedAt)} · 유사도 {Math.round((article.similarity ?? 0) * 100)}%</small></div><a className="article-link" href={article.url} target="_blank" rel="noopener noreferrer">원문 ↗</a></article>)}</div></div>}
              </>
            )}
          </article>
        </section>

        <section className="live-feed" id="live-feed" aria-labelledby="live-feed-title">
          <div className="section-heading live-heading"><div><p className="eyebrow">LIVE ARTICLE LINKS</p><h2 id="live-feed-title">실제 연결 기사</h2></div><p>{articles.length.toLocaleString("ko-KR")} / {articleTotal.toLocaleString("ko-KR")}건 · 실제 게시순</p></div>
          <form className="live-filter-form" role="search" onSubmit={submitFilters}>
            <label><span>제목 검색</span><input type="search" maxLength={100} value={filters.q} onChange={(event) => setFilters({ ...filters, q: event.target.value })} placeholder="검색어 입력" /></label>
            <label><span>언론사</span><select value={filters.source} onChange={(event) => setFilters({ ...filters, source: event.target.value })}><option value="">전체</option>{["한겨레","경향신문","한국일보","중앙일보","조선일보"].map((source) => <option key={source}>{source}</option>)}</select></label>
            <label><span>분야</span><select value={filters.section} onChange={(event) => setFilters({ ...filters, section: event.target.value })}><option value="">전체</option>{["정치","경제","사회","문화","스포츠","지역","국제","IT_과학"].map((section) => <option key={section}>{section}</option>)}</select></label>
            <label><span>날짜</span><input type="date" value={filters.date} onChange={(event) => setFilters({ ...filters, date: event.target.value })} /></label>
            <div className="live-filter-actions"><button type="submit" disabled={articleLoading}>검색</button><button type="button" onClick={resetFilters}>초기화</button></div>
          </form>
          {!articles.length && !articleLoading ? <p className="live-empty">조건에 맞는 기사가 없습니다.</p> : <div className="live-article-grid" aria-live="polite">{articles.map((article) => <article className="live-article" key={article.id}><div className="live-article-meta"><span className="live-source">{article.source}</span><span>{article.section ?? "분야 미분류"}</span></div><h3><a href={article.url} target="_blank" rel="noopener noreferrer">{article.title}</a></h3><p className="live-article-detail">게시 {formatDateTime(article.publishedAt)}<br />홈페이지 {article.homepagePlacement ? placementLabels[article.homepagePlacement] : "배치 미확인"}{article.homepageRank ? ` · ${article.homepageRank}위` : ""}</p><a className="live-original" href={article.url} target="_blank" rel="noopener noreferrer">원문 기사 보기 ↗</a></article>)}</div>}
          <div className="live-pagination">{articleOffset < articleTotal && <button type="button" disabled={articleLoading} onClick={() => loadArticles({ append: true })}>{articleLoading ? "불러오는 중" : "기사 더 보기"}</button>}</div>
          <p className="panel-note"><span aria-hidden="true">ⓘ</span> 제목·원문 주소·게시 시각·분류만 저장하며 기사 본문은 저장하지 않습니다.</p>
        </section>

        <section className="method-preview" id="comparison" aria-labelledby="method-title"><div><p className="eyebrow">EXPLAINABLE BY DESIGN</p><h2 id="method-title">판정보다 <em>근거</em>를 먼저 보여줍니다.</h2></div><div className="principles"><article><span>01</span><h3>실제 기사 기반</h3><p>BigKinds에서 가져온 실제 제목과 원문 링크를 기준으로 분석합니다.</p></article><article><span>02</span><h3>교체 가능한 분석기</h3><p>현재 무료 규칙 분석과 향후 Vertex AI가 같은 데이터 계약을 사용합니다.</p></article><article><span>03</span><h3>한계까지 공개</h3><p>점수·근거·신뢰도와 함께 현재 분석 방식과 한계를 표시합니다.</p></article></div></section>
      </main>

      <footer><div className="brand footer-brand"><span className="brand-mark" aria-hidden="true">AF</span><span className="brand-copy"><b>AgendaFrame</b><small>Google Capstone</small></span></div><p>실제 기사 메타데이터 · 무료 규칙 기반 분석 · Vertex AI 연동 준비 구조</p><button type="button" onClick={() => setMethodOpen(true)}>분석 방법론 보기</button></footer>

      {methodOpen && <dialog className="modal" open aria-labelledby="method-dialog-title"><form method="dialog" onSubmit={(event) => { event.preventDefault(); setMethodOpen(false); }}><button className="modal-close" aria-label="닫기">×</button></form><p className="eyebrow">AGENDA SCORE v1.0</p><h2 id="method-dialog-title">분석 기준과 현재 한계</h2><p className="modal-lead">언론사 다양성 35%, 홈페이지 배치 30%, 기사 수 20%, 반복 노출 15%를 합산합니다. 배치 정보가 없으면 낮은 중립값을 적용하고 추정하지 않습니다.</p><div className="formula"><span>다양성 <b>35%</b></span><i>+</i><span>배치 <b>30%</b></span><i>+</i><span>기사 수 <b>20%</b></span><i>+</i><span>반복 <b>15%</b></span></div><p className="method-caution">현재 프레임과 리포트는 기사 제목을 이용한 무료 규칙 분석입니다. Vertex AI·Gemini가 연결되기 전까지 AI 분석으로 오해하지 않도록 결과에 방식을 표시합니다.</p></dialog>}
    </>
  );
}
