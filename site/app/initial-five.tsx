"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import metadataClusters from "../data/metadata-clusters-2026-07-26.json";
import top5Data from "../data/top5-2026-07-26.json";
import semantic011002 from "../data/semantic-rank1-2026-07-26/01100201.20260726113123001.json";
import semantic011004 from "../data/semantic-rank1-2026-07-26/01100401.20260726101915001.json";
import semantic011007a from "../data/semantic-rank1-2026-07-26/01100701.20260726101351001.json";
import semantic011007b from "../data/semantic-rank1-2026-07-26/01100701.20260726110741001.json";
import semantic011008 from "../data/semantic-rank1-2026-07-26/01100801.20260726130958001.json";
import semantic011009 from "../data/semantic-rank1-2026-07-26/01100901.20260726103800001.json";
import semantic011011 from "../data/semantic-rank1-2026-07-26/01101101.20260726104709001.json";

const dimensionOrder = [
  "problem_definition",
  "causal_interpretation",
  "responsibility_attribution",
  "moral_evaluation",
  "treatment_recommendation",
] as const;

const dimensionLabels: Record<(typeof dimensionOrder)[number], string> = {
  problem_definition: "문제 정의",
  causal_interpretation: "원인 해석",
  responsibility_attribution: "책임 귀속",
  moral_evaluation: "규범적 평가",
  treatment_recommendation: "해법·처방",
};

const toolLinks = [
  { href: "/tools/self-check", label: "자기점검" },
  { href: "/method", label: "방법론" },
  { href: "/community", label: "커뮤니티" },
];

type InitialIssue = (typeof top5Data.issues)[number];
type InitialAxis = InitialIssue["comparison"]["comparison_axes"][number];
type SemanticEvidence = {
  locator?: { paragraph?: number; sentence?: number };
  sentence_sha256?: string;
};
type SemanticItem = {
  public_paraphrase?: string;
  frame_family?: string;
  voice?: { kind?: string; speaker_role?: string | null };
  evidence?: SemanticEvidence;
};
type SemanticDimension = {
  status?: string;
  model_status?: string;
  outlet_narration_observed?: boolean;
  items?: SemanticItem[];
};
type SemanticSnapshot = {
  article: { article_id: string };
  engine: {
    semantic_ai: boolean;
    version: string;
    prompt_version: string;
    analysis_schema_version: number;
  };
  dimensions: Record<string, SemanticDimension>;
  actors_and_sources?: Array<{ role?: string; role_label?: string }>;
  review?: { analysis_decision?: string; requires_human_review?: boolean; status?: string };
  extraction?: { text_scope?: string; analyzed_character_count?: number; input_truncated?: boolean };
  lineage?: { model_id?: string; prompt_version?: string; analysis_schema_version?: number | string };
};
type SemanticRecord = { articleId: string; profile: SemanticSnapshot };

const semanticRank1Profiles: SemanticRecord[] = [
  semantic011002,
  semantic011004,
  semantic011007a,
  semantic011007b,
  semantic011008,
  semantic011009,
  semantic011011,
];
const semanticProfileByArticleId = new Map(
  semanticRank1Profiles.map((record) => [record.articleId, record]),
);
const metadataClusterByIssueId = new Map(
  metadataClusters.clusters.map((cluster) => [cluster.issue_id, cluster]),
);
const issues = top5Data.issues;

function topPattern(axis: InitialAxis) {
  return axis.patterns?.slice().sort((left, right) => right.article_count - left.article_count)[0] ?? null;
}

function cleanComparisonText(value: string) {
  return value.replace(/\s*([.!?])\1+/g, "$1").replace(/\s+([,.;!?])/g, "$1").trim();
}

function semanticProfilesFor(issue: InitialIssue) {
  if (issue.rank !== 1) return [] as SemanticSnapshot[];
  return issue.profiles
    .map((profile) => semanticProfileByArticleId.get(profile.article.article_id)?.profile)
    .filter((profile): profile is SemanticSnapshot => Boolean(profile));
}

function metadataClusterFor(issue: InitialIssue) {
  return metadataClusterByIssueId.get(issue.issueId);
}

