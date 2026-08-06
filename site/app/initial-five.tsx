"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import type {
  InitialFiveManifest,
  InitialFiveManifestIssue,
  IssueAnalysisBundle,
  PublicEvidence,
  SemanticDimensionItem,
  SemanticProfileEntry,
} from "../lib/initial-five/types";
import { ruleExamples } from "../lib/initial-five/rule-answers.mjs";
import SiteHeader from "./site-header";

const dimensionOrder = [
  "problem_definition",
  "causal_interpretation",
  "responsibility_attribution",
  "moral_evaluation",
  "treatment_recommendation",
] as const;

type Dimension = (typeof dimensionOrder)[number];
type DetailTab = "summary" | "framing" | "outlets" | "evidence";

const dimensionLabels: Record<Dimension, string> = {
  problem_definition: "문제 정의",
  causal_interpretation: "원인 해석",
  responsibility_attribution: "책임 귀속",
  moral_evaluation: "규범적 평가",
  treatment_recommendation: "해법·처방",
};

const detailTabs: Array<[DetailTab, string]> = [
  ["summary", "핵심 요약"],
  ["framing", "프레이밍"],
  ["outlets", "매체 비교"],
  ["evidence", "근거 기사"],
];

type SemanticPattern = {
  dimension: Dimension;
  text: string;
  voice?: string;
  articleIds: string[];
  evidence: PublicEvidence[];
};

type SemanticDifference = {
  dimension: Dimension;
  left: SemanticPattern;
  right: SemanticPattern;
  leftOutlet: string;
  rightOutlet: string;
};

function cleanText(value: unknown, fallback = "확인 가능한 설명이 없습니다.") {
  if (typeof value !== "string") return fallback;
  const cleaned = value
    .replace(/\s*([.!?])\1+/g, "$1")
    .replace(/\s+([,.;!?])/g, "$1")
    .trim();
  return cleaned || fallback;
}

function safeRuleSummary(bundle: IssueAnalysisBundle) {
  const value = cleanText(bundle.comparison.data.summary_30_seconds?.main_difference, "");
  if (!value || /긍정|부정|미디어\s*그룹|매체의\s*(동의|의도)|편향/.test(value)) {
    return "규칙 기반 보조 지표만으로는 매체 간 프레이밍 차이를 확정하지 않습니다.";
  }
  return value;
}

function semanticVoiceLabel(kind?: string) {
  if (kind === "journalist_narration") return "기자 서술";
  if (kind === "direct_quote") return "직접 인용";
  if (kind === "indirect_source") return "간접 인용";
  if (kind === "uncertain_quote") return "인용 귀속 확인 필요";
  return "화자 정보 없음";
}

function evidenceFromItem(item: SemanticDimensionItem, articleId: string): PublicEvidence | null {
  const source = item.evidence;
  if (!source?.locator && !source?.sentence_sha256) return null;
  return {
    articleId,
    ...(source.locator ? { locator: source.locator } : {}),
    ...(source.sentence_sha256 ? { sentenceSha256: source.sentence_sha256 } : {}),
  };
}

function successfulSemanticProfiles(bundle: IssueAnalysisBundle) {
  return bundle.semanticProfiles.filter(
    (entry): entry is SemanticProfileEntry & { profile: NonNullable<SemanticProfileEntry["profile"]> } =>
      entry.status === "succeeded" && Boolean(entry.profile),
  );
}

function semanticPatterns(bundle: IssueAnalysisBundle, dimension: Dimension) {
  const grouped = new Map<string, SemanticPattern>();
  for (const entry of successfulSemanticProfiles(bundle)) {
    const articleId = entry.articleId;
    for (const item of entry.profile.dimensions?.[dimension]?.items ?? []) {
      const text = cleanText(item.public_paraphrase, "");
      if (!text) continue;
      const voice = item.voice?.kind;
      const key = `${text}|${voice ?? ""}`;
      const evidence = evidenceFromItem(item, articleId);
      const existing = grouped.get(key);
      if (existing) {
        if (!existing.articleIds.includes(articleId)) existing.articleIds.push(articleId);
        if (evidence) existing.evidence.push(evidence);
      } else {
        grouped.set(key, {
          dimension,
          text,
          voice,
          articleIds: [articleId],
          evidence: evidence ? [evidence] : [],
        });
      }
    }
  }
  return [...grouped.values()].sort(
    (left, right) => right.articleIds.length - left.articleIds.length || left.text.localeCompare(right.text, "ko"),
  );
}

function primarySemanticPattern(bundle: IssueAnalysisBundle) {
  return dimensionOrder
    .flatMap((dimension) => semanticPatterns(bundle, dimension))
    .sort((left, right) => right.articleIds.length - left.articleIds.length)[0] ?? null;
}

function outletForArticle(bundle: IssueAnalysisBundle, articleId: string) {
  return bundle.articles.find((article) => article.articleId === articleId)?.outlet ?? "매체 미상";
}

