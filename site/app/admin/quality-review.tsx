"use client";

import { useState } from "react";

const SOURCES = ["한겨레", "경향신문", "한국일보", "중앙일보", "조선일보"] as const;

function apiError(result: unknown, fallback: string) {
  if (!result || typeof result !== "object") return fallback;
  const error = (result as { error?: unknown }).error;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && typeof (error as { message?: unknown }).message === "string") return (error as { message: string }).message;
  return fallback;
}

type QueueIssue = {
  id: string;
  title: string;
  category: string;
  articleCount: number;
  sourceCount: number;
  agendaScore: number;
  confidence: number;
  reviewId?: string | null;
  clusterVerdict?: "correct" | "partial" | "incorrect" | null;
  agendaVerdict?: "appropriate" | "overstated" | "understated" | "uncertain" | null;
  frameVerdict?: "appropriate" | "partial" | "inappropriate" | "uncertain" | null;
  misplacedCount?: number;
  missingCount?: number;
};

type QualityMetrics = {
  reviewedIssueCount: number;
  minimumSample: number;
  targetSample: number;
  progressPercent: number;
  sampleStatus: "collecting" | "ready";
  estimatedPrecision: number | null;
  estimatedRecall: number | null;
  overmergeRate: number | null;
  undermergeRate: number | null;
  pairwiseF1: number | null;
  hardNegativeAccuracy: number | null;
  clusterAgreement: number | null;
  agendaAgreement: number | null;
  frameAgreement: number | null;
  sourceDiversityCoverage: number | null;
  reviewedArticleCount: number;
  misplacedArticleCount: number;
  missingArticleCount: number;
};

type Article = {
  id: string;
  source: string;
  title: string;
  url: string;
  similarity: number;
  representative: number;
};

type IssueDetail = {
  issue: QueueIssue;
  articles: Article[];
  frames: Array<{ frame: string; score: number; confidence: number; evidenceText?: string | null }>;
};

type MissingArticle = { key: string; source: string; title: string; url: string; note: string };

type ReviewForm = {
  clusterVerdict: "correct" | "partial" | "incorrect";
  agendaVerdict: "appropriate" | "overstated" | "understated" | "uncertain";
  frameVerdict: "appropriate" | "partial" | "inappropriate" | "uncertain";
  notes: string;
};

const defaultForm: ReviewForm = {
  clusterVerdict: "correct",
  agendaVerdict: "appropriate",
  frameVerdict: "appropriate",
  notes: "",
};

function metric(value: number | null) {
  return value === null ? "—" : `${value.toFixed(1)}%`;
}

function updateMissingRow(rows: MissingArticle[], index: number, field: keyof MissingArticle, value: string) {
  return rows.map((row, rowIndex) => rowIndex === index ? { ...row, [field]: value } : row);
}

function newMissingArticle(): MissingArticle {
  return { key: crypto.randomUUID(), source: "", title: "", url: "", note: "" };
}