function hasSemanticAi(issue: InitialIssue) {
  return semanticProfilesFor(issue).length > 0;
}

function issueStatus(issue: InitialIssue) {
  const semanticProfileCount = semanticProfilesFor(issue).length;
  if (semanticProfileCount === issue.profiles.length && semanticProfileCount > 0) return { label: "AI 의미 분석", tone: "ai" };
  if (semanticProfileCount > 0) return { label: "AI 일부 연결", tone: "ai" };
  if (metadataClusterFor(issue)?.decision === "analyze") return { label: "AI 클러스터링", tone: "ai" };
  if (issue.clusterQuality === "review_required") return { label: "검토 필요", tone: "caution" };
  return { label: "근거 기반 미리보기", tone: "fallback" };
}

function sourceNames(issue: InitialIssue) {
  return issue.articleMetadata.map((article) => article.source).filter((source, index, values) => values.indexOf(source) === index);
}

function EvidenceLink({ issue, articleId }: { issue: InitialIssue; articleId?: string }) {
  const article = issue.articleMetadata.find((candidate) => candidate.articleId === articleId) ?? issue.articleMetadata[0];
  if (!article) return null;
  return (
    <a className="initial-five-evidence-link" href={article.canonicalUrl} target="_blank" rel="noopener noreferrer">
      {article.source} 원문 ↗
    </a>
  );
}

const frameFamilyLabels: Record<string, string> = {
  safety_harm: "피해·안전 프레임",
  political_incentive: "정치적 유인 프레임",
  legislature_politics: "입법·정치 책임 프레임",
  legitimacy_negative: "정당성 비판 프레임",
  institutional_check: "제도적 견제 프레임",
};

function semanticVoiceLabel(kind?: string) {
  if (kind === "journalist_narration") return "매체 서술로 관측";
  if (kind === "direct_quote") return "직접 인용에 귀속";
  if (kind === "indirect_source") return "취재원 설명에 귀속";
  return "발화 주체 확인 필요";
}

type SemanticPattern = {
  publicParaphrase: string;
  frameFamily?: string;
  voiceKind?: string;
  articleIds: string[];
  evidence?: SemanticEvidence;
};

function semanticPatterns(profiles: SemanticSnapshot[], dimension: string) {
  const grouped = new Map<string, SemanticPattern>();
  profiles.forEach((profile) => {
    const items = profile.dimensions[dimension]?.items ?? [];
    items.forEach((item) => {
      if (!item.public_paraphrase) return;
      const key = [item.public_paraphrase, item.frame_family ?? "", item.voice?.kind ?? ""].join("|");
      const existing = grouped.get(key);
      if (existing) {
        if (!existing.articleIds.includes(profile.article.article_id)) existing.articleIds.push(profile.article.article_id);
        return;
      }
      grouped.set(key, {
        publicParaphrase: item.public_paraphrase,
        frameFamily: item.frame_family,
        voiceKind: item.voice?.kind,
        articleIds: [profile.article.article_id],
        evidence: item.evidence,
      });
    });
  });
  return [...grouped.values()].sort((left, right) => right.articleIds.length - left.articleIds.length);
}

function semanticEvidenceCount(profiles: SemanticSnapshot[]) {
  return profiles.reduce(
    (total, profile) => total + Object.values(profile.dimensions).reduce((count, dimension) => count + (dimension.items?.length ?? 0), 0),
    0,
  );
}

function SemanticPatternCard({ issue, dimension, pattern }: { issue: InitialIssue; dimension: string; pattern: SemanticPattern }) {
  const locator = pattern.evidence?.locator;
  return (
    <article className="initial-five-ai-pattern" key={`${dimension}-${pattern.publicParaphrase}-${pattern.frameFamily ?? ""}`}>
      <h4>{pattern.publicParaphrase}</h4>
      <div className="initial-five-axis-meta">
        <span>{frameFamilyLabels[pattern.frameFamily ?? ""] ?? "모델 의미 패턴"}</span>
        <span>{semanticVoiceLabel(pattern.voiceKind)}</span>
        <span>{pattern.articleIds.length}개 기사</span>
      </div>
      <div className="initial-five-evidence-row">
        <span>{locator ? `대표 근거 위치: ${locator.paragraph ?? "-"}문단 ${locator.sentence ?? "-"}문장` : "대표 근거 위치 확인 필요"}</span>
        <EvidenceLink issue={issue} articleId={pattern.articleIds[0]} />
      </div>
    </article>
  );
}