function semanticDifferences(bundle: IssueAnalysisBundle) {
  const differences: SemanticDifference[] = [];
  for (const dimension of dimensionOrder) {
    const patterns = semanticPatterns(bundle, dimension);
    for (let leftIndex = 0; leftIndex < patterns.length; leftIndex += 1) {
      const left = patterns[leftIndex];
      const leftOutlet = outletForArticle(bundle, left.articleIds[0]);
      const right = patterns.slice(leftIndex + 1).find((candidate) =>
        outletForArticle(bundle, candidate.articleIds[0]) !== leftOutlet,
      );
      if (!right) continue;
      differences.push({
        dimension,
        left,
        right,
        leftOutlet,
        rightOutlet: outletForArticle(bundle, right.articleIds[0]),
      });
      break;
    }
  }
  return differences;
}

function clippedFinding(value: string) {
  return value.length > 54 ? `${value.slice(0, 53).trim()}…` : value;
}

function topicMarker(value: string) {
  const last = value.trim().at(-1);
  if (!last) return "은";
  const code = last.charCodeAt(0);
  if (code >= 0xac00 && code <= 0xd7a3) return (code - 0xac00) % 28 === 0 ? "는" : "은";
  return "은";
}

function primaryFinding(bundle: IssueAnalysisBundle) {
  const difference = semanticDifferences(bundle)[0];
  if (difference) {
    return `${dimensionLabels[difference.dimension]}에서 ${difference.leftOutlet}${topicMarker(difference.leftOutlet)} “${clippedFinding(difference.left.text)}”, ${difference.rightOutlet}${topicMarker(difference.rightOutlet)} “${clippedFinding(difference.right.text)}”에 초점을 뒀습니다.`;
  }
  const pattern = primarySemanticPattern(bundle);
  if (pattern) return pattern.text;
  return "AI 본문 분석이 아직 연결되지 않아 이 의제의 프레이밍 차이를 확정하지 않습니다.";
}

function sourceNames(bundle: IssueAnalysisBundle) {
  return bundle.articles
    .map((article) => article.outlet)
    .filter((outlet): outlet is string => Boolean(outlet))
    .filter((outlet, index, values) => values.indexOf(outlet) === index);
}

function articleFor(bundle: IssueAnalysisBundle, articleId?: string) {
  return bundle.articles.find((article) => article.articleId === articleId) ?? bundle.articles[0];
}

function formatPublishedAt(value: string | null) {
  if (!value) return "게시 시각 미상";
  return value.replace("T", " ").slice(0, 16);
}

function evidenceLabel(evidence?: PublicEvidence) {
  if (!evidence) return "근거 위치 없음";
  const paragraph = evidence.locator?.paragraph;
  const sentence = evidence.locator?.sentence;
  const location = paragraph !== undefined || sentence !== undefined
    ? `${paragraph ?? "-"}문단 ${sentence ?? "-"}문장`
    : "위치 미기록";
  const hash = evidence.sentenceSha256 ? ` · 해시 ${evidence.sentenceSha256.slice(0, 12)}…` : "";
  return `${location}${hash}`;
}

function statusPresentation(succeeded: number, total: number) {
  if (succeeded === total && total > 0) {
    return { label: `AI 본문 ${succeeded}/${total} · 자동 초안`, tone: "ai" };
  }
  if (succeeded > 0) {
    return { label: `AI 본문 ${succeeded}/${total} · 진행 중`, tone: "rule" };
  }
  return { label: `AI 본문 0/${total} · 검토 필요`, tone: "rule" };
}

function StatusPill({ succeeded, total }: { succeeded: number; total: number }) {
  const status = statusPresentation(succeeded, total);
  return <span className={`af-status-pill ${status.tone}`}>{status.label}</span>;
}

function EvidenceLink({
  bundle,
  articleId,
  label = "원문 열기",
}: {
  bundle: IssueAnalysisBundle;
  articleId?: string;
  label?: string;
}) {
  const article = articleFor(bundle, articleId);
  if (!article?.canonicalUrl) return null;
  return (
    <a className="af-inline-link" href={article.canonicalUrl} target="_blank" rel="noopener noreferrer">
      {article.outlet ? `${article.outlet} ${label}` : label}
    </a>
  );
}