export default function QualityReview({ token, analysisDate }: { token: string; analysisDate: string }) {
  const [issues, setIssues] = useState<QueueIssue[]>([]);
  const [metrics, setMetrics] = useState<QualityMetrics | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState<IssueDetail | null>(null);
  const [form, setForm] = useState<ReviewForm>(defaultForm);
  const [flaggedArticleIds, setFlaggedArticleIds] = useState<string[]>([]);
  const [missingArticles, setMissingArticles] = useState<MissingArticle[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("검증 목록을 불러오면 상위 50개 이슈를 순서대로 검토할 수 있습니다.");

  function authHeaders(json = false) {
    return {
      authorization: `Bearer ${token.trim()}`,
      ...(json ? { "content-type": "application/json" } : {}),
    };
  }

  async function openIssue(issueId: string, manageBusy = true) {
    if (!token.trim()) {
      setStatus("관리자 토큰을 입력하세요.");
      return;
    }
    if (manageBusy) setBusy(true);
    setSelectedId(issueId);
    setStatus("이슈와 기존 검토 내용을 불러오는 중…");
    try {
      const [detailResponse, reviewResponse] = await Promise.all([
        fetch(`/api/issues/${encodeURIComponent(issueId)}`),
        fetch(`/api/quality/reviews/${encodeURIComponent(issueId)}`, { headers: authHeaders() }),
      ]);
      const [detailResult, reviewResult] = await Promise.all([detailResponse.json(), reviewResponse.json()]);
      if (!detailResponse.ok) throw new Error(detailResult.error ?? "이슈를 불러오지 못했습니다.");
      if (!reviewResponse.ok) throw new Error(reviewResult.error ?? "검토 내용을 불러오지 못했습니다.");
      setDetail(detailResult);
      setFlaggedArticleIds(reviewResult.flaggedArticleIds ?? []);
      setMissingArticles((reviewResult.missingArticles ?? []).map((article: MissingArticle) => ({
        key: article.key ?? crypto.randomUUID(),
        source: article.source ?? "",
        title: article.title ?? "",
        url: article.url ?? "",
        note: article.note ?? "",
      })));
      setForm(reviewResult.review ? {
        clusterVerdict: reviewResult.review.clusterVerdict,
        agendaVerdict: reviewResult.review.agendaVerdict,
        frameVerdict: reviewResult.review.frameVerdict,
        notes: reviewResult.review.notes ?? "",
      } : defaultForm);
      setStatus(reviewResult.review ? "저장된 검토 결과를 불러왔습니다." : "아직 검토하지 않은 이슈입니다.");
    } catch (error) {
      setDetail(null);
      setStatus(error instanceof Error ? error.message : "이슈를 불러오지 못했습니다.");
    } finally {
      if (manageBusy) setBusy(false);
    }
  }

  async function loadQueue(preferredIssueId = selectedId) {
    if (!token.trim()) return setStatus("관리자 토큰을 입력하세요.");
    if (!analysisDate) return setStatus("검증할 날짜를 선택하세요.");
    setBusy(true);
    setStatus(`${analysisDate} 검증 목록을 불러오는 중…`);
    try {
      const response = await fetch(`/api/quality?date=${encodeURIComponent(analysisDate)}&limit=50`, { headers: authHeaders() });
      const result = await response.json();
      if (!response.ok) throw new Error(apiError(result, "검증 목록을 불러오지 못했습니다."));
      setIssues(result.issues ?? []);
      setMetrics(result.metrics ?? null);
      if (!result.issues?.length) {
        setDetail(null);
        setSelectedId("");
        setStatus("이 날짜의 분석 결과가 없습니다. 먼저 일일 분석을 실행하세요.");
        return;
      }
      const nextId = result.issues.some((issue: QueueIssue) => issue.id === preferredIssueId) ? preferredIssueId : result.issues[0].id;
      await openIssue(nextId, false);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "검증 목록을 불러오지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  function toggleFlag(articleId: string) {
    setFlaggedArticleIds((current) => current.includes(articleId) ? current.filter((id) => id !== articleId) : [...current, articleId]);
  }

  async function saveReview() {
    if (!detail) return setStatus("먼저 검토할 이슈를 선택하세요.");
    setBusy(true);
    setStatus("검토 결과를 저장하는 중…");
    try {
      const completeMissing = missingArticles.filter((article) => article.source || article.title || article.url || article.note);
      const response = await fetch(`/api/quality/reviews/${encodeURIComponent(detail.issue.id)}`, {
        method: "PUT",
        headers: authHeaders(true),
        body: JSON.stringify({ ...form, flaggedArticleIds, missingArticles: completeMissing }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(apiError(result, "검토 결과를 저장하지 못했습니다."));
      setStatus(`저장 완료: 잘못 묶인 기사 ${result.misplacedCount}건 · 누락 기사 ${result.missingCount}건`);
      await loadQueue(detail.issue.id);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "검토 결과를 저장하지 못했습니다.");
      setBusy(false);
    }
  }

  const metricCards = metrics ? [
    ["추정 정밀도", metric(metrics.estimatedPrecision)],
    ["추정 재현율", metric(metrics.estimatedRecall)],
    ["과병합률", metric(metrics.overmergeRate)],
    ["과소병합률", metric(metrics.undermergeRate)],
    ["Pairwise F1", metric(metrics.pairwiseF1)],
    ["Hard-negative 정확도", metric(metrics.hardNegativeAccuracy)],
    ["기사 묶음 일치", metric(metrics.clusterAgreement)],
    ["의제 점수 동의", metric(metrics.agendaAgreement)],
    ["프레임 동의", metric(metrics.frameAgreement)],
    ["언론사 다양성", metric(metrics.sourceDiversityCoverage)],
  ] : [];

  return <section className="import-card quality-card" aria-labelledby="quality-title">
    <header>
      <div><p className="eyebrow">STEP 03</p><h2 id="quality-title">분석 품질 검증</h2></div>
      <span className="free-badge">사람 검토 기반</span>
    </header>

    <div className="quality-toolbar">
      <div>
        <b>{analysisDate || "날짜 미선택"}</b>
        <span>상위 50개 이슈 · 최소 표본 30개</span>
      </div>
      <button className="quality-load" type="button" onClick={() => loadQueue()} disabled={busy}>{busy ? "처리 중…" : "검증 목록 불러오기"}</button>
    </div>

    {metrics && <div className="quality-summary" aria-label="품질 검증 요약">
      <div className="quality-progress-copy">
        <span>검증 진행</span>
        <b>{metrics.reviewedIssueCount}/{metrics.targetSample}</b>
        <small>{metrics.sampleStatus === "ready" ? "최소 표본을 충족했습니다." : `최소 표본까지 ${Math.max(0, metrics.minimumSample - metrics.reviewedIssueCount)}개 남았습니다.`}</small>
      </div>
      <progress value={metrics.reviewedIssueCount} max={metrics.targetSample}>검증 {metrics.progressPercent}%</progress>
      <div className="quality-metrics">{metricCards.map(([label, value]) => <div key={label}><span>{label}</span><b>{value}</b></div>)}</div>
      <p>사람 검토 기반 추정치입니다. 정밀도는 잘못 묶인 기사, 재현율은 직접 등록한 누락 기사에 따라 계산됩니다.</p>
    </div>}

    {!!issues.length && <div className="quality-workbench">
      <aside className="quality-queue" aria-label="검증할 이슈 목록">
        <div className="quality-queue-title"><b>검증 목록</b><span>{issues.filter((issue) => issue.reviewId).length}/{issues.length} 완료</span></div>
        {issues.map((issue, index) => <button key={issue.id} className={`${selectedId === issue.id ? "selected" : ""} ${issue.reviewId ? "reviewed" : ""}`} type="button" onClick={() => openIssue(issue.id)} disabled={busy}>
          <span className="queue-rank">{index + 1}</span>
          <span className="queue-copy"><b>{issue.title}</b><small>{issue.category} · {issue.sourceCount}개사 · {issue.articleCount}건 · {issue.agendaScore.toFixed(1)}점</small></span>
          <span className="queue-state">{issue.reviewId ? "완료" : "대기"}</span>
        </button>)}
      </aside>

      {detail && <div className="quality-review-panel">
        <header className="review-heading">
          <div><span>{detail.issue.category} · 의제 {detail.issue.agendaScore.toFixed(1)}점</span><h3>{detail.issue.title}</h3></div>
          <a href={`/api/issues/${encodeURIComponent(detail.issue.id)}`} target="_blank" rel="noopener noreferrer">원본 JSON ↗</a>
        </header>

        <fieldset className="verdict-grid">
          <legend>분석 결과 판정</legend>
          <label>기사 묶음<select value={form.clusterVerdict} onChange={(event) => setForm({ ...form, clusterVerdict: event.target.value as ReviewForm["clusterVerdict"] })}><option value="correct">정확</option><option value="partial">일부 오류</option><option value="incorrect">부정확</option></select></label>
          <label>의제 점수<select value={form.agendaVerdict} onChange={(event) => setForm({ ...form, agendaVerdict: event.target.value as ReviewForm["agendaVerdict"] })}><option value="appropriate">적절</option><option value="overstated">과대평가</option><option value="understated">과소평가</option><option value="uncertain">판단 보류</option></select></label>
          <label>프레임 분석<select value={form.frameVerdict} onChange={(event) => setForm({ ...form, frameVerdict: event.target.value as ReviewForm["frameVerdict"] })}><option value="appropriate">적절</option><option value="partial">일부 적절</option><option value="inappropriate">부적절</option><option value="uncertain">판단 보류</option></select></label>
        </fieldset>

        <section className="review-section" aria-labelledby="included-articles-title">
          <div className="review-section-title"><div><h4 id="included-articles-title">묶인 기사 검토</h4><p>이 이슈와 무관한 기사를 체크하세요.</p></div><b>{flaggedArticleIds.length}건 오류 표시</b></div>
          <div className="review-articles">{detail.articles.map((article) => <label key={article.id} className={flaggedArticleIds.includes(article.id) ? "flagged" : ""}>
            <input type="checkbox" checked={flaggedArticleIds.includes(article.id)} onChange={() => toggleFlag(article.id)} />
            <span><b>{article.source}</b><a href={article.url} target="_blank" rel="noopener noreferrer">{article.title}</a><small>제목 유사도 {Math.round(Number(article.similarity) * 100)}%{article.representative ? " · 대표 기사" : ""}</small></span>
          </label>)}</div>
        </section>

        <section className="review-section" aria-labelledby="missing-articles-title">
          <div className="review-section-title"><div><h4 id="missing-articles-title">누락 기사 기록</h4><p>같은 이슈인데 시스템이 묶지 못한 원문을 추가하세요.</p></div><button type="button" onClick={() => setMissingArticles([...missingArticles, newMissingArticle()])}>+ 기사 추가</button></div>
          {!missingArticles.length && <p className="empty-review-state">확인된 누락 기사가 없습니다.</p>}
          <div className="missing-list">{missingArticles.map((article, index) => <div className="missing-row" key={article.key}>
            <select aria-label={`${index + 1}번째 누락 기사 언론사`} value={article.source} onChange={(event) => setMissingArticles(updateMissingRow(missingArticles, index, "source", event.target.value))}><option value="">언론사</option>{SOURCES.map((source) => <option key={source} value={source}>{source}</option>)}</select>
            <input aria-label={`${index + 1}번째 누락 기사 제목`} value={article.title} onChange={(event) => setMissingArticles(updateMissingRow(missingArticles, index, "title", event.target.value))} placeholder="기사 제목" />
            <input aria-label={`${index + 1}번째 누락 기사 URL`} type="url" value={article.url} onChange={(event) => setMissingArticles(updateMissingRow(missingArticles, index, "url", event.target.value))} placeholder="https:// 원문 URL" />
            <input aria-label={`${index + 1}번째 누락 기사 메모`} value={article.note} onChange={(event) => setMissingArticles(updateMissingRow(missingArticles, index, "note", event.target.value))} placeholder="누락 근거 메모 (선택)" />
            <button type="button" aria-label={`${index + 1}번째 누락 기사 삭제`} onClick={() => setMissingArticles(missingArticles.filter((_, rowIndex) => rowIndex !== index))}>삭제</button>
          </div>)}</div>
        </section>

        <label className="review-notes">검토 메모<textarea value={form.notes} maxLength={2000} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="판단 근거, 애매한 표현, 재검토할 내용을 기록하세요." /></label>
        <button className="import-submit" type="button" onClick={saveReview} disabled={busy}>{busy ? "처리 중…" : "검토 결과 저장"}</button>
      </div>}
    </div>}

    <p className="admin-status" role="status">{status}</p>
  </section>;
}