function SemanticFramingPanel({ issue, profiles }: { issue: InitialIssue; profiles: SemanticSnapshot[] }) {
  const engine = profiles[0]?.engine;
  const evidenceCount = semanticEvidenceCount(profiles);
  const actorLabels = [...new Set(profiles.flatMap((profile) => (profile.actors_and_sources ?? []).map((actor) => actor.role_label).filter(Boolean)))];

  return (
    <>
      <section className="initial-five-ai-proof-card" aria-label="AI 의미 분석 상태">
        <div>
          <span className="initial-five-section-label">AI 의미 분석 · 초안</span>
          <h3>모델이 기사별 설명 구조를 찾아 근거 위치에 연결했습니다.</h3>
          <p>본문 전문은 화면에 저장하지 않고, 모델이 만든 요약·프레임 유형·문단과 문장 위치만 보여줍니다. 책임과 평가에 관한 해석은 사람 검토 전의 분석 초안입니다.</p>
        </div>
        <dl>
          <div><dt>기사 응답</dt><dd>{profiles.length}/{issue.articleCount}</dd></div>
          <div><dt>근거 연결</dt><dd>{evidenceCount}건</dd></div>
          <div><dt>모델</dt><dd>{engine?.version ?? "확인 필요"}</dd></div>
          <div><dt>프롬프트</dt><dd>{engine?.prompt_version ?? "확인 필요"}</dd></div>
        </dl>
        <div className="initial-five-ai-proof-foot">
          <span>{actorLabels.length ? `귀속된 취재원 유형: ${actorLabels.join(", ")}` : "별도로 귀속된 취재원 유형 없음"}</span>
          <span>원문 본문 비공개 · 근거 위치만 공개</span>
        </div>
      </section>
      <div className="initial-five-axis-list">
        {dimensionOrder.map((dimension) => {
          const patterns = semanticPatterns(profiles, dimension);
          const observedCount = profiles.filter((profile) => (profile.dimensions[dimension]?.items?.length ?? 0) > 0).length;
          return (
            <section className="initial-five-axis-card initial-five-ai-axis-card" key={dimension}>
              <div className="initial-five-axis-heading">
                <div>
                  <span className="initial-five-section-label">{dimensionLabels[dimension]}</span>
                  <h3>이 축에서 반복된 의미 패턴</h3>
                </div>
                <strong>{observedCount}/{profiles.length}</strong>
              </div>
              {patterns.length ? (
                <>
                  <SemanticPatternCard issue={issue} dimension={dimension} pattern={patterns[0]} />
                  {patterns.length > 1 && (
                    <details className="initial-five-ai-more">
                      <summary>다른 패턴 {patterns.length - 1}개와 대표 근거 보기</summary>
                      <div>
                        {patterns.slice(1, 3).map((pattern) => <SemanticPatternCard issue={issue} dimension={dimension} pattern={pattern} key={`${dimension}-more-${pattern.publicParaphrase}-${pattern.frameFamily ?? ""}`} />)}
                      </div>
                    </details>
                  )}
                </>
              ) : <p className="initial-five-withheld">이 축에서 모델이 충분한 근거를 연결하지 못했습니다. 없음으로 단정하지 않습니다.</p>}
            </section>
          );
        })}
      </div>
      <p className="initial-five-disclosure">모델 출력은 {engine?.prompt_version ?? "현재"} 프롬프트와 스키마 {engine?.analysis_schema_version ?? "-"} 기준의 자동 초안이며, 사람 검토 후에만 확정 결과로 사용할 수 있습니다.</p>
    </>
  );
}