function ClusterSummary({ bundle, compact = false }: { bundle: IssueAnalysisBundle; compact?: boolean }) {
  const cluster = bundle.clusterAi;
  if (cluster.status !== "succeeded") {
    return (
      <div className="af-empty-state">
        <strong>같은 사건인지 추가 검토가 필요합니다.</strong>
        <span>클러스터 AI 결과를 성공으로 표시하지 않습니다.</span>
      </div>
    );
  }
  const variants = cluster.narrativeVariants.slice(0, compact ? 0 : 3);
  return (
    <section className={`af-section ${compact ? "af-section-compact" : ""}`} aria-labelledby={`${bundle.issue.issueId}-cluster-title`}>
      <header className="af-section-heading">
        <div>
          <span className="af-section-label">제목 기반 AI 클러스터</span>
          <h3 id={`${bundle.issue.issueId}-cluster-title`}>같은 사건으로 묶은 이유</h3>
        </div>
        <span className="af-section-meta">제목·매체·게시 시각</span>
      </header>
      <p className="af-section-copy">{cleanText(cluster.summary, "클러스터 요약이 없습니다.")}</p>
      {cluster.commonSubjects.length > 0 && (
        <div className="af-chip-row">
          {cluster.commonSubjects.slice(0, 5).map((subject) => <span key={subject}>{subject}</span>)}
        </div>
      )}
      {variants.length > 0 && (
        <ul className="af-variant-list">
          {variants.map((variant, index) => (
            <li key={`${variant.label ?? "variant"}-${index}`}>
              <strong>{variant.label ?? "보도 초점"}</strong>
              <span>{cleanText(variant.description, "설명 없음")}</span>
              <small>{variant.article_ids?.length ?? 0}건 기사 제목에서 관찰</small>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function HomeStatus({ manifest }: { manifest: InitialFiveManifest }) {
  const clusterCount = manifest.issues.filter((issue) => issue.clusterAi.status === "succeeded").length;
  const semanticCount = manifest.issues.reduce(
    (total, issue) => total + issue.semantic.succeededArticleCount,
    0,
  );
  return (
    <section className="af-status-strip" aria-label="초기 5개 분석 상태">
      <span><b>AI 의제 묶음 {clusterCount}/{manifest.issueCount}</b><small>제목·매체·게시 시각 기준</small></span>
      <span><b>AI 본문 분석 {semanticCount}/{manifest.articleCount}</b><small>{semanticCount === manifest.articleCount ? "자동 초안 생성됨" : "아직 완료되지 않음"}</small></span>
      <span><b>규칙 기반 보조 지표 {manifest.articleCount}/{manifest.articleCount}</b><small>AI 분석 건수에 포함하지 않음</small></span>
    </section>
  );
}

function IssueSelector({
  manifest,
  selectedId,
  onSelect,
}: {
  manifest: InitialFiveManifest;
  selectedId: string;
  onSelect: (issueId: string) => void;
}) {
  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, currentIndex: number) => {
    let nextIndex: number | null = null;
    if (event.key === "ArrowDown" || event.key === "ArrowRight") nextIndex = (currentIndex + 1) % manifest.issues.length;
    if (event.key === "ArrowUp" || event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + manifest.issues.length) % manifest.issues.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = manifest.issues.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    const next = manifest.issues[nextIndex];
    onSelect(next.issueId);
    queueMicrotask(() => document.getElementById(`af-issue-tab-${next.issueId}`)?.focus());
  };

  return (
    <section className="af-selector" aria-labelledby="issue-selector-title">
      <header className="af-selector-heading">
        <div><span className="af-section-label">{manifest.basisDate.replaceAll("-", ".")}</span><h2 id="issue-selector-title">초기 5개 의제</h2></div>
        <span className="af-section-meta">{manifest.issueCount}개 · {manifest.articleCount}건</span>
      </header>
      <div className="af-issue-list" role="tablist" aria-label="분석할 의제 선택" aria-orientation="vertical">
        {manifest.issues.map((issue, index) => {
          const active = issue.issueId === selectedId;
          const status = statusPresentation(issue.semantic.succeededArticleCount, issue.articleCount);
          return (
            <button
              type="button"
              role="tab"
              id={`af-issue-tab-${issue.issueId}`}
              aria-selected={active}
              aria-controls="af-selected-issue-panel"
              tabIndex={active ? 0 : -1}
              className={`af-issue-button ${active ? "active" : ""}`}
              key={issue.issueId}
              onClick={() => onSelect(issue.issueId)}
              onKeyDown={(event) => handleKeyDown(event, index)}
            >
              <span className="af-issue-rank">{String(issue.rank).padStart(2, "0")}</span>
              <span className="af-issue-copy">
                <strong>{issue.title}</strong>
                <small>{issue.category ?? "분류 없음"} · {issue.articleCount}건 · {status.label}</small>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function QuickResult({ bundle }: { bundle: IssueAnalysisBundle }) {
  const semantic = bundle.analysisStatus.semantic;
  const sources = sourceNames(bundle);
  const examples = ruleExamples(bundle);
  return (
    <section className="af-quick-result" aria-labelledby="selected-issue-title">
      <header className="af-detail-headline">
        <div>
          <span className="af-section-label">30초 핵심 · 의제 {String(bundle.issue.rank).padStart(2, "0")}</span>
          <h2 id="selected-issue-title">{bundle.issue.title}</h2>
          <p>{primaryFinding(bundle)}</p>
        </div>
        <Link className="af-primary-button" href={`/issues/${encodeURIComponent(bundle.issue.issueId)}`}>상세 분석 보기</Link>
      </header>
      <div className="af-stat-line" aria-label="선택 의제 표본 정보">
        <span><b>{bundle.issue.articleCount}</b>건 기사</span>
        <span><b>{bundle.issue.outletCount}</b>개 매체</span>
        <span><b>{semantic.succeededArticleCount}/{bundle.issue.articleCount}</b> AI 본문</span>
        <span><b>{sources.slice(0, 3).join(" · ")}{sources.length > 3 ? " 외" : ""}</b></span>
      </div>
      <div className="af-quick-foot">
        <StatusPill succeeded={semantic.succeededArticleCount} total={bundle.issue.articleCount} />
        <span>{semantic.succeededArticleCount === bundle.issue.articleCount ? "근거가 연결된 AI 자동 초안이며 사람 검토가 필요합니다." : "규칙 기반 보조 지표를 AI 분석으로 합산하지 않습니다."}</span>
      </div>
      <ClusterSummary bundle={bundle} compact />
      <section className="af-rule-examples" aria-labelledby={`${bundle.issue.issueId}-rule-examples-title`}>
        <header>
          <div>
            <span className="af-section-label">규칙 기반 예시</span>
            <h3 id={`${bundle.issue.issueId}-rule-examples-title`}>이 의제에 이렇게 물어볼 수 있어요</h3>
          </div>
          <Link className="af-inline-link" href={`/tools/ask?issue=${encodeURIComponent(bundle.issue.issueId)}`}>
            이 의제로 AI 대화 열기 →
          </Link>
        </header>
        <p className="af-rule-examples-note">선택한 의제의 공개 비교축에서 만든 미리보기입니다. AI 본문 답변과 구분해 표시합니다.</p>
        <div className="af-rule-example-grid">
          {examples.slice(0, 3).map((example) => (
            <article key={example.question}>
              <strong>{example.question}</strong>
              <p>{example.result.answer}</p>
              <small>규칙 기반 보조 · {example.result.evidence.length}개 근거 연결</small>
            </article>
          ))}
        </div>
      </section>
    </section>
  );
}

async function fetchIssueBundle(issue: InitialFiveManifestIssue, signal: AbortSignal) {
  const endpoints = [
    `/api/initial-five/issues/${encodeURIComponent(issue.issueId)}`,
    `/initial-five/${issue.payloadKey}`,
  ];
  let lastError: Error | null = null;
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        signal,
        headers: { Accept: "application/json" },
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error(`${endpoint} returned ${response.status}`);
      const candidate = await response.json() as IssueAnalysisBundle;
      if (candidate.schemaVersion !== "agendaframe.initial-five.public.v1" || candidate.issue?.issueId !== issue.issueId) {
        throw new Error(`${endpoint} returned an invalid initial-five bundle`);
      }
      return candidate;
    } catch (error) {
      if (signal.aborted) throw error;
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }
  throw lastError ?? new Error("선택한 의제 데이터를 불러오지 못했습니다.");
}

async function fetchManifest(signal: AbortSignal) {
  const endpoints = ["/api/initial-five", "/initial-five/manifest.json"];
  let lastError: Error | null = null;
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        signal,
        headers: { Accept: "application/json" },
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error(`${endpoint} returned ${response.status}`);
      const candidate = await response.json() as InitialFiveManifest;
      if (candidate.schemaVersion !== "agendaframe.initial-five.public.v1" || candidate.issueCount !== 5) {
        throw new Error(`${endpoint} returned an invalid initial-five manifest`);
      }
      return candidate;
    } catch (error) {
      if (signal.aborted) throw error;
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }
  throw lastError ?? new Error("초기 5개 의제 목록을 불러오지 못했습니다.");
}

function issueFromLocation(manifest: InitialFiveManifest, fallback: string) {
  if (typeof window === "undefined") return fallback;
  const issueId = new URLSearchParams(window.location.search).get("issue");
  return issueId && manifest.issues.some((issue) => issue.issueId === issueId) ? issueId : fallback;
}

function InitialFiveBootstrap() {
  const [data, setData] = useState<{ manifest: InitialFiveManifest; bundle: IssueAnalysisBundle } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        const manifest = await fetchManifest(controller.signal);
        const firstIssue = manifest.issues[0];
        if (!firstIssue) throw new Error("초기 5개 매니페스트에 의제가 없습니다.");
        const selectedIssueId = issueFromLocation(manifest, firstIssue.issueId);
        const selectedIssue = manifest.issues.find((issue) => issue.issueId === selectedIssueId) ?? firstIssue;
        const bundle = await fetchIssueBundle(selectedIssue, controller.signal);
        if (!controller.signal.aborted) setData({ manifest, bundle });
      } catch (loadError) {
        if (!controller.signal.aborted) setError(loadError instanceof Error ? loadError.message : "초기 5개 의제를 불러오지 못했습니다.");
      }
    };
    void load();
    return () => controller.abort();
  }, []);

  if (data) return <InitialFiveLoaded manifest={data.manifest} initialBundle={data.bundle} />;
  return (
    <main className="af-page">
      <SiteHeader active="compare" />
      <div className="af-shell">
        <div className={error ? "af-error-state" : "af-empty-state"} role={error ? "alert" : "status"}>
          <strong>{error ? "초기 5개 의제를 불러오지 못했습니다." : "초기 5개 의제를 불러오는 중입니다."}</strong>
          <span>{error ?? "공개 매니페스트와 첫 번째 의제 번들만 가져오고 있습니다."}</span>
        </div>
      </div>
    </main>
  );
}

export default function InitialFiveExperience({
  manifest,
  initialBundle,
}: {
  manifest?: InitialFiveManifest;
  initialBundle?: IssueAnalysisBundle;
} = {}) {
  if (!manifest || !initialBundle) return <InitialFiveBootstrap />;
  return <InitialFiveLoaded manifest={manifest} initialBundle={initialBundle} />;
}

function InitialFiveLoaded({
  manifest,
  initialBundle,
}: {
  manifest: InitialFiveManifest;
  initialBundle: IssueAnalysisBundle;
}) {
  const [selectedId, setSelectedId] = useState(initialBundle.issue.issueId);
  const [bundle, setBundle] = useState(initialBundle);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const bundleCache = useRef(new Map<string, IssueAnalysisBundle>([[initialBundle.issue.issueId, initialBundle]]));
  const activeRequest = useRef<AbortController | null>(null);

  const loadIssue = useCallback(async (issueId: string) => {
    const issue = manifest.issues.find((candidate) => candidate.issueId === issueId);
    if (!issue) return;
    setSelectedId(issueId);
    setLoadError(null);
    const cached = bundleCache.current.get(issueId);
    if (cached) {
      activeRequest.current?.abort();
      setBundle(cached);
      setLoading(false);
      return;
    }

    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    setLoading(true);
    try {
      const nextBundle = await fetchIssueBundle(issue, controller.signal);
      if (controller.signal.aborted) return;
      bundleCache.current.set(issueId, nextBundle);
      setBundle(nextBundle);
    } catch (error) {
      if (controller.signal.aborted) return;
      setLoadError(error instanceof Error ? error.message : "선택한 의제를 불러오지 못했습니다.");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [manifest]);

  useEffect(() => {
    const syncFromHistory = () => {
      const issueId = issueFromLocation(manifest, initialBundle.issue.issueId);
      void loadIssue(issueId);
    };
    syncFromHistory();
    window.addEventListener("popstate", syncFromHistory);
    return () => {
      window.removeEventListener("popstate", syncFromHistory);
      activeRequest.current?.abort();
    };
  }, [initialBundle.issue.issueId, loadIssue, manifest]);

  const selectIssue = (issueId: string) => {
    if (issueId === selectedId && bundle.issue.issueId === issueId) return;
    const url = new URL(window.location.href);
    url.searchParams.set("issue", issueId);
    window.history.pushState({ issueId }, "", `${url.pathname}?${url.searchParams.toString()}${url.hash}`);
    void loadIssue(issueId);
  };

  const visibleBundle = bundle.issue.issueId === selectedId ? bundle : null;

  return (
    <main className="af-page">
      <SiteHeader active="compare" />
      <div className="af-shell">
        <header className="af-home-intro">
          <span className="af-section-label">INITIAL FIVE · {manifest.basisDate.replaceAll("-", ".")}</span>
          <h1>같은 사건의 <em>달라진 설명</em>을 근거로 비교합니다.</h1>
          <p>초기 5개 의제 중 하나를 골라 30초 핵심과 현재 분석 상태를 확인하세요.</p>
        </header>
        <HomeStatus manifest={manifest} />
        <div className="af-home-grid">
          <IssueSelector manifest={manifest} selectedId={selectedId} onSelect={selectIssue} />
          <div
            id="af-selected-issue-panel"
            role="tabpanel"
            aria-labelledby={`af-issue-tab-${selectedId}`}
            aria-live="polite"
            aria-busy={loading}
          >
            {loading && !visibleBundle && (
              <div className="af-empty-state" role="status"><strong>선택한 의제를 불러오는 중입니다.</strong><span>공개 분석 번들 한 건만 가져오고 있습니다.</span></div>
            )}
            {!loading && loadError && !visibleBundle && (
              <div className="af-error-state" role="alert"><strong>의제 데이터를 불러오지 못했습니다.</strong><span>{loadError}</span><button type="button" className="af-primary-button" onClick={() => void loadIssue(selectedId)}>다시 시도</button></div>
            )}
            {visibleBundle && <QuickResult bundle={visibleBundle} />}
          </div>
        </div>
        <footer className="af-footer"><span>기사 본문 전문은 공개하지 않습니다.</span><Link href="/tools/method">분석 방법 보기</Link></footer>
      </div>
    </main>
  );
}

function AnalysisInfo({ bundle }: { bundle: IssueAnalysisBundle }) {
  const semantic = bundle.analysisStatus.semantic;
  const cluster = bundle.analysisStatus.cluster;
  return (
    <details className="af-disclosure">
      <summary>분석 정보</summary>
      <dl>
        <div><dt>의제 클러스터</dt><dd>{cluster.status === "succeeded" ? "AI 자동 초안" : "검토 필요"}</dd></div>
        <div><dt>본문 분석</dt><dd>{semantic.succeededArticleCount}/{bundle.issue.articleCount}건 AI</dd></div>
        <div><dt>보조 지표</dt><dd>{bundle.ruleProfiles.length}건 규칙 기반</dd></div>
        <div><dt>공개 상태</dt><dd>{bundle.status === "succeeded" ? "자동 초안" : "검토 필요"}</dd></div>
        {semantic.model && <div><dt>본문 모델</dt><dd>{semantic.model}</dd></div>}
        {semantic.promptVersion && <div><dt>프롬프트</dt><dd>{semantic.promptVersion}</dd></div>}
        {semantic.schemaVersion && <div><dt>분석 스키마</dt><dd>{semantic.schemaVersion}</dd></div>}
        {cluster.model && <div><dt>클러스터 모델</dt><dd>{cluster.model}</dd></div>}
      </dl>
      <p>AI 결과는 사람 검토 전 자동 초안입니다. 규칙 기반 보조 지표는 AI 본문 분석 건수에 포함하지 않습니다.</p>
    </details>
  );
}

function SummaryTab({ bundle }: { bundle: IssueAnalysisBundle }) {
  const semantic = bundle.analysisStatus.semantic;
  const hasSemantic = semantic.succeededArticleCount > 0;
  const differences = semanticDifferences(bundle).slice(0, 3);
  return (
    <div className="af-content-stack">
      <section className="af-lead-finding">
        <span className="af-section-label">{hasSemantic ? "AI 본문 자동 초안" : "AI 본문 분석 대기"}</span>
        <h3>{primaryFinding(bundle)}</h3>
        <p>{hasSemantic ? `${semantic.succeededArticleCount}/${bundle.issue.articleCount}건의 공개 paraphrase와 근거 위치를 사용했습니다.` : "현재는 규칙 기반 보조 지표만 있으며 이를 AI 결론으로 표시하지 않습니다."}</p>
      </section>
      <div className="af-observation-grid">
        <section><span>현재 분석 범위</span><p>AI 본문 {semantic.succeededArticleCount}/{bundle.issue.articleCount}건 · 규칙 기반 보조 지표 {bundle.ruleProfiles.length}/{bundle.issue.articleCount}건</p></section>
        <section><span>규칙 기반 보조 관찰</span><p>{safeRuleSummary(bundle)}</p></section>
      </div>
      {differences.length > 0 && (
        <section className="af-section" aria-labelledby={`${bundle.issue.issueId}-differences-title`}>
          <header className="af-section-heading">
            <div><span className="af-section-label">대표 차이</span><h3 id={`${bundle.issue.issueId}-differences-title`}>서로 다른 본문 설명을 나란히 봅니다</h3></div>
            <span className="af-section-meta">AI 자동 초안 · 기사 근거 연결</span>
          </header>
          <div className="af-axis-list">
            {differences.map((difference) => (
              <section className="af-axis-row" key={difference.dimension}>
                <div className="af-axis-heading"><div><span className="af-section-label">{dimensionLabels[difference.dimension]}</span><h3>{difference.leftOutlet} ↔ {difference.rightOutlet}</h3></div></div>
                <ul className="af-variant-list">
                  <li><strong>{difference.leftOutlet}</strong><span>{difference.left.text}</span><small>{semanticVoiceLabel(difference.left.voice)} · {evidenceLabel(difference.left.evidence[0])}</small><EvidenceLink bundle={bundle} articleId={difference.left.articleIds[0]} /></li>
                  <li><strong>{difference.rightOutlet}</strong><span>{difference.right.text}</span><small>{semanticVoiceLabel(difference.right.voice)} · {evidenceLabel(difference.right.evidence[0])}</small><EvidenceLink bundle={bundle} articleId={difference.right.articleIds[0]} /></li>
                </ul>
              </section>
            ))}
          </div>
        </section>
      )}
      <ClusterSummary bundle={bundle} />
      <AnalysisInfo bundle={bundle} />
    </div>
  );
}

function SemanticFraming({ bundle }: { bundle: IssueAnalysisBundle }) {
  const profiles = successfulSemanticProfiles(bundle);
  const evidenceCount = profiles.reduce((total, profile) => total + profile.evidence.length, 0);
  return (
    <div className="af-content-stack">
      <section className="af-ai-banner">
        <div><span className="af-section-label">AI 본문 분석 · 자동 초안</span><h3>본문에서 관찰된 설명 요소</h3><p>공개 paraphrase와 근거 위치·해시만 표시합니다. 기사 전문이나 원문 문장은 포함하지 않습니다.</p></div>
        <dl><div><dt>AI 기사</dt><dd>{profiles.length}/{bundle.issue.articleCount}</dd></div><div><dt>근거 위치</dt><dd>{evidenceCount}</dd></div></dl>
      </section>
      <div className="af-axis-list">
        {dimensionOrder.map((dimension) => {
          const patterns = semanticPatterns(bundle, dimension);
          const observed = profiles.filter((entry) => (entry.profile.dimensions?.[dimension]?.items?.length ?? 0) > 0).length;
          const primary = patterns[0];
          const evidence = primary?.evidence[0];
          return (
            <section className="af-axis-row" key={dimension}>
              <div className="af-axis-heading">
                <div><span className="af-section-label">{dimensionLabels[dimension]}</span><h3>{primary?.text ?? "직접 근거를 확인하지 못했습니다."}</h3></div>
                <strong>{observed}/{profiles.length}</strong>
              </div>
              {primary ? (
                <>
                  <div className="af-axis-meta"><span>{semanticVoiceLabel(primary.voice)}</span><span>{primary.articleIds.length}건 기사</span></div>
                  <div className="af-evidence-row"><span title={evidence?.sentenceSha256}>{evidenceLabel(evidence)}</span><EvidenceLink bundle={bundle} articleId={primary.articleIds[0]} /></div>
                </>
              ) : <p className="af-withheld">관찰되지 않음은 기사에 해당 요소가 없다는 단정이 아닙니다.</p>}
              {patterns.length > 1 && (
                <details className="af-more"><summary>다른 관찰 {patterns.length - 1}개</summary><ul>{patterns.slice(1, 4).map((pattern) => <li key={`${dimension}-${pattern.text}-${pattern.voice}`}>{pattern.text} · {semanticVoiceLabel(pattern.voice)}</li>)}</ul></details>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function RuleFraming({ bundle }: { bundle: IssueAnalysisBundle }) {
  const axes = bundle.comparison.data.comparison_axes ?? [];
  return (
    <div className="af-content-stack">
      <section className="af-hold-banner"><span className="af-section-label">AI 본문 분석 대기</span><h3>규칙 기반 보조 지표만 제공합니다.</h3><p>아래 수치는 표현 범주의 관찰 건수입니다. 매체의 의도·성향·지지를 판정하지 않으며 AI 분석으로 집계하지 않습니다.</p></section>
      <div className="af-axis-list">
        {dimensionOrder.map((dimension) => {
          const axis = axes.find((candidate) => candidate.dimension === dimension);
          const primary = axis?.patterns?.slice().sort((left, right) => (right.article_count ?? 0) - (left.article_count ?? 0))[0];
          const evidence = primary?.evidence?.[0];
          return (
            <section className="af-axis-row af-rule-row" key={dimension}>
              <div className="af-axis-heading"><div><span className="af-section-label">{dimensionLabels[dimension]}</span><h3>{primary ? "규칙으로 관찰된 표현 범주가 있습니다." : "직접 관찰되지 않았습니다."}</h3></div><strong>{axis?.observed_article_count ?? 0}/{bundle.issue.articleCount}</strong></div>
              <p className="af-rule-description">{primary ? "실제 판단이 아니라 기사별 근거 위치를 찾기 위한 보조 지표입니다." : "관찰되지 않음은 실제 기사에 해당 요소가 없다는 뜻이 아닙니다."}</p>
              {evidence && <div className="af-evidence-row"><span title={evidence.sentence_sha256}>{evidenceLabel({ articleId: evidence.article_id, sourceId: evidence.source_id, locator: evidence.locator, sentenceSha256: evidence.sentence_sha256 })}</span><EvidenceLink bundle={bundle} articleId={evidence.article_id} /></div>}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function OutletsTab({ bundle }: { bundle: IssueAnalysisBundle }) {
  const outlets = sourceNames(bundle).map((outlet) => {
    const articles = bundle.articles.filter((article) => article.outlet === outlet);
    const articleIds = new Set(articles.map((article) => article.articleId));
    const semanticEntries = successfulSemanticProfiles(bundle).filter((entry) => articleIds.has(entry.articleId));
    const evidenceCount = semanticEntries.reduce((total, entry) => total + entry.evidence.length, 0);
    const semanticActors = new Map<string, { direct: number; indirect: number }>();
    for (const entry of semanticEntries) {
      for (const actor of entry.profile.actors_and_sources ?? []) {
        const label = actor.role_label ?? actor.role ?? "기타 취재원";
        const current = semanticActors.get(label) ?? { direct: 0, indirect: 0 };
        current.direct += actor.direct_quote_count ?? 0;
        current.indirect += actor.indirect_attribution_count ?? 0;
        semanticActors.set(label, current);
      }
    }
    const ruleOutlet = bundle.comparison.data.source_lens?.by_outlet?.find((entry) => entry.outlet === outlet);
    const ruleVoiceCount = ruleOutlet?.roles.reduce((total, role) => total + role.count, 0) ?? 0;
    return { outlet, articles, semanticEntries, evidenceCount, semanticActors: [...semanticActors.entries()], ruleVoiceCount };
  });
  return (
    <div className="af-content-stack">
      <section className="af-lead-finding"><span className="af-section-label">매체별 분석 범위</span><h3>매체마다 AI 근거가 몇 건 연결됐는지 먼저 확인합니다.</h3><p>표본 수가 다른 매체를 같은 비율처럼 비교하지 않습니다. 규칙 기반 취재원 관찰은 별도 보조 지표입니다.</p></section>
      <div className="af-outlet-list">
        {outlets.map((outlet) => (
          <article key={outlet.outlet}>
            <header><h3>{outlet.outlet}</h3><span>{outlet.articles.length}건 기사</span></header>
            <ul>
              <li><span>AI 본문 자동 초안</span><b>{outlet.semanticEntries.length}/{outlet.articles.length}건</b></li>
              <li><span>AI 근거 위치</span><b>{outlet.evidenceCount}개</b></li>
              <li><span>AI 취재원 구조</span><b>{outlet.semanticActors.length ? outlet.semanticActors.slice(0, 3).map(([label, count]) => `${label} ${count.direct + count.indirect}`).join(" · ") : "확인되지 않음"}</b></li>
              <li><span>규칙 기반 취재원 관찰</span><b>{outlet.ruleVoiceCount}건</b></li>
            </ul>
            <EvidenceLink bundle={bundle} articleId={outlet.articles[0]?.articleId} />
          </article>
        ))}
      </div>
      <p className="af-caution">AI 근거 수와 규칙 관찰 수는 매체의 신뢰도·성향·지지 여부를 뜻하지 않습니다.</p>
    </div>
  );
}

function EvidenceTab({ bundle }: { bundle: IssueAnalysisBundle }) {
  const semanticByArticleId = new Map(bundle.semanticProfiles.map((entry) => [entry.articleId, entry]));
  return (
    <div className="af-content-stack">
      <section className="af-lead-finding"><span className="af-section-label">근거 기사</span><h3>분석 상태와 근거 위치를 기사별로 확인하세요.</h3><p>기사 전문과 원문 문장은 공개하지 않습니다. 공개 paraphrase, 위치, 해시와 원문 링크만 제공합니다.</p></section>
      <div className="af-evidence-list">
        {bundle.articles.map((article) => {
          const semantic = semanticByArticleId.get(article.articleId);
          const evidence = semantic?.evidence[0];
          const detail = semantic?.status === "succeeded"
            ? `AI 근거 ${semantic.evidence.length}개 · ${evidenceLabel(evidence)}`
            : "AI 본문 분석 검토 필요 · 규칙 기반 보조 지표만 있음";
          return (
            <a href={article.canonicalUrl ?? "#"} target="_blank" rel="noopener noreferrer" key={article.articleId} aria-label={`${article.outlet ?? "매체"} 기사 원문 열기`}>
              <span>{article.outlet ?? "매체 미상"}</span>
              <strong>{article.title ?? "제목 없음"}</strong>
              <small title={evidence?.sentenceSha256}>{detail}<br />{formatPublishedAt(article.publishedAt)} · 원문 열기</small>
            </a>
          );
        })}
      </div>
    </div>
  );
}

function readDetailTab() {
  if (typeof window === "undefined") return "summary" as DetailTab;
  const view = new URLSearchParams(window.location.search).get("view");
  return view === "framing" || view === "outlets" || view === "evidence" ? view : "summary";
}

function IssueDetail({ bundle }: { bundle: IssueAnalysisBundle }) {
  const [tab, setTab] = useState<DetailTab>("summary");
  const semantic = bundle.analysisStatus.semantic;

  useEffect(() => {
    const sync = () => setTab(readDetailTab());
    sync();
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  const changeTab = (next: DetailTab) => {
    if (next === tab) return;
    setTab(next);
    const url = new URL(window.location.href);
    url.searchParams.set("view", next);
    window.history.pushState({ view: next }, "", `${url.pathname}?${url.searchParams.toString()}${url.hash}`);
  };

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, currentIndex: number) => {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % detailTabs.length;
    if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + detailTabs.length) % detailTabs.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = detailTabs.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    const next = detailTabs[nextIndex][0];
    changeTab(next);
    queueMicrotask(() => document.getElementById(`${bundle.issue.issueId}-tab-${next}`)?.focus());
  };

  return (
    <main className="af-page af-detail-page">
      <SiteHeader active="compare" />
      <div className="af-detail-shell">
        <Link className="af-back-link" href={`/?issue=${encodeURIComponent(bundle.issue.issueId)}`}>← 의제 비교로 돌아가기</Link>
        <header className="af-detail-header">
          <div>
            <div className="af-detail-meta"><span>{String(bundle.issue.rank).padStart(2, "0")}</span><span>{bundle.issue.category ?? "분류 없음"}</span><span>{bundle.basisDate.replaceAll("-", ".")}</span><StatusPill succeeded={semantic.succeededArticleCount} total={bundle.issue.articleCount} /></div>
            <h1>{bundle.issue.title}</h1>
            <p>{primaryFinding(bundle)}</p>
          </div>
          <div className="af-detail-counts"><b>{bundle.issue.articleCount}건</b><span>기사 · {bundle.issue.outletCount}개 매체</span><small>AI 본문 {semantic.succeededArticleCount}/{bundle.issue.articleCount} · 자동 초안</small></div>
        </header>
        <div className="af-tabs" role="tablist" aria-label={`${bundle.issue.title} 분석 메뉴`}>
          {detailTabs.map(([value, label], index) => (
            <button
              type="button"
              role="tab"
              id={`${bundle.issue.issueId}-tab-${value}`}
              aria-selected={tab === value}
              aria-controls={`${bundle.issue.issueId}-panel-${value}`}
              tabIndex={tab === value ? 0 : -1}
              className={tab === value ? "active" : ""}
              key={value}
              onClick={() => changeTab(value)}
              onKeyDown={(event) => handleTabKeyDown(event, index)}
            >{label}</button>
          ))}
        </div>
        <div className="af-detail-content" role="tabpanel" id={`${bundle.issue.issueId}-panel-${tab}`} aria-labelledby={`${bundle.issue.issueId}-tab-${tab}`} tabIndex={0}>
          {tab === "summary" && <SummaryTab bundle={bundle} />}
          {tab === "framing" && (semantic.succeededArticleCount > 0 ? <SemanticFraming bundle={bundle} /> : <RuleFraming bundle={bundle} />)}
          {tab === "outlets" && <OutletsTab bundle={bundle} />}
          {tab === "evidence" && <EvidenceTab bundle={bundle} />}
        </div>
      </div>
    </main>
  );
}

export function IssueDetailExperience({ bundle }: { bundle: IssueAnalysisBundle }) {
  return <IssueDetail bundle={bundle} />;
}