function MetadataClusterCard({ issue }: { issue: InitialIssue }) {
  const cluster = metadataClusterFor(issue);
  if (!cluster) return null;
  const variants = cluster.narrative_variants.slice(0, 3);
  return (
    <section className="initial-five-ai-cluster-card" aria-labelledby={`${issue.issueId}-ai-cluster-title`}>
      <div className="initial-five-section-heading">
        <div>
          <span className="initial-five-section-label">AI 의제 클러스터링</span>
          <h3 id={`${issue.issueId}-ai-cluster-title`}>제목에서 공통 사건과 다른 서술 단서를 묶었습니다</h3>
        </div>
        <span>{cluster.coherence === "high" ? "제목 일치도 높음" : "사람 검토 필요"}</span>
      </div>
      {cluster.decision === "analyze" ? (
        <>
          <p className="initial-five-ai-cluster-summary">{cluster.summary}</p>
          <div className="initial-five-chip-row">
            {cluster.common_subjects.slice(0, 6).map((subject) => <span key={subject}>{subject}</span>)}
          </div>
          <div className="initial-five-variant-list">
            {variants.map((variant) => (
              <article key={variant.label}>
                <strong>{variant.label}</strong>
                <p>{variant.description}</p>
                <small>{variant.article_ids.length}개 기사 제목에서 관측</small>
              </article>
            ))}
          </div>
          <p className="initial-five-disclosure">제목·매체·게시 시각만 사용한 AI 요약입니다. 본문 근거가 아니므로 프레이밍·책임·의도 판정으로 읽지 않습니다.</p>
        </>
      ) : (
        <p className="initial-five-withheld">메타데이터만으로 안전한 공통 설명을 만들지 못했습니다. 기존 기사 묶음과 규칙 기반 비교를 유지합니다.</p>
      )}
    </section>
  );
}

function IssueDetail({ issue, standalone }: { issue: InitialIssue; standalone?: boolean }) {
  const [tab, setTab] = useState<"summary" | "framing" | "outlets" | "articles">("summary");
  const summary = issue.comparison.summary_30_seconds;
  const status = issueStatus(issue);
  const sources = sourceNames(issue);
  const axes = issue.comparison.comparison_axes;
  const commonGround = cleanComparisonText(summary.common_ground);
  const mainDifference = cleanComparisonText(summary.main_difference);
  const sourceContext = cleanComparisonText(summary.source_context);
  const semanticProfiles = semanticProfilesFor(issue);

  return (
    <article className="initial-five-detail" id={`issue-${issue.issueId}`}>
      <header className="initial-five-detail-header">
        <div>
          <div className="initial-five-detail-meta">
            <span className="initial-five-rank">{String(issue.rank).padStart(2, "0")}</span>
            <span>{issue.category}</span>
            <span>2026.07.26</span>
            <span className={`initial-five-status-pill ${status.tone}`}>{status.label}</span>
          </div>
          <h2>{issue.title}</h2>
          <p className="initial-five-detail-lede">{mainDifference}</p>
        </div>
        <div className="initial-five-sample-card">
          <span>분석 범위</span>
          <strong>{issue.articleCount}건</strong>
          <small>{issue.sourceCount}개 매체 · 본문 근거 위치 연결</small>
          {standalone ? <span className="initial-five-detail-link initial-five-current-page">현재 의제 상세 페이지</span> : <Link href={`/issues/${encodeURIComponent(issue.issueId)}`} className="initial-five-detail-link">상세 페이지로 열기 ↗</Link>}
        </div>
      </header>

      <div className="initial-five-detail-tabs" role="tablist" aria-label={`${issue.title} 분석 메뉴`}>
        {([
          ["summary", "요약"],
          ["framing", "프레이밍 분석"],
          ["outlets", "매체 비교"],
          ["articles", "근거 기사"],
        ] as const).map(([value, label]) => (
          <button
            type="button"
            role="tab"
            aria-selected={tab === value}
            aria-controls={`${issue.issueId}-panel-${value}`}
            id={`${issue.issueId}-tab-${value}`}
            className={tab === value ? "active" : ""}
            key={value}
            onClick={() => setTab(value)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "summary" && (
        <div className="initial-five-detail-body" role="tabpanel" id={`${issue.issueId}-panel-summary`} aria-labelledby={`${issue.issueId}-tab-summary`} tabIndex={0}>
          <section className="initial-five-reading-card" aria-labelledby={`${issue.issueId}-reading-title`}>
            <div className="initial-five-section-heading">
              <div>
                <span className="initial-five-section-label">30초 읽기</span>
                <h3 id={`${issue.issueId}-reading-title`}>같은 사건을 어떻게 다르게 설명했나</h3>
              </div>
              <span className="initial-five-coverage">{summary.sample}</span>
            </div>
            <div className="initial-five-reading-grid">
              <div>
                <span>공통으로 확인된 내용</span>
                <p>{commonGround}</p>
              </div>
              <div>
                <span>이번 비교에서 중요한 차이</span>
                <p>{mainDifference}</p>
              </div>
            </div>
          </section>

          <section className="initial-five-cluster-card" aria-labelledby={`${issue.issueId}-cluster-title`}>
            <div className="initial-five-section-heading">
              <div>
                <span className="initial-five-section-label">기사 묶음</span>
                <h3 id={`${issue.issueId}-cluster-title`}>왜 하나의 의제로 연결했나</h3>
              </div>
              <span>{issue.clusterQuality === "review_required" ? "사건 동일성 검토 필요" : "후보 묶음"}</span>
            </div>
            <p>{issue.articleCount}건 · {sources.slice(0, 4).join(", ")}{sources.length > 4 ? " 등" : ""}에서 확인된 후보 묶음입니다. 매체의 입장은 기사별로 분리해 봅니다.</p>
            <div className="initial-five-chip-row">
              {sources.map((source) => <span key={source}>{source}</span>)}
            </div>
          </section>

          <MetadataClusterCard issue={issue} />

          <section className="initial-five-next-card">
            <div>
              <span className="initial-five-section-label">다음으로 보기</span>
              <h3>무엇이 달랐는지 근거와 함께 확인하세요</h3>
              <p>프레이밍 분석에서는 문제 정의·원인·책임·평가·해법을 기사별 근거 위치와 함께 비교합니다.</p>
            </div>
            <button type="button" onClick={() => setTab("framing")}>프레이밍 분석 열기 →</button>
          </section>

          <p className="initial-five-disclosure">{summary.limit}</p>
        </div>
      )}

      {tab === "framing" && (
        <div className="initial-five-detail-body" role="tabpanel" id={`${issue.issueId}-panel-framing`} aria-labelledby={`${issue.issueId}-tab-framing`} tabIndex={0}>
          <section className="initial-five-analysis-intro">
            <span className="initial-five-section-label">프레임 분석</span>
            <h3>{semanticProfiles.length ? "AI가 찾은 설명 구조와 근거" : "기사에서 관측된 설명 요소"}</h3>
            <p>{semanticProfiles.length ? "초기 1번 의제는 승인된 7개 본문을 Gemini로 분석했습니다. 반복 패턴을 묶되, 기사별 귀속과 근거 위치를 분리해 확인할 수 있습니다." : "각 축은 기사 본문에 연결된 근거가 있을 때만 표시합니다. 관측되지 않은 내용은 부재나 의도적 누락을 뜻하지 않습니다."}</p>
          </section>
          {semanticProfiles.length ? <SemanticFramingPanel issue={issue} profiles={semanticProfiles} /> : <div className="initial-five-axis-list">
            {dimensionOrder.map((dimension) => {
              const axis = axes.find((candidate) => candidate.dimension === dimension);
              const pattern = axis ? topPattern(axis) : null;
              return (
                <section className="initial-five-axis-card" key={dimension}>
                  <div className="initial-five-axis-heading">
                    <div>
                      <span className="initial-five-section-label">{dimensionLabels[dimension]}</span>
                      <h3>{pattern?.public_paraphrase ?? "확인된 공통 설명이 없습니다"}</h3>
                    </div>
                    <strong>{axis?.observed_article_count ?? 0}/{issue.articleCount}</strong>
                  </div>
                  {pattern ? (
                    <>
                      <div className="initial-five-axis-meta">
                        <span>{pattern.voice_scope === "outlet_narration" ? "매체 서술" : "취재원 발언에 귀속"}</span>
                        <span>{pattern.outlets.length}개 매체</span>
                      </div>
                      <div className="initial-five-evidence-row">
                        <span>대표 근거 위치: {pattern.evidence?.[0]?.locator?.paragraph ?? "기록"}문단 {pattern.evidence?.[0]?.locator?.sentence ?? ""}문장</span>
                        <EvidenceLink issue={issue} articleId={pattern.evidence?.[0]?.article_id} />
                      </div>
                    </>
                  ) : (
                    <p className="initial-five-withheld">이 축을 직접 뒷받침하는 관측이 없습니다. 실제 기사에 없다는 뜻은 아닙니다.</p>
                  )}
                </section>
              );
            })}
          </div>}
        </div>
      )}

      {tab === "outlets" && (
        <div className="initial-five-detail-body" role="tabpanel" id={`${issue.issueId}-panel-outlets`} aria-labelledby={`${issue.issueId}-tab-outlets`} tabIndex={0}>
          <section className="initial-five-analysis-intro">
            <span className="initial-five-section-label">매체 비교</span>
            <h3>매체별로 무엇을 앞세웠나</h3>
          <p>{sourceContext}</p>
          </section>
          <div className="initial-five-outlet-grid">
            {issue.comparison.source_lens.by_outlet.map((outlet) => (
              <article key={outlet.outlet}>
                <div className="initial-five-outlet-heading"><h3>{outlet.outlet}</h3><span>{outlet.roles.reduce((sum, role) => sum + role.count, 0)}건 관측</span></div>
                <ul>
                  {outlet.roles.map((role) => <li key={`${outlet.outlet}-${role.role}`}><span>{role.role_label}</span><strong>{role.count}건</strong></li>)}
                </ul>
                <EvidenceLink issue={issue} />
              </article>
            ))}
          </div>
          <p className="initial-five-disclosure">취재원 발언의 빈도는 목소리가 보인 정도를 나타내며, 매체의 지지나 취재원의 신뢰도를 뜻하지 않습니다.</p>
        </div>
      )}

      {tab === "articles" && (
        <div className="initial-five-detail-body" role="tabpanel" id={`${issue.issueId}-panel-articles`} aria-labelledby={`${issue.issueId}-tab-articles`} tabIndex={0}>
          <section className="initial-five-analysis-intro">
            <span className="initial-five-section-label">근거 기사</span>
            <h3>이 결과를 확인할 수 있는 원문</h3>
            <p>본문 전문은 저장하거나 공개하지 않고, 기사별 근거 위치와 원문 링크만 연결합니다.</p>
          </section>
          <div className="initial-five-article-list">
            {issue.articleMetadata.map((article) => (
              <a href={article.canonicalUrl} target="_blank" rel="noopener noreferrer" key={article.articleId}>
                <span>{article.source}</span>
                <strong>{article.title}</strong>
                <small>{article.publishedAt.replace("T", " ").slice(0, 16)} · 원문 ↗</small>
              </a>
            ))}
          </div>
        </div>
      )}
    </article>
  );
}

export default function InitialFiveExperience({ issueId, standalone = false }: { issueId?: string; standalone?: boolean }) {
  const initialId = issueId && issues.some((issue) => issue.issueId === issueId) ? issueId : issues[0]?.issueId;
  const [selectedId, setSelectedId] = useState(initialId ?? "");
  const selected = useMemo(() => issues.find((issue) => issue.issueId === selectedId) ?? issues[0], [selectedId]);
  const semanticIssueCount = issues.filter(hasSemanticAi).length;
  const metadataIssueCount = issues.filter((issue) => metadataClusterFor(issue)?.decision === "analyze").length;

  if (!selected) return null;

  return (
    <main className="initial-five-page">
      <div className="initial-five-shell">
        <header className="initial-five-topbar">
          <Link className="initial-five-brand" href="/" aria-label="AgendaFrame 홈"><span>AF</span><strong>AgendaFrame</strong></Link>
          <nav aria-label="주요 메뉴">
            <Link className="active" href="/">의제 비교</Link>
            <Link href="/dashboard">전체 데이터</Link>
            {toolLinks.map((link) => <Link key={link.href} href={link.href}>{link.label}</Link>)}
          </nav>
        </header>

        <section className="initial-five-hero">
          <div>
            <span className="initial-five-kicker">INITIAL FIVE · 2026.07.26</span>
            <h1>같은 사건을<br /><em>다른 설명</em>으로 읽습니다.</h1>
            <p>초기 5개 의제의 비교 화면을 먼저 엽니다. 기사 수를 세는 데서 멈추지 않고, 어떤 문제를 앞세웠는지와 그 근거가 어디에 있는지를 한 화면에서 확인합니다.</p>
            <div className="initial-five-hero-actions">
              <a className="initial-five-primary-action" href="#issue-workspace">의제 비교 시작</a>
              <Link className="initial-five-secondary-action" href="/method">분석 범위 보기</Link>
            </div>
          </div>
          <aside className="initial-five-status-card" aria-label="초기 5개 분석 상태">
            <div className="initial-five-status-heading"><span className="initial-five-live-dot" /> <strong>초기 5개 파일럿</strong></div>
            <dl>
              <div><dt>기준일</dt><dd>2026.07.26</dd></div>
              <div><dt>의제</dt><dd>5개</dd></div>
              <div><dt>분석 기사</dt><dd>25건</dd></div>
              <div><dt>본문 전문</dt><dd>비공개</dd></div>
            </dl>
            <div className="initial-five-ai-status">
              <span>분석 상태</span>
              <strong>{metadataIssueCount ? `AI 클러스터링 ${metadataIssueCount}/5 · 본문 프레이밍 ${semanticIssueCount}/5` : "근거 기반 미리보기"}</strong>
              <small>{metadataIssueCount ? "의제 요약과 본문 프레이밍의 입력 범위를 화면에서 분리해 표시합니다." : "AI 호출 전에도 확인 가능한 근거 위치와 원문 링크를 제공합니다."}</small>
            </div>
          </aside>
        </section>

        <section className="initial-five-workspace" id="issue-workspace">
          <aside className="initial-five-issue-rail" aria-labelledby="initial-five-issue-title">
            <div className="initial-five-rail-heading">
              <div><span className="initial-five-section-label">2026.07.26</span><h2 id="initial-five-issue-title">초기 5개 의제</h2></div>
              <span>5개</span>
            </div>
            <p>하나를 고르면 상세 분석이 이 화면에서 바뀝니다.</p>
            <div className="initial-five-issue-list">
              {issues.map((issue) => {
                const status = issueStatus(issue);
                return (
                  <button type="button" className={`initial-five-issue-button ${issue.issueId === selected.issueId ? "active" : ""}`} aria-pressed={issue.issueId === selected.issueId} key={issue.issueId} onClick={() => setSelectedId(issue.issueId)}>
                    <span className="initial-five-issue-number">{String(issue.rank).padStart(2, "0")}</span>
                    <span><strong>{issue.title}</strong><small>{issue.category} · {issue.articleCount}건 · {status.label}</small></span>
                  </button>
                );
              })}
            </div>
          </aside>
          <IssueDetail issue={selected} standalone={standalone} />
        </section>

        <section className="initial-five-tools" aria-label="사이트 공통 도구">
          <div><span className="initial-five-section-label">SITE TOOLS</span><h2>의제 분석과 별도로 사용할 수 있는 도구</h2></div>
          <div className="initial-five-tool-links">
            <Link href="/tools/self-check"><strong>자기점검</strong><span>기사와 분석을 읽는 질문</span>→</Link>
            <Link href="/method"><strong>방법론</strong><span>표본·근거·AI 상태 확인</span>→</Link>
            <Link href="/community"><strong>커뮤니티</strong><span>근거에 대한 의견 나누기</span>→</Link>
          </div>
        </section>

        <footer className="initial-five-footer">
          <span>AgendaFrame · 초기 5개 파일럿</span>
          <span>본문 전문을 공개하지 않고 근거 위치와 원문 링크를 연결합니다.</span>
        </footer>
      </div>
    </main>
  );
}
