import Link from "next/link";
import type { ReactNode } from "react";
import {
  DIM_LABEL,
  DIM_ORDER,
  DIM_QUESTION,
  VOICE_LABEL,
  familyLabel,
  DEPTH_LABEL,
  GENRE_LABEL,
  SCOPE_KIND_LABEL,
  type IssueView,
  type LayerItem,
} from "../../lib/initial-five/derive";
import type {
  AnalysisModuleEvidence,
  EventSynthesisData,
  IssueAnalysisBundle,
  MorphologyAnalysisModule,
  RuleComparisonAxis,
  SemanticDimensionItem,
  SemanticProfileEntry,
} from "../../lib/initial-five/types";
import { stripEvidenceTokens } from "../../lib/initial-five/public-text.mjs";
import { ComparisonLead as ComparisonLeadV2 } from "./comparison-lead";
import { FineComparisonSection, ArticleExplanations } from "./fine-comparison";
import {
  comparisonSummary,
  semanticEntryBlockedState,
  semanticEntryIsEligible,
} from "../../lib/initial-five/analysis-summary";
import {
  buildParaphraseLinguisticAnalysis,
  type ParaphraseLinguisticAnalysis,
  type ParaphraseObservationRef,
} from "../../lib/initial-five/paraphrase-linguistic-analysis";

type RichProfile = NonNullable<SemanticProfileEntry["profile"]> & {
  secondary_descriptors?: {
    generic_frames?: Array<{ code?: string; label?: string; article_count?: number; evidence?: unknown[] }>;
    policy_frames?: Array<{ code?: string; label?: string; article_count?: number; evidence?: unknown[] }>;
  };
  framing_devices?: Array<{ code?: string; label?: string; count?: number; evidence?: unknown[] }>;
  scope?: { code?: string; level?: string; evidence?: unknown; caution?: string };
  context_depth?: { code?: string; level?: string; evidence?: unknown; caution?: string };
  actors_and_sources?: Array<{
    actor_id?: string;
    role?: string;
    role_label?: string;
    direct_quote_count?: number;
    indirect_attribution_count?: number;
    evidence?: unknown[];
  }>;
  review?: {
    status?: string;
    requires_human_review?: boolean;
    fallback_reason?: string | null;
  };
  morphology?: unknown;
  semantic_network?: unknown;
};

type StructuredProfile = {
  genre?: { code?: string; label?: string; evidence?: unknown };
  scope?: { code?: string; label?: string; evidence?: unknown; caution?: string };
  context_depth?: { code?: string; level?: string; label?: string; evidence?: unknown; caution?: string };
  secondary_descriptors?: {
    generic_frames?: Array<{ code?: string; label?: string; article_count?: number; evidence?: unknown[] }>;
    policy_frames?: Array<{ code?: string; label?: string; article_count?: number; evidence?: unknown[] }>;
    controlled_associations?: Array<{ code?: string; label?: string; article_count?: number; evidence?: unknown[] }>;
  };
  framing_devices?: Array<{ code?: string; label?: string; count?: number; appears_in_lead?: boolean; evidence?: unknown[] }>;
};

type PublicEvidenceRef = {
  article_id?: string;
  articleId?: string;
  locator?: { paragraph?: number; sentence?: number };
  sentence_sha256?: string;
  hash?: string;
  public_paraphrase?: string;
  reason?: string;
};

type Row = {
  articleId: string;
  outlet: string;
  title: string;
  url: string | null;
  item: SemanticDimensionItem;
  status: string;
  modelStatus: string;
  reviewStatus: string | null;
  reviewRequired: boolean;
  stateReason: string | null;
  stateOnly: boolean;
  validEvidence: boolean;
  evidenceCount: number;
};

type FamilyGroup = {
  family: string;
  label: string;
  rows: Row[];
  articleIds: string[];
  outlets: string[];
  narratedArticles: number;
  attributedArticles: number;
};

type DimensionAnalysis = {
  dimension: string;
  label: string;
  question: string;
  rows: Row[];
  groups: FamilyGroup[];
  sourceGroups: FamilyGroup[];
  observedArticles: number;
  narratedArticles: number;
  attributedArticles: number;
  stateCounts: Record<string, number>;
};

const STATUS_COPY: Record<string, string> = {
  queued: "분석 대기",
  running: "분석 중",
  retry_wait: "재시도 대기",
  succeeded: "분석 완료",
  dead_letter: "분석 실패",
  observed: "매체 서술에서 관측",
  source_attributed: "취재원 발언에서 관측",
  mixed: "매체 서술·취재원 발언 혼합",
  not_observed: "이 차원에서 직접 관측되지 않음",
  explicit_not_stated: "기사에 명시적으로 제시되지 않음",
  insufficient_evidence: "공개 근거 부족으로 판정 유보",
  analysis_failed: "이 차원 분석 실패",
  review_needed: "사람 검토 필요",
  automatic_draft: "자동 분석 초안",
  conflicting: "모델 판정 충돌",
  missing_dimension: "이 차원 프로필 없음",
};

const MODEL_STATUS_COPY: Record<string, string> = {
  supported: "모델 판정 지원",
  explicit_not_stated: "명시적 미제시",
  insufficient_evidence: "근거 부족",
  analysis_failed: "분석 실패",
  review_needed: "사람 검토 필요",
  conflicting: "모델 판정 충돌",
  missing_dimension: "차원 프로필 없음",
};

const CODE_LABEL: Record<string, string> = {
  conflict: "갈등",
  economic_consequences: "경제적 결과",
  responsibility: "책임",
  capacity: "행정 역량",
  crime_punishment: "범죄·처벌",
  economic: "경제",
  legality: "합법성",
  political: "정치",
  security_defense: "안보·방위",
  active_voice: "능동형 표현",
  causal_link: "원인 연결",
  chronology: "시간 순서",
  contrast: "대조 표현",
  evaluative_label: "평가 표현",
  headline_emphasis: "제목·리드 강조",
  quantification: "수치 제시",
  unknown: "분류 미상",
};

// localeCompare의 기본 locale은 Node SSR과 브라우저에서 달라질 수 있어
// hydration 시 그룹 순서가 바뀐다. 화면 정렬은 실행 환경과 무관한 비교를 쓴다.
function compareStableText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function codeLabel(code?: string | null, label?: string | null) {
  const cleanLabel = typeof label === "string" ? label.trim() : "";
  if (cleanLabel && cleanLabel !== code && !/^[a-z][a-z0-9_.-]*$/i.test(cleanLabel)) return cleanLabel;
  return (code && CODE_LABEL[code]) ?? (cleanLabel && CODE_LABEL[cleanLabel]) ?? "분류 미상";
}

const DIMENSION_LIST = [...DIM_ORDER];
const CORE_DIMENSIONS = DIMENSION_LIST;
const FRAME_GUIDE_DIMENSIONS = [...CORE_DIMENSIONS, "actor_visibility"];

function richProfile(entry: SemanticProfileEntry | undefined): RichProfile | null {
  return (entry?.profile as RichProfile | null | undefined) ?? null;
}

function structuredProfile(entry: IssueAnalysisBundle["ruleProfiles"][number] | undefined): StructuredProfile | null {
  return (entry?.profile as StructuredProfile | null | undefined) ?? null;
}

function profileMap(bundle: IssueAnalysisBundle) {
  return new Map(bundle.semanticProfiles.map((entry) => [entry.articleId, entry]));
}

function articleMap(bundle: IssueAnalysisBundle, issue: IssueView) {
  return new Map(
    issue.articles.map((view) => [view.articleId, view]),
  );
}

function uniqueItems(items: SemanticDimensionItem[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.public_paraphrase ?? ""}|${item.frame_family ?? ""}|${item.evidence?.sentence_sha256 ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function hasValidEvidence(
  evidence?: SemanticDimensionItem["evidence"] | { locator?: { paragraph?: number; sentence?: number }; hash?: string | null } | null,
  entryEvidence?: SemanticProfileEntry["evidence"],
) {
  if (!evidence?.locator) return false;
  const hasLocator = typeof evidence.locator.paragraph === "number" || typeof evidence.locator.sentence === "number";
  const hash = "sentence_sha256" in evidence
    ? evidence.sentence_sha256
    : "hash" in evidence
      ? evidence.hash
      : null;
  const validShape = hasLocator && typeof hash === "string" && /^[a-f0-9]{64}$/i.test(hash.trim());
  if (!validShape || !entryEvidence) return validShape;
  return entryEvidence.some((candidate) => (
    candidate.locator?.paragraph === evidence.locator?.paragraph
    && candidate.locator?.sentence === evidence.locator?.sentence
    && candidate.sentenceSha256?.toLowerCase() === hash?.trim().toLowerCase()
  ));
}

function evidenceRefs(value: unknown): PublicEvidenceRef[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is PublicEvidenceRef => Boolean(entry && typeof entry === "object"));
}

function synthesisData(bundle: IssueAnalysisBundle): EventSynthesisData | null {
  const value = bundle.comparison.data.synthesis;
  return value && typeof value === "object" ? value : null;
}

function observedClaim(
  claim?: { text?: string | null; status?: string; evidence?: unknown } | null,
  bundle?: IssueAnalysisBundle,
): string | null {
  if (claim?.status !== "observed" || typeof claim.text !== "string" || !claim.text.trim()) return null;
  const refs = evidenceRefs(claim.evidence).filter((ref) => hasValidEvidence({ locator: ref.locator, hash: ref.sentence_sha256 ?? ref.hash }));
  if (!refs.length) return null;
  if (bundle && !refs.some((ref) => {
    const articleId = ref.article_id ?? ref.articleId;
    const entry = bundle.semanticProfiles.find((candidate) => candidate.articleId === articleId);
    return Boolean(entry && entry.evidence.some((candidate) => (
      candidate.locator?.paragraph === ref.locator?.paragraph
      && candidate.locator?.sentence === ref.locator?.sentence
      && candidate.sentenceSha256?.toLowerCase() === (ref.sentence_sha256 ?? ref.hash)?.toLowerCase()
    )));
  })) return null;
  return stripEvidenceTokens(claim.text) || null;
}

function comparisonAxes(bundle: IssueAnalysisBundle): RuleComparisonAxis[] {
  return Array.isArray(bundle.comparison.data.comparison_axes)
    ? bundle.comparison.data.comparison_axes
    : [];
}

function validComparisonEvidence(bundle: IssueAnalysisBundle, pattern: NonNullable<RuleComparisonAxis["patterns"]>[number]) {
  return evidenceRefs(pattern.evidence).filter((ref) =>
    hasValidEvidence({ locator: ref.locator, hash: ref.sentence_sha256 ?? ref.hash })
      && (() => {
        const articleId = ref.article_id ?? ref.articleId;
        if (!articleId) return false;
        const entry = bundle.semanticProfiles.find((candidate) => candidate.articleId === articleId);
        return Boolean(entry && entry.evidence.some((candidate) => (
          candidate.locator?.paragraph === ref.locator?.paragraph
          && candidate.locator?.sentence === ref.locator?.sentence
          && candidate.sentenceSha256?.toLowerCase() === (ref.sentence_sha256 ?? ref.hash)?.toLowerCase()
        )));
      })(),
  );
}

function comparisonScopeLabel(value?: string | null) {
  return ({
    attributed_source: "취재원 발언 기반",
    outlet_narration: "매체 서술 기반",
    mixed: "매체 서술·취재원 혼합",
  } as Record<string, string>)[value ?? ""] ?? "발화 범위 미분류";
}

function evidenceRefLabel(ref: PublicEvidenceRef) {
  if (!hasValidEvidence({ locator: ref.locator, hash: ref.sentence_sha256 ?? ref.hash })) return "공개 근거 지문 없음";
  const locator = ref.locator ?? {};
  const parts = [
    typeof locator.paragraph === "number" ? `문단 ${locator.paragraph}` : "",
    typeof locator.sentence === "number" ? `문장 ${locator.sentence}` : "",
  ].filter(Boolean);
  return parts.join(" · ") || "근거 위치 확인 필요";
}

const CORE_DIM_EXPLANATIONS: Record<string, string> = {
  problem_definition: "어떤 현상을 기사 안의 핵심 문제로 규정했는지 확인합니다.",
  causal_interpretation: "문제가 생긴 원인이나 배경을 무엇에 연결했는지 확인합니다.",
  responsibility_attribution: "해결·책임의 주체를 누구로 제시했는지 확인합니다.",
  moral_evaluation: "행위나 결정에 어떤 정당성·공익 평가를 붙였는지 확인합니다.",
  treatment_recommendation: "기사 안에서 어떤 대응이나 해법이 제시됐는지 확인합니다.",
  actor_visibility: "누구의 목소리와 설명이 기사 안에서 보이고, 기자 서술과 어떻게 구분되는지 확인합니다.",
};

const GUIDE_LABEL: Record<string, string> = {
  ...DIM_LABEL,
  actor_visibility: "취재원·발화 배치",
};

const GUIDE_QUESTION: Record<string, string> = {
  ...DIM_QUESTION,
  actor_visibility: "누구 말을 실었나",
};

function isNarration(kind?: string) {
  return kind === "journalist_narration";
}

function isAttributed(kind?: string) {
  return kind === "direct_quote" || kind === "indirect_source";
}

function displayStatus(row: Row) {
  if (row.stateOnly) return row.modelStatus;
  return row.validEvidence ? row.status : "insufficient_evidence";
}

function stateKey(row: Row) {
  return row.stateOnly ? row.modelStatus : row.validEvidence ? row.status : "insufficient_evidence";
}

function stateReason(modelStatus: string, status: string, explicitReason?: string | null) {
  if (explicitReason) return explicitReason;
  if (modelStatus === "explicit_not_stated") return "해당 차원에 해당하는 제안이나 평가가 기사에서 명시적으로 확인되지 않았습니다.";
  if (modelStatus === "insufficient_evidence") return "공개된 근거 위치와 해시를 함께 확인할 수 없어 판정을 유보했습니다.";
  if (modelStatus === "analysis_failed") return "이 차원의 분석 결과를 게시할 수 없습니다.";
  if (modelStatus === "conflicting") return "모델 판정이 일치하지 않아 사람 검토 전에는 차이를 확정하지 않습니다.";
  if (modelStatus === "review_needed") return "자동 분석 초안으로 사람 검토가 필요합니다.";
  if (modelStatus === "missing_dimension") return "공개 semantic profile에 이 차원의 판정이 없습니다.";
  if (status === "not_observed") return "분석 가능한 공개 프로필에서 이 차원의 직접 관측이 확인되지 않았습니다.";
  return "공개 근거 위치와 문장 지문이 없어 이 항목을 증거로 표시하지 않습니다.";
}

const BLOCKED_DIMENSION_STATES = new Set([
  "analysis_failed",
  "conflicting",
  "insufficient_evidence",
  "dead_letter",
  "failed",
]);

function semanticRowState(
  entry: SemanticProfileEntry,
  bundle: IssueAnalysisBundle,
  node: NonNullable<NonNullable<RichProfile["dimensions"]>[string]>,
  modelStatus: string,
) {
  const entryState = semanticEntryBlockedState(entry, bundle);
  const nodeState = [node.status, node.model_status].find((value): value is string => Boolean(value && BLOCKED_DIMENSION_STATES.has(value)));
  if (entryState) return entryState;
  if (nodeState) return nodeState;
  if (entry.status !== "succeeded") return entry.status;
  if (modelStatus !== "supported") return modelStatus;
  return null;
}

function rowsForDimension(bundle: IssueAnalysisBundle, issue: IssueView, dimension: string): Row[] {
  const entries = profileMap(bundle);
  const articles = articleMap(bundle, issue);
  const rows: Row[] = [];
  for (const article of bundle.articles) {
    const entry = entries.get(article.articleId);
    const profile = richProfile(entry);
    const node = profile?.dimensions?.[dimension];
    if (!node) continue;
    const view = articles.get(article.articleId);
    const nodeRecord = node as typeof node & { abstention_reason?: string | null };
    const modelStatus = node.model_status ?? (node.status === "not_observed" ? "not_observed" : "supported");
    const rowState = semanticRowState(entry!, bundle, node, modelStatus);
    const reviewStatus = profile?.review?.status ?? null;
    const reviewRequired = Boolean(profile?.review?.requires_human_review ?? entry?.engine.reviewRequired);
    const itemRows = uniqueItems(node.items ?? []);
    const items = itemRows.length ? itemRows : [{ } as SemanticDimensionItem];
    for (const item of items) {
      const stateOnly = itemRows.length === 0 || Boolean(rowState) || !semanticEntryIsEligible(entry!, bundle);
      rows.push({
        articleId: article.articleId,
        outlet: view?.outlet ?? article.outlet ?? "매체 미상",
        title: view?.title ?? article.title ?? "제목 미상",
        url: view?.url ?? article.canonicalUrl,
        item,
        status: node.status ?? "not_observed",
        modelStatus: rowState ?? modelStatus,
        reviewStatus,
        reviewRequired,
        stateReason: stateReason(rowState ?? modelStatus, node.status ?? "not_observed", nodeRecord.abstention_reason),
        stateOnly,
        validEvidence: !stateOnly && hasValidEvidence(item.evidence, entry?.evidence),
        evidenceCount: entry?.evidence.length ?? 0,
      });
    }
  }
  return rows;
}

function analyzeDimension(bundle: IssueAnalysisBundle, issue: IssueView, dimension: string): DimensionAnalysis {
  const rows = rowsForDimension(bundle, issue, dimension);
  const stateCounts: Record<string, number> = {};
  for (const row of rows) {
    const key = stateKey(row);
    stateCounts[key] = (stateCounts[key] ?? 0) + 1;
  }
  const textGroups = (candidates: Row[]) => {
    const grouped = new Map<string, { first: Row; rows: Row[] }>();
    for (const row of candidates) {
      // This is an exact repeated-paraphrase ledger only. It is deliberately
      // not a semantic merge: frame-family codes and sentence similarity do
      // not decide whether two articles mean the same thing.
      const key = stripEvidenceTokens(row.item.public_paraphrase ?? "")
        .toLowerCase()
        .replace(/[^0-9a-z가-힣]+/gu, " ")
        .replace(/\s+/g, " ")
        .trim();
      const target = grouped.get(key);
      if (target) target.rows.push(row);
      else grouped.set(key, { first: row, rows: [row] });
    }
    return [...grouped.entries()]
      .map(([key, { first, rows: groupRows }]) => {
        const family = `text:${key}`;
        const label = first.item.public_paraphrase ?? (first.item.frame_family ? familyLabel(first.item.frame_family) : "분류 코드 미확정");
        const articleIds = [...new Set(groupRows.map((row) => row.articleId))];
        return {
          family,
          label,
          rows: groupRows,
          articleIds,
          outlets: [...new Set(groupRows.map((row) => row.outlet))],
          narratedArticles: new Set(
            groupRows.filter((row) => row.item.voice?.kind === "journalist_narration").map((row) => row.articleId),
          ).size,
          attributedArticles: new Set(
            groupRows.filter((row) => isAttributed(row.item.voice?.kind)).map((row) => row.articleId),
          ).size,
        } satisfies FamilyGroup;
      })
      .sort((a, b) => b.articleIds.length - a.articleIds.length || compareStableText(a.label, b.label));
  };
  const observedRows = rows.filter((candidate) => !candidate.stateOnly && candidate.validEvidence && candidate.item.public_paraphrase);
  const groups = textGroups(observedRows.filter((row) => isNarration(row.item.voice?.kind)));
  const sourceGroups = textGroups(observedRows.filter((row) => isAttributed(row.item.voice?.kind)));
  return {
    dimension,
    label: DIM_LABEL[dimension] ?? dimension,
    question: DIM_QUESTION[dimension] ?? dimension,
    rows,
    groups,
    sourceGroups,
    observedArticles: new Set(rows.filter((row) => !row.stateOnly && row.validEvidence).map((row) => row.articleId)).size,
    narratedArticles: new Set(rows.filter((row) => row.validEvidence && isNarration(row.item.voice?.kind)).map((row) => row.articleId)).size,
    attributedArticles: new Set(rows.filter((row) => row.validEvidence && isAttributed(row.item.voice?.kind)).map((row) => row.articleId)).size,
    stateCounts,
  };
}

function analyses(bundle: IssueAnalysisBundle, issue: IssueView) {
  return DIMENSION_LIST.map((dimension) => analyzeDimension(bundle, issue, dimension));
}

function evidenceLocator(row: Row | LayerItem) {
  if ("item" in row) {
    const locator = row.item.evidence?.locator;
    if (!locator) return "위치 정보 없음";
    const parts = [typeof locator.paragraph === "number" ? `문단 ${locator.paragraph}` : "", typeof locator.sentence === "number" ? `문장 ${locator.sentence}` : ""].filter(Boolean);
    return parts.join(" · ") || "위치 정보 없음";
  }
  return row.locator ?? "위치 정보 없음";
}

function evidenceHash(row: Row | LayerItem) {
  if ("item" in row) return row.item.evidence?.sentence_sha256 ?? null;
  return row.hash;
}

function voiceCopy(kind?: string) {
  return kind ? VOICE_LABEL[kind] ?? kind : "발화 유형 미분류";
}

function statusCopy(status: string, voice?: string, modelStatus?: string) {
  if (isNarration(voice)) return STATUS_COPY.observed;
  if (isAttributed(voice) && status === "observed") return STATUS_COPY.source_attributed;
  return STATUS_COPY[modelStatus ?? status] ?? STATUS_COPY[status] ?? "분석 상태 확인 필요";
}

function EvidenceDisclosure({ row, compact = false }: { row: Row | LayerItem; compact?: boolean }) {
  const text = "item" in row ? row.item.public_paraphrase : row.paraphrase;
  const url = "item" in row ? row.url : null;
  const hash = evidenceHash(row);
  const validEvidence = "item" in row ? row.validEvidence : Boolean(row.locator && row.hash);
  const rowStatus = "item" in row ? statusCopy(displayStatus(row), row.item.voice?.kind, row.modelStatus) : "semantic profile에서 관측";
  const modelStatus = "item" in row && row.modelStatus !== "supported"
    ? MODEL_STATUS_COPY[row.modelStatus] ?? row.modelStatus
    : null;
  const reason = "item" in row ? row.stateReason : null;
  return (
    <details className={`afp-evidence${compact ? " afp-evidence-compact" : ""}`}>
      <summary>{validEvidence ? (compact ? "근거" : "근거 보기") : "근거 상태"} · {validEvidence ? evidenceLocator(row) : rowStatus}</summary>
      <div className="afp-evidence-body">
        {validEvidence && text ? <p>{text}</p> : <p>{reason ?? "공개 근거 위치와 문장 지문이 함께 확인되지 않아 이 항목을 증거로 표시하지 않습니다."}</p>}
        <small>{rowStatus} · {"item" in row ? voiceCopy(row.item.voice?.kind) : ""}{modelStatus ? ` · ${modelStatus}` : ""}</small>
        {"item" in row && row.reviewRequired ? <small>자동 분석 초안 · 사람 검토 전</small> : null}
        {validEvidence && hash ? <small className="afp-hash">evidence hash · {hash.slice(0, 16)}…</small> : null}
        {url ? <a href={url} target="_blank" rel="noreferrer">원문 링크 열기 ↗</a> : null}
      </div>
    </details>
  );
}

function EvidenceRefs({ refs, label = "공개 근거 위치" }: { refs: unknown; label?: string }) {
  const rows = evidenceRefs(refs);
  if (!rows.length) return <small className="afp-state">{label} 없음</small>;
  return <details className="afp-evidence afp-evidence-compact"><summary>{label} {rows.length}개</summary><div className="afp-evidence-body">{rows.slice(0, 5).map((ref, index) => <small key={`${evidenceRefLabel(ref)}-${index}`}>{evidenceRefLabel(ref)}{ref.sentence_sha256 || ref.hash ? ` · hash ${(ref.sentence_sha256 ?? ref.hash)?.slice(0, 16)}…` : ""}</small>)}</div></details>;
}

function TableEvidenceDisclosure({ articleId, rows }: { articleId: string; rows: Array<{ dimension: string; row: Row }> }) {
  const refs = rows.flatMap(({ dimension, row }) => evidenceRefs(row.item.evidence).map((ref) => ({ dimension, ref })));
  if (!refs.length) return null;
  return <details className="afp-evidence afp-evidence-compact afp-table-evidence">
    <summary>기사 행 근거 {refs.length}개</summary>
    <div className="afp-evidence-body">
      <small className="afp-evidence-technical">article_id {articleId}</small>
      {refs.slice(0, 8).map(({ dimension, ref }, index) => <small key={`${dimension}-${evidenceRefLabel(ref)}-${index}`}>
        {DIM_LABEL[dimension] ?? dimension} · {evidenceRefLabel(ref)}{ref.sentence_sha256 || ref.hash ? ` · hash ${(ref.sentence_sha256 ?? ref.hash)?.slice(0, 16)}…` : ""}
      </small>)}
    </div>
  </details>;
}

function StateDisclosure({ reason, summary = "분석 상태" }: { reason?: string | null; summary?: string }) {
  return (
    <details className="afp-evidence afp-evidence-compact">
      <summary>{summary}</summary>
      <div className="afp-evidence-body"><p>{reason ?? "공개 근거가 확인되지 않아 이 항목은 표시하지 않습니다."}</p></div>
    </details>
  );
}

function EngineNote({ bundle }: { bundle: IssueAnalysisBundle }) {
  const semantic = bundle.analysisStatus.semantic;
  const clusterAi = bundle.analysisStatus.cluster ?? bundle.clusterAi;
  const comparison = bundle.comparison.engine;
  const profiles = bundle.semanticProfiles ?? [];
  const reviewStatuses = [...new Set(profiles.map((entry) => richProfile(entry)?.review?.status).filter((status): status is string => Boolean(status)))];
  const reviewRequired = semantic.requiresHumanReview || profiles.some((entry) => Boolean(richProfile(entry)?.review?.requires_human_review));
  const synthesis = synthesisData(bundle);
  const isVertexDirect = Boolean(
    semantic.semanticAi
    && comparison.semanticAi
    && synthesis?.usable === true
    && /gcp:event-synthesis|gcp:vertex/i.test(String(comparison.source ?? synthesis.source ?? "")),
  );
  const comparisonStatus = synthesis?.comparison_result?.status;
  const comparisonStatusLabel: Record<string, string> = {
    difference_confirmed: "차이 확인",
    no_clear_difference: "뚜렷한 차이 미관측",
    held_for_analysis: "비교 보류",
    analysis_failed: "분석 실패",
  };
  const comparisonLabel = comparisonStatus
    ? `비교 판정 · ${comparisonStatusLabel[comparisonStatus] ?? "상태 확인 필요"}`
    : "비교 판정 보류 · 명시적 결과 없음";
  const synthesisPrompt = synthesis?.promptVersion ?? "버전 미상";
  const synthesisSchema = synthesis?.schemaVersion ?? "버전 미상";
  const artifactSource = bundle.lineage?.source?.semanticDirectory || "공개 산출물 출처 미상";
  const reviewStatusLabels = reviewStatuses.map((status) => STATUS_COPY[status] ?? MODEL_STATUS_COPY[status] ?? "검토 상태 확인 필요");
  return (
    <p className="afp-method-note">
      <span className={`afs-chip ${isVertexDirect ? "afs-chip-brand" : "afs-badge-ex"}`}>
        {isVertexDirect ? "Vertex AI 실호출 직접 생성" : "프로필 합성기 fallback (profile-backed)"}
      </span>{" "}
      <span className="afs-chip">{comparisonLabel}</span>
      <br />
      <strong>기사 프로필:</strong> {semantic.model ?? clusterAi?.model ?? "모델 미상"} · prompt {semantic.promptVersion ?? clusterAi?.promptVersion ?? "v1.0.0"} · schema {semantic.schemaVersion ?? "v2"} · snapshot {bundle.lineage.issueId ?? "미상"} · 산출물 {artifactSource}.
      <br />
      <strong>사건 종합 계약:</strong> prompt {synthesisPrompt} · schema {synthesisSchema} · {comparisonLabel}.
      <br />
      <strong>상태:</strong> {reviewRequired ? "사람 검토 전 자동 분석 초안" : "사람 검토 완료"}. {reviewStatusLabels.length ? `(프로필 검토: ${reviewStatusLabels.join(", ")})` : ""}
      <br />
      <strong>보호 원칙:</strong> 공개 화면에는 paraphrase·근거 위치(locator)·SHA-256 해시 지문만 표시하며, 원문 본문·HTML·원문 문장 자체는 노출하지 않습니다.
    </p>
  );
}

function Summary({ bundle, issue, analyses: dimensions, compact = false }: { bundle: IssueAnalysisBundle; issue: IssueView; analyses: DimensionAnalysis[]; compact?: boolean }) {
  const comparison = comparisonSummary(bundle);
  const commonOutletCount = new Set(comparison.commonObservations.map((row) => row.outlet)).size;
  const commonDescriptionLabel = comparison.commonScope
    ? `${commonOutletCount > 1 ? "여러 매체" : "여러 기사"}에서 공통으로 확인한 설명 (${comparison.commonScope}):`
    : "공통으로 확인한 설명:";
  const observed = dimensions.filter((dimension) => dimension.observedArticles > 0);
  const allRows = dimensions.flatMap((dimension) => dimension.rows).filter((row) => !row.stateOnly && row.validEvidence);
  const attributed = allRows.filter((row) => isAttributed(row.item.voice?.kind)).length;
  const stateCounts = dimensions.flatMap((dimension) => dimension.rows)
    .filter((row) => row.stateOnly || !row.validEvidence || row.modelStatus !== "supported")
    .reduce((counts, row) => {
      const key = row.stateOnly ? row.modelStatus : (row.validEvidence ? row.modelStatus : "insufficient_evidence");
      counts.set(key, (counts.get(key) ?? 0) + 1);
      return counts;
    }, new Map<string, number>());
  const stateText = [...stateCounts.entries()]
    .map(([state, count]) => `${MODEL_STATUS_COPY[state] ?? STATUS_COPY[state] ?? state} ${count}건`)
    .join(" · ");
  return (
    <section className={`afs-card afs-card-lead${compact ? " afp-summary-compact" : ""}`}>
      <h2>이 사안의 프레이밍 요약</h2>
      <div className="afs-in afs-prose afp-summary">
        <p><strong>{commonDescriptionLabel}</strong> {comparison.commonText ?? "공통 설명으로 묶을 공개 근거가 아직 없습니다."}</p>
        <p><strong>{comparison.status === "difference_confirmed" ? "확인된 차이" : "비교 결과"}:</strong> {comparison.differenceText}</p>
        {!compact ? <p><strong>읽을 때 볼 점:</strong> {comparison.whatToNotice}</p> : null}
        {!compact && issue.sourceContext ? <p><strong>취재원 맥락:</strong> {issue.sourceContext}</p> : null}
        <p className="afp-summary-meta"><span className={`afp-comparison-status afp-status-${comparison.status}`}>{comparison.statusLabel}</span> · 기자 서술 근거 {comparison.analyzedArticleCount}건 · {comparison.analyzedOutletCount}개 매체 · {observed.length}/{DIMENSION_LIST.length}개 차원 관측 · 관측 항목 중 취재원 발언 {allRows.length ? Math.round((attributed / allRows.length) * 100) : 0}%</p>
        {!compact && stateText ? <p className="afp-summary-meta"><strong>판정 보류·상태:</strong> {stateText}</p> : null}
      </div>
      {!compact ? <EngineNote bundle={bundle} /> : null}
    </section>
  );
}

export function SynthesisNarrative({ bundle }: { bundle: IssueAnalysisBundle }) {
  const synthesis = synthesisData(bundle);
  const unverifiedLive = bundle.basisDate === "2026-08-15" && synthesis?.usable !== true;
  if (unverifiedLive) {
    return (
      <section className="afs-card afs-card-lead afp-synthesis">
        <h2>사건 종합 비교 <small className="afs-num">분석 검증 중</small></h2>
        <div className="afs-in afs-prose">
          <p className="afp-state">
            2026-08-15 기사 목록은 유지하지만, 실제 Vertex 호출 lineage와 문장 재검증이
            끝나기 전에는 비교·프레이밍 문장을 표시하지 않습니다.
          </p>
        </div>
      </section>
    );
  }
  if (!synthesis?.usable) return null;
  const what = observedClaim(synthesis.what_happened, bundle);
  const agreed = observedClaim(synthesis.agreed_line, bundle);
  const split = observedClaim(synthesis.split_line, bundle);
  const soWhat = observedClaim(synthesis.so_what, bundle);
  const camps = (synthesis.camps ?? []).filter((camp) => camp.gist && (camp.outlets?.length || camp.article_ids?.length));
  const terms = (synthesis.terms ?? []).filter((term) => term.term && term.gloss);
  const factRows = synthesis.fact_rows ?? [];
  const splitRows = synthesis.split_rows ?? [];
  const campColors = ["var(--n1, #2563eb)", "var(--n2, #d97706)", "var(--n3, #7c3aed)", "var(--n4, #059669)"];
  const isVertexDirect = Boolean(
    bundle.comparison.engine?.semanticAi
    && synthesis.source === "gcp:event-synthesis"
    && Boolean(synthesis.invocation)
    && Boolean((bundle.lineage as { runId?: string } | undefined)?.runId),
  );

  return (
    <section className="afs-card afs-card-lead afp-synthesis">
      <h2>
        사건 종합 비교
        <small className="afs-num">
          {isVertexDirect ? "Vertex AI 기사 근거 기반 생성" : "프로필 합성기 fallback 관측"}
        </small>
      </h2>
      <div className="afs-in afs-prose">
        <div style={{ marginBottom: "12px", display: "flex", flexWrap: "wrap", gap: "6px" }}>
          <span className={`afs-chip ${isVertexDirect ? "afs-chip-brand" : "afs-badge-ex"}`}>
            {isVertexDirect ? "Vertex AI 실호출 직접 생성" : "프로필 합성기 fallback"}
          </span>
          <span className="afs-chip">
            {bundle.analysisStatus?.semantic?.model ?? "claude-sonnet-5x2-opus-5-adjudicated"}
          </span>
          <span className="afs-chip">
            prompt {bundle.analysisStatus?.semantic?.promptVersion ?? "claude-framing-v1.0.0"}
          </span>
        </div>

        {what ? (
          <div className="afs-finding">
            <p>{what}</p>
            <EvidenceRefs refs={synthesis.what_happened?.evidence} label="사건 요약 근거" />
          </div>
        ) : null}

        {agreed && split && synthesis.opposition ? (
          <div className="afs-contrast">
            <p className="afs-contrast-q">공통으로 본 점 ↔ 갈라지는 지점</p>
            <div className="afs-contrast-pair">
              <blockquote className="l">
                <cite>공통으로 확인된 설명</cite>
                <p>{agreed}</p>
                <EvidenceRefs refs={synthesis.agreed_line?.evidence} label="공통선 근거" />
              </blockquote>
              <blockquote className="r">
                <cite>핵심 대립선</cite>
                <p>{split}</p>
                <EvidenceRefs refs={synthesis.split_line?.evidence} label="대립선 근거" />
              </blockquote>
            </div>
          </div>
        ) : (
          <>
            {agreed ? (
              <div>
                <p><strong>공통선:</strong> {agreed}</p>
                <EvidenceRefs refs={synthesis.agreed_line?.evidence} label="공통선 근거" />
              </div>
            ) : null}
            {synthesis.opposition && split ? (
              <div>
                <p><strong>갈라지는 선:</strong> {split}</p>
                <EvidenceRefs refs={synthesis.split_line?.evidence} label="대립선 근거" />
              </div>
            ) : (
              <p className="afp-state">서로 다른 근거 그룹이 없어 대립 구도로 표시하지 않습니다.</p>
            )}
          </>
        )}

        {soWhat ? (
          <div className="afp-summary-meta">
            <p><strong>읽기 차이:</strong> {soWhat}</p>
            <EvidenceRefs refs={synthesis.so_what?.evidence} label="읽기 차이 근거" />
          </div>
        ) : null}

        {terms.length ? (
          <div className="afs-layer-head">
            <span>핵심 용어와 정의</span>
            <b>{terms.length}개 용어</b>
          </div>
        ) : null}
        {terms.length ? (
          <ul className="afp-term-list">
            {terms.map((term) => {
              const hasEv = evidenceRefs(term.evidence).length > 0;
              return (
                <li key={term.term}>
                  <strong>{term.term}</strong>{" "}
                  {hasEv ? <span>{term.gloss}</span> : <span className="afp-state">근거 검증 대기</span>}
                  <EvidenceRefs refs={term.evidence} label="용어 근거" />
                </li>
              );
            })}
          </ul>
        ) : null}

        {camps.length >= 2 ? (
          <>
            <div className="afs-layer-head">
              <span>관측된 논조 갈래 (Camps)</span>
              <b>{camps.length}개 갈래</b>
            </div>
            <div className="afs-camps">
              {camps.map((camp, index) => {
                const color = campColors[index % campColors.length];
                return (
                  <article
                    className="afp-synthesis-camp"
                    key={`${camp.index ?? camp.name}`}
                  >
                    <b style={{ color }}>{camp.name}</b>
                    <p>{camp.gist}</p>
                    <div style={{ marginTop: "8px", display: "flex", flexWrap: "wrap", gap: "4px" }}>
                      {(camp.outlets ?? []).map((outlet) => (
                        <span key={outlet} className="afs-chip" style={{ fontSize: "11px" }}>
                          {outlet}
                        </span>
                      ))}
                    </div>
                    <EvidenceRefs refs={camp.evidence} label="캠프 근거" />
                  </article>
                );
              })}
            </div>
          </>
        ) : null}

        {factRows.length ? (
          <div className="afp-fact-rows" style={{ marginTop: "16px" }}>
            <div className="afs-layer-head">
              <span>공통으로 본 항목</span>
              <b>{factRows.length}개 질문</b>
            </div>
            {factRows.map((row) => {
              const hasEv = evidenceRefs(row.evidence).length > 0;
              return (
                <div key={row.question} style={{ margin: "6px 0", fontSize: "13px" }}>
                  <strong>{row.question}:</strong>{" "}
                  {hasEv && row.common ? (
                    <span>{row.common}</span>
                  ) : (
                    <span className="afp-state">
                       {row.status === "explicit_not_stated" ? "명시적으로 언급되지 않음" : "공개 근거 지문 부족으로 내용 미표시"}
                    </span>
                  )}
                  <EvidenceRefs refs={row.evidence} label="질문 근거" />
                </div>
              );
            })}
          </div>
        ) : null}

        {synthesis.opposition && splitRows.length ? (
          <div className="afp-split-rows" style={{ marginTop: "16px" }}>
            <div className="afs-layer-head">
              <span>캠프별 차이</span>
              <b>{splitRows.length}개 질문</b>
            </div>
            {splitRows.map((row) => {
              const hasEv = evidenceRefs(row.evidence).length > 0;
              const cells = (row.cells ?? []).filter(Boolean);
              return (
                <div key={row.question} style={{ margin: "6px 0", fontSize: "13px" }}>
                  <strong>{row.question}:</strong>{" "}
                  {hasEv && cells.length > 0 ? (
                    <span>{cells.join("  /  ")}</span>
                  ) : (
                    <span className="afp-state">
                       {row.status === "explicit_not_stated" ? "명시적으로 언급되지 않음" : "공개 근거 지문 부족으로 내용 미표시"}
                    </span>
                  )}
                  <EvidenceRefs refs={row.evidence} label="질문 근거" />
                </div>
              );
            })}
          </div>
        ) : null}

        <p className="afs-note" style={{ marginTop: "14px" }}>
          캠프 이름은 기사에서 관측된 강조의 묶음입니다. 언론사 이념이나 의도를 뜻하지 않으며, locator와 문장 해시가 없는 문장은 표시하지 않습니다.
        </p>
      </div>
    </section>
  );
}

function AxisCard({ analysis }: { analysis: DimensionAnalysis }) {
  if (!analysis.groups.length) return null;
  return (
    <article className="afp-axis-card">
      <header><span className="afp-kicker">{analysis.label}</span><h3>같은 표현이 반복된 기사 관측</h3></header>
      <div className="afp-axis-groups">
        {analysis.groups.map((group) => (
          <div className="afp-axis-group" key={group.family}>
            <div className="afp-axis-group-head"><strong>{group.label}</strong><span>{group.articleIds.length}건 · {group.outlets.length}개 매체</span></div>
            {group.rows[0]?.validEvidence && group.rows[0].item.public_paraphrase ? <p>{group.rows[0].item.public_paraphrase}</p> : <p className="afp-state">{group.rows[0]?.stateReason ?? "공개 근거 지문이 없어 paraphrase를 표시하지 않습니다."}</p>}
            <div className="afp-badges"><span>{group.narratedArticles ? `매체 서술 ${group.narratedArticles}` : "매체 서술 미관측"}</span><span>{group.attributedArticles ? `취재원 발언 ${group.attributedArticles}` : "취재원 발언 없음"}</span></div>
            {group.rows[0] ? <EvidenceDisclosure row={group.rows[0]} compact /> : null}
          </div>
        ))}
      </div>
    </article>
  );
}

function AxisSection({ dimensions }: { dimensions: DimensionAnalysis[] }) {
  const observed = dimensions.filter((dimension) => dimension.groups.length > 0);
  const sourceOnly = dimensions.filter((dimension) => dimension.groups.length === 0 && dimension.sourceGroups.length > 0);
  return (
    <section className="afs-card">
      <h2>기사별 표현 관측 <small>최종 비교 판정과 분리</small></h2>
      <div className="afs-in">
        <p className="afs-note">아래 묶음은 공개 paraphrase가 정확히 반복된 경우의 원장입니다. 문장 유사도·프레임 계열·묶음 수만으로 같은 의미나 매체 차이를 판정하지 않으며, 확정 비교는 위의 근거 연결 결과만 따릅니다.</p>
        <div className="afp-status-strip">{dimensions.map((analysis) => <span key={analysis.dimension}><b>{analysis.label}</b> {Object.entries(analysis.stateCounts).map(([state, count]) => `${STATUS_COPY[state] ?? state} ${count}`).join(" · ") || "공개 상태 없음"}</span>)}</div>
        {observed.length ? <div className="afp-axis-list">{observed.map((analysis) => <AxisCard key={analysis.dimension} analysis={analysis} />)}</div> : <p className="afp-state">반복된 공개 paraphrase 묶음이 없습니다. 공통 설명과 취재원 배치는 위의 비교 결과와 아래 표에서 확인합니다.</p>}
        {sourceOnly.length ? <p className="afp-state afp-source-only-note">{sourceOnly.map((analysis) => `${analysis.label}의 다른 설명은 취재원 발언에서만 ${analysis.sourceGroups.length}개 표현으로 관측되어 매체 간 차이로 세지 않았습니다.`).join(" ")}</p> : null}
      </div>
    </section>
  );
}

function DebateSection({ issue, dimensions }: { issue: IssueView; dimensions: DimensionAnalysis[] }) {
  const observed = dimensions.filter((dimension) => dimension.groups.length > 0);
  return (
    <section className="afs-card afp-debate">
      <h2>공통으로 본 것과 기사별 관측 <small>확정 차이는 상단 결과만 사용</small></h2>
      <div className="afs-in">
        <div className="afp-common-ground">
          <strong>공통으로 본 것</strong>
          <p>{issue.commonGround ?? "검증 가능한 공통 설명이 없습니다."}</p>
        </div>
        {observed.length ? <div className="afp-debate-boxes">{observed.map((dimension, index) => (
          <details className="afp-debate-box" key={dimension.dimension}>
            <summary><span>관측 축 {String.fromCharCode(65 + index)}</span><strong>{dimension.label}: {dimension.question}</strong><small>{dimension.groups.length}개 반복 표현 · {dimension.observedArticles}건</small></summary>
            <div className="afp-debate-body">
              {dimension.groups.map((group) => <article key={group.family}><h3>{group.label}</h3><p className="afp-summary-meta">{group.outlets.join(" · ")} · {group.articleIds.length}건</p>{group.rows.map((row, rowIndex) => <div className="afp-proof-row" key={`${row.articleId}-${rowIndex}`}><b>{row.outlet}</b><span>{row.validEvidence ? row.item.public_paraphrase : row.stateReason}</span><small>{statusCopy(displayStatus(row), row.item.voice?.kind, row.modelStatus)}</small><EvidenceDisclosure row={row} compact /></div>)}</article>)}
              <p className="afs-note">이 목록은 반복 표현과 기사 근거를 펼쳐 보는 원장입니다. 매체의 고정 성향이나 의도를 의미하지 않으며, semantic AI가 별도 관계를 명시하지 않으면 차이로 읽지 않습니다.</p>
            </div>
          </details>
        ))}</div> : <p className="afp-state">반복 표현 원장이 없습니다. 현재 매체 자체 서술의 차이는 확정되지 않았습니다.</p>}
      </div>
    </section>
  );
}

function ComparisonAxisEvidence({ bundle, issue }: { bundle: IssueAnalysisBundle; issue: IssueView }) {
  const axes = comparisonAxes(bundle);
  const articles = new Map(issue.articles.map((article) => [article.articleId, article]));
  return (
    <section className="afs-card afp-comparison-evidence">
      <h2>비교 원장: 축별 기사 근거 <small>공개 paraphrase · locator · hash</small></h2>
      <div className="afs-in">
        <p className="afs-note">축별 패턴은 같은 사건을 설명한 방식의 관측입니다. 취재원 발언 기반 패턴은 매체의 자체 논조로 세지 않으며, 위치와 문장 지문이 검증된 항목만 펼쳐 봅니다.</p>
        {axes.length ? <div className="afp-axis-ledger">{axes.map((axis) => {
          const patterns = axis.patterns ?? [];
          return <article className="afp-ledger-axis" key={axis.dimension ?? axis.label}>
            <header><span className="afp-kicker">{axis.label ?? DIM_LABEL[axis.dimension ?? ""] ?? "비교 축"}</span><strong>{axis.observed_article_count ?? 0}건 관측 · {axis.not_observed_article_count ?? 0}건 미관측</strong></header>
            {patterns.length ? <div className="afp-ledger-patterns">{patterns.slice(0, 5).map((pattern, index) => {
              const refs = validComparisonEvidence(bundle, pattern);
              const articleRows = (pattern.article_ids ?? []).map((id) => articles.get(id)).filter(Boolean);
              const outlets = [...new Set(articleRows.map((article) => article?.outlet).filter(Boolean))];
              return <div className="afp-ledger-pattern" key={`${axis.dimension}-${pattern.voice_scope}-${index}`}>
                <div className="afp-axis-group-head"><strong>{comparisonScopeLabel(pattern.voice_scope)}</strong><span>{pattern.article_count ?? articleRows.length}건 · {outlets.length}개 매체</span></div>
                {refs.length && pattern.public_paraphrase ? <p>{pattern.public_paraphrase}</p> : <p className="afp-state">{refs.length ? "검증된 공개 paraphrase가 없습니다." : "위치·해시가 함께 검증된 공개 근거가 없어 내용을 표시하지 않습니다."}</p>}
                {articleRows.length ? <small className="afp-summary-meta">{articleRows.slice(0, 4).map((article) => `${article?.outlet ?? "매체 미상"} · ${article?.title ?? "제목 미상"}`).join(" / ")}</small> : null}
                {refs.length ? <EvidenceRefs refs={refs} label="축별 근거" /> : <small className="afp-state">근거 상태: 공개 근거 부족</small>}
              </div>;
            })}</div> : <p className="afp-state">이 축에는 공개 패턴이 없습니다. 기사에 해당 요소가 없다고 단정하지 않습니다.</p>}
          </article>;
        })}</div> : <p className="afp-state">비교 원장에 축별 패턴이 없습니다. semantic AI 기사 프로필의 상태와 근거를 기준으로만 비교합니다.</p>}
      </div>
    </section>
  );
}

function StructuredObservationSection({ bundle, issue }: { bundle: IssueAnalysisBundle; issue: IssueView }) {
  const articles = new Map(issue.articles.map((article) => [article.articleId, article]));
  const profiles = (bundle.ruleProfiles ?? []).map((entry) => ({ entry, profile: structuredProfile(entry) })).filter(({ entry, profile }) => Boolean(profile) && entry.status === "succeeded");
  const countValues = (values: Array<string | undefined>) => [...values.reduce((map, value) => {
    if (value) map.set(value, (map.get(value) ?? 0) + 1);
    return map;
  }, new Map<string, number>())].sort((a, b) => b[1] - a[1] || compareStableText(a[0], b[0]));
  const displayValue = (labels: Record<string, string>, code?: string, label?: string) => code || label ? (labels[code ?? ""] ?? codeLabel(code, label)) : undefined;
  const genre = countValues(profiles.map(({ profile }) => displayValue(GENRE_LABEL, profile?.genre?.code, profile?.genre?.label)));
  const scope = countValues(profiles.map(({ profile }) => displayValue(SCOPE_KIND_LABEL, profile?.scope?.code, profile?.scope?.label)));
  const depth = countValues(profiles.map(({ profile }) => displayValue(DEPTH_LABEL, profile?.context_depth?.level, profile?.context_depth?.label)));
  const devices = profiles.flatMap(({ entry, profile }) => (profile?.framing_devices ?? []).map((device) => ({ ...device, articleId: entry.articleId })));
  const descriptors = profiles.flatMap(({ entry, profile }) => [
    ...(profile?.secondary_descriptors?.policy_frames ?? []).map((row) => ({ ...row, kind: "정책 프레임", articleId: entry.articleId })),
    ...(profile?.secondary_descriptors?.generic_frames ?? []).map((row) => ({ ...row, kind: "보편 프레임", articleId: entry.articleId })),
  ]);
  return (
    <section className="afs-card afp-structured-observation">
      <h2>구조화 보조 관측 <small>규칙 기반 · semantic AI와 별도</small></h2>
      <div className="afs-in">
        <p className="afs-note">아래 값은 공개 snapshot에 포함된 결정론적 구조화 프로필입니다. semantic AI의 의미 판정이나 언론사의 의도를 대신하지 않으며, 해당 보조 엔진의 관측 범위와 근거 위치만 보여 줍니다.</p>
        {profiles.length ? <>
          <div className="afp-stat-grid">
            <div><span>장르</span><strong>{genre.map(([label, count]) => `${label} ${count}`).join(" · ") || "미분류"}</strong></div>
            <div><span>시야</span><strong>{scope.map(([label, count]) => `${label} ${count}`).join(" · ") || "미관측"}</strong></div>
            <div><span>맥락 깊이</span><strong>{depth.map(([label, count]) => `${label} ${count}`).join(" · ") || "미관측"}</strong></div>
          </div>
          {descriptors.length ? <div className="afp-descriptor-list">{descriptors.slice(0, 20).map((row, index) => <div key={`${row.kind}-${row.code ?? row.label}-${index}`}><strong>{row.kind}: {codeLabel(row.code, row.label)}</strong><span>{articles.get(row.articleId)?.outlet ?? "매체 미상"} · {articles.get(row.articleId)?.title ?? "제목 미상"}{typeof row.article_count === "number" && row.article_count > 0 ? ` · ${row.article_count}건` : ""}</span><details className="afp-technical-disclosure"><summary>기술 식별자</summary><div className="afp-evidence-body"><small>article_id {row.articleId}</small></div></details><EvidenceRefs refs={row.evidence} label="보조 관측 근거" /></div>)}</div> : <p className="afp-state">정책·보편 프레임 코드는 이 snapshot에서 구조화되지 않았습니다.</p>}
          {devices.length ? <div className="afp-device-list">{devices.slice(0, 20).map((device, index) => <div key={`${device.code ?? device.label}-${device.articleId}-${index}`}><strong>{codeLabel(device.code, device.label)}</strong><span>{articles.get(device.articleId)?.outlet ?? "매체 미상"} · {articles.get(device.articleId)?.title ?? "제목 미상"}{typeof device.count === "number" && device.count > 0 ? ` · ${device.count}건` : ""}{device.appears_in_lead ? " · 제목/리드에 관측" : ""}</span><details className="afp-technical-disclosure"><summary>기술 식별자</summary><div className="afp-evidence-body"><small>article_id {device.articleId}</small></div></details><EvidenceRefs refs={device.evidence} label="장치 근거" /></div>)}</div> : <p className="afp-state">구조화된 표현 장치가 없습니다. 본문에 장치가 없다고 단정하지 않고 이 분류만 미관측으로 둡니다.</p>}
        </> : <p className="afp-state">이 공개 snapshot에는 구조화 보조 프로필이 없습니다. semantic AI 결과와 혼동하지 않도록 빈 결과를 추정해 채우지 않았습니다.</p>}
      </div>
    </section>
  );
}

function MatrixCell({ rows }: { rows: Row[] }) {
  const first = rows[0];
  if (!first) return <span className="afp-cell-state">공개 프로필에 해당 차원 없음</span>;
  const distinct = uniqueItems(rows.map((row) => row.item));
  return (
    <div className="afp-cell">
      <strong>{first.item.frame_family ? familyLabel(first.item.frame_family) : "분류 코드 미확정"}</strong>
      <span className="afp-cell-voice">{statusCopy(displayStatus(first), first.item.voice?.kind)} · {MODEL_STATUS_COPY[first.modelStatus] ?? first.modelStatus}</span>
      {first.stateOnly || !first.validEvidence ? <StateDisclosure reason={first.stateReason} /> : first.item.public_paraphrase ? <p>{first.item.public_paraphrase}</p> : null}
      <EvidenceDisclosure row={first} compact />
      {distinct.length > 1 ? <details className="afp-more"><summary>다른 관측 {distinct.length - 1}개</summary>{rows.slice(1, 3).map((row, index) => <div key={`${row.item.public_paraphrase}-${index}`}><p>{row.validEvidence ? (row.item.public_paraphrase ?? "검증된 paraphrase 없음") : (row.stateReason ?? "검증 가능한 근거 지문 없음")}</p><small>{statusCopy(displayStatus(row), row.item.voice?.kind, row.modelStatus)}</small><EvidenceDisclosure row={row} compact /></div>)}</details> : null}
    </div>
  );
}

function FrameMatrix({ issue, dimensions }: { issue: IssueView; dimensions: DimensionAnalysis[] }) {
  return (
    <div className="afs-scroll">
      <table className="afs-table afp-matrix">
        <caption>기사 단위 semantic profile을 매체별로 나란히 비교합니다. 빈 칸은 명시적 미관측·근거 부족·검토 상태를 뜻하며 매체의 의도나 성향을 추정한 값이 아닙니다.</caption>
        <thead><tr><th scope="col">매체</th>{DIMENSION_LIST.map((dimension) => <th scope="col" key={dimension}>{DIM_LABEL[dimension]}</th>)}<th scope="col">중심 취재원</th></tr></thead>
        <tbody>
          {issue.outlets.map((outlet) => {
            const outletArticles = issue.articles.filter((article) => article.outlet === outlet.outlet);
            return <tr key={outlet.outlet}>
              <th scope="row"><strong>{outlet.outlet}</strong><small>{outletArticles.length}건</small></th>
              {dimensions.map((dimension) => <td key={dimension.dimension}><MatrixCell rows={dimension.rows.filter((row) => row.outlet === outlet.outlet)} /></td>)}
              <td><div className="afp-source-cell">{outlet.roles.slice(0, 3).map((role) => <span key={role.label}>{role.label} <b>{role.count}</b></span>)}{!outlet.roles.length ? <span>취재원 역할 분석 대기</span> : null}</div></td>
            </tr>;
          })}
        </tbody>
      </table>
    </div>
  );
}

function DimensionGuide({ dimensions }: { dimensions: DimensionAnalysis[] }) {
  return (
    <section className="afs-card afp-dimension-guide">
      <h2>프레이밍의 여섯 관측축 <small>문제·원인·책임·평가·해법·취재원</small></h2>
      <div className="afs-in afp-dimension-grid">
        {FRAME_GUIDE_DIMENSIONS.map((dimension, index) => {
          const analysis = dimensions.find((entry) => entry.dimension === dimension);
          const sourceProfiles = dimension === "actor_visibility" ? dimensions.reduce((sum, entry) => sum + entry.rows.filter((row) => row.validEvidence && isAttributed(row.item.voice?.kind)).length, 0) : null;
          return <article key={dimension}><span className="afp-kicker">{String(index + 1).padStart(2, "0")}</span><h3>{GUIDE_QUESTION[dimension]}</h3><p><b>{GUIDE_LABEL[dimension]}</b> · {CORE_DIM_EXPLANATIONS[dimension]}</p><small>{dimension === "actor_visibility" ? (sourceProfiles ? `${sourceProfiles}건 취재원 귀속 관측` : "취재원 발화 근거 미관측") : analysis?.observedArticles ? `${analysis.observedArticles}건 관측 · ${analysis.stateCounts.explicit_not_stated ?? 0}건 명시적 미제시` : "공개 근거 미관측"}</small></article>;
        })}
      </div>
      <p className="afs-note">차원은 기사에 실제로 제시된 문제·원인·책임·평가·해법을 분리해 읽는 틀입니다. 한 차원의 미관측은 해당 요소가 실제로 없거나 의도적으로 빠졌다는 뜻이 아닙니다.</p>
    </section>
  );
}

function FourFunctionTable({ issue, dimensions }: { issue: IssueView; dimensions: DimensionAnalysis[] }) {
  const tableDimensions = CORE_DIMENSIONS.filter((dimension) => dimension !== "responsibility_attribution");
  return (
    <section className="afs-card afp-four-functions">
      <h2>프레임 4기능 비교 <small>문제·원인·평가·해법</small></h2>
      <div className="afs-in">
        <div className="afs-scroll"><table className="afs-table"><caption>각 셀은 검증된 public paraphrase만 표시합니다. 긴 근거 위치·해시는 기사 행 disclosure로 확인하고, 출처 발언은 매체 서술과 분리합니다.</caption><thead><tr><th scope="col">매체·기사</th>{tableDimensions.map((dimension) => <th scope="col" key={dimension}>{DIM_LABEL[dimension]}</th>)}</tr></thead><tbody>
          {issue.articles.map((article) => {
            const observedRows = tableDimensions.map((dimension) => {
              const dimensionAnalysis = dimensions.find((entry) => entry.dimension === dimension);
              const rows = dimensionAnalysis?.rows.filter((entry) => entry.articleId === article.articleId && entry.validEvidence) ?? [];
              return {
                dimension,
                dimensionAnalysis,
                rows: rows.filter((entry, index) => rows.findIndex((other) => other.item.public_paraphrase === entry.item.public_paraphrase && other.item.voice?.kind === entry.item.voice?.kind) === index),
              };
            });
            const evidenceRows = observedRows.flatMap((entry) => entry.rows.map((row) => ({ dimension: entry.dimension, row })));
            return <tr key={article.articleId}>
              <th scope="row">
                <strong>{article.outlet}</strong>
                <small>{article.title}</small>
                <TableEvidenceDisclosure articleId={article.articleId} rows={evidenceRows} />
              </th>
              {observedRows.map(({ dimension, dimensionAnalysis, rows }) => <td key={dimension}>
                {rows.length ? rows.map((row, index) => <div key={index}><span className="afp-cell-voice">{statusCopy(displayStatus(row), row.item.voice?.kind, row.modelStatus)}</span><p>{row.item.public_paraphrase ?? "검증된 paraphrase 없음"}</p></div>) : <StateDisclosure summary="분석 상태" reason={dimensionAnalysis?.rows.find((entry) => entry.articleId === article.articleId)?.stateReason ?? "명시적 판정 없음"} />}
              </td>)}
            </tr>;
          })}
        </tbody></table></div>
        <p className="afs-note">‘책임 귀속’은 4기능과 별도의 관계·주체 축으로 기사별 근거 목록에서 함께 확인합니다. 빈 셀은 의도적 누락이 아니라 공개 근거가 확인되지 않은 상태입니다.</p>
      </div>
    </section>
  );
}

function SourceTable({ issue }: { issue: IssueView }) {
  return (
    <div className="afs-scroll"><table className="afs-table"><caption>인용 횟수는 목소리의 가시성이지 신뢰도나 매체의 지지 여부가 아닙니다.</caption><thead><tr><th>매체</th><th>주요 역할</th><th>직접 인용</th><th>간접 전언</th></tr></thead><tbody>
      {issue.outlets.map((outlet) => <tr key={outlet.outlet}><th>{outlet.outlet}</th><td>{outlet.roles.slice(0, 3).map((role) => `${role.label} ${role.count}건`).join(" · ") || "역할 분석 대기"}</td><td className="afs-num">{outlet.roles.length ? outlet.directQuotes : "미관측"}</td><td className="afs-num">{outlet.roles.length ? outlet.indirectQuotes : "미관측"}</td></tr>)}
    </tbody></table></div>
  );
}

function SourceRoleEvidence({ bundle, issue }: { bundle: IssueAnalysisBundle; issue: IssueView }) {
  const articles = new Map(issue.articles.map((article) => [article.articleId, article]));
  const rows = bundle.semanticProfiles
    .filter((entry) => semanticEntryIsEligible(entry, bundle))
    .flatMap((entry) => (richProfile(entry)?.actors_and_sources ?? []).map((actor) => ({ ...actor, articleId: entry.articleId })));
  return <section className="afs-card"><h2>취재원 역할과 전달 방식 <small>기사별 공개 근거 위치</small></h2><div className="afs-in"><p className="afs-note">취재원 구성은 목소리의 가시성에 대한 관측이며, 매체의 지지·균형·의도를 의미하지 않습니다.</p>{rows.length ? <div className="afp-source-evidence">{rows.map((row, index) => <article key={`${row.articleId}-${row.actor_id ?? row.role}-${index}`}><strong>{row.role_label ?? row.role ?? "역할 미상"}</strong><span>{articles.get(row.articleId)?.outlet ?? "매체 미상"} · {articles.get(row.articleId)?.title ?? "제목 미상"} · 직접 인용 {row.direct_quote_count ?? 0} · 간접 전언 {row.indirect_attribution_count ?? 0}</span><details className="afp-technical-disclosure"><summary>기술 식별자</summary><div className="afp-evidence-body"><small>article_id {row.articleId}</small></div></details><EvidenceRefs refs={row.evidence} label="취재원 근거" /></article>)}</div> : <p className="afp-state">기사별 취재원 역할·근거가 공개 프로필에 구조화되지 않았습니다.</p>}</div></section>;
}

function VoiceTable({ issue }: { issue: IssueView }) {
  return <div className="afs-scroll"><table className="afs-table"><caption>직접 인용·간접 전언·기자 서술을 분리해 계산합니다.</caption><thead><tr><th>매체</th><th>기사 수</th><th>관측된 발화 방식</th></tr></thead><tbody>{issue.outlets.map((outlet) => <tr key={outlet.outlet}><th>{outlet.outlet}</th><td>{outlet.articleCount}</td><td>{outlet.voices.map((voice) => `${voice.label} ${voice.count}`).join(" · ") || "발화 방식 분석 대기"}</td></tr>)}</tbody></table></div>;
}

function ArticleList({ bundle, issue, dimensions }: { bundle: IssueAnalysisBundle; issue: IssueView; dimensions: DimensionAnalysis[] }) {
  const entryMap = profileMap(bundle);
  return <div className="afp-article-list">{issue.articles.map((article) => {
    const entry = entryMap.get(article.articleId);
    const rows = dimensions.flatMap((dimension) => dimension.rows.filter((row) => row.articleId === article.articleId).map((row) => ({ ...row, dimension: dimension.label })));
    const profile = richProfile(entry);
    const profileReview = profile?.review;
    const articleStatus = entry?.status === "succeeded" ? (profileReview?.status ?? "succeeded") : (entry?.status ?? "analysis_failed");
    const articleStatusLabel = STATUS_COPY[articleStatus] ?? MODEL_STATUS_COPY[articleStatus] ?? "분석 상태 확인 필요";
    const evidenceCountLabel = entry?.evidence.length ? `${entry.evidence.length}개 공개 지문` : "공개 지문 미관측";
    return <details className="afp-article" key={article.articleId}>
      <summary><span>{article.outlet}</span><strong>{article.title}</strong><small>{articleStatusLabel} · {evidenceCountLabel} · {article.publishedAt ?? "발행일 미상"}</small></summary>
      <div className="afp-article-body">
        <details className="afp-technical-disclosure"><summary>기사 식별자·분석 설정</summary><div className="afp-evidence-body"><small>article_id {article.articleId} · model {entry?.engine.model ?? "모델 미상"} · prompt {entry?.engine.promptVersion ?? "버전 미상"}</small></div></details>
        {rows.length ? rows.slice(0, 8).map((row, index) => <div className="afp-article-row" key={`${row.dimension}-${index}`}><b>{row.dimension}</b><span>{row.stateOnly || !row.validEvidence ? row.stateReason : row.item.public_paraphrase ?? "공개 paraphrase 미제공"}</span><small>{statusCopy(displayStatus(row), row.item.voice?.kind)} · {row.validEvidence ? evidenceLocator(row) : "공개 근거 지문 없음"}{row.reviewRequired ? " · 사람 검토 전" : ""}</small><EvidenceDisclosure row={row} compact /></div>) : <p className="afp-state">이 기사에는 현재 공개된 semantic 차원 항목이 없습니다. 원문 본문을 대신 표시하지 않습니다.</p>}
        {profileReview?.fallback_reason ? <p className="afp-state">분석 보류 사유: {profileReview.fallback_reason}</p> : null}
        {article.url ? <a href={article.url} target="_blank" rel="noreferrer">원문 링크 열기 ↗</a> : null}
      </div>
    </details>;
  })}</div>;
}

function ClusterSection({ issue, dimensions }: { issue: IssueView; dimensions: DimensionAnalysis[] }) {
  const clusters = issue.narratedClusters.length ? issue.narratedClusters : issue.frameClusters;
  const narrated = issue.narratedClusters.length > 0;
  const basisFor = (cluster: IssueView["frameClusters"][number]) => {
    const members = issue.articles.filter((article) => cluster.articleIds.includes(article.articleId));
    const journalist = members.some((article) => Object.values(article.narratedFamilies).some(Boolean));
    const anyObserved = members.some((article) => Object.values(article.families).some(Boolean));
    return journalist ? "기자 서술 포함" : anyObserved ? "취재원 발언만 관측" : "관측 범위 미상";
  };
  const shortText = (value: string) => value.length > 76 ? `${value.slice(0, 75)}…` : value;
  const titleFor = (cluster: IssueView["frameClusters"][number]) => Object.entries(cluster.signature)
    .filter(([, family]) => family)
    .slice(0, 2)
    .map(([dimension, family]) => {
      const sample = dimensions
        .find((entry) => entry.dimension === dimension)
        ?.rows.find((row) => cluster.articleIds.includes(row.articleId) && row.validEvidence && isNarration(row.item.voice?.kind) && row.item.public_paraphrase)
        ?.item.public_paraphrase;
      return `${DIM_LABEL[dimension] ?? dimension}: ${sample ? shortText(sample) : familyLabel(family)}`;
    })
    .join(" · ") || "근거가 연결된 기사 묶음";
  const observedArticles = issue.articles.filter((article) => Object.values(article.families).some(Boolean)).length;
  return <section className="afs-card" id="sec-clusters"><h2>비슷한 방식으로 보도한 기사 묶음 <small>기사 단위 조합 관측 · Matthes &amp; Kohring 2008</small></h2><div className="afs-in"><p className="afs-note">{narrated ? "기자 서술로 확인된 문제·원인·책임·평가·해법의 조합만 묶었습니다." : observedArticles ? "기자 서술 군집이 없어 취재원 발언이 포함된 보조 관측을 별도로 표시합니다. 발언만으로 매체의 입장을 만들지 않습니다." : "기자 서술이나 취재원 발언의 공개 근거가 없어 군집을 만들지 않았습니다."}</p><div className="afp-clusters">{clusters.slice(0, 8).map((cluster, index) => <article key={cluster.key}><span className="afp-cluster-no">{String(index + 1).padStart(2, "0")}</span><div><h3>{titleFor(cluster)}</h3><p className="afp-cluster-meta">{cluster.articleIds.length}건 · {cluster.outlets.length}개 매체 · {basisFor(cluster)}</p><p><b>공통 관측:</b> {Object.entries(cluster.signature).filter(([, family]) => family).map(([dimension, family]) => `${DIM_LABEL[dimension] ?? dimension}: ${familyLabel(family)}`).join(" · ") || "공개 계열 미관측"}</p>{cluster.differsAt.length ? <small>대표 군집과 다른 관측 축: {cluster.differsAt.map((dimension) => DIM_LABEL[dimension] ?? dimension).join(", ")}</small> : null}{cluster.partialAt.length ? <small>한쪽만 확인된 축: {cluster.partialAt.map((dimension) => DIM_LABEL[dimension] ?? dimension).join(", ")} · 판단 차이로 해석하지 않음</small> : null}<details className="afp-cluster-articles"><summary>포함 기사 {cluster.articleIds.length}건</summary><ul>{cluster.articleIds.map((articleId) => { const article = issue.articles.find((candidate) => candidate.articleId === articleId); return <li key={articleId}><strong>{article?.outlet ?? "매체 미상"}</strong><span>{article?.title ?? "제목 미상"}</span><small className="afp-evidence-technical">article_id {articleId}</small></li>; })}</ul></details></div></article>)}{!clusters.length ? <p className="afp-state">군집을 구성할 semantic profile이 아직 충분하지 않습니다. 기사별 상태에서 분석 실패·근거 부족·취재원 발언만 있는 경우를 구분합니다.</p> : null}</div></div></section>;
}

function DescriptorSection({ bundle, issue, field, title, subtitle }: { bundle: IssueAnalysisBundle; issue: IssueView; field: "generic_frames" | "policy_frames"; title: string; subtitle: string }) {
  const articles = new Map(issue.articles.map((article) => [article.articleId, article]));
  const rows = bundle.semanticProfiles.filter((entry) => semanticEntryIsEligible(entry, bundle)).flatMap((entry) => {
    const descriptors = richProfile(entry)?.secondary_descriptors?.[field] ?? [];
    return descriptors.map((descriptor) => ({ ...descriptor, articleId: entry.articleId }));
  });
  const grouped = new Map<string, { label: string; articles: Set<string>; evidence: unknown[] }>();
  for (const row of rows) {
    const key = row.code ?? row.label ?? "unclassified";
    const current = grouped.get(key) ?? { label: codeLabel(row.code, row.label), articles: new Set<string>(), evidence: [] };
    current.articles.add(row.articleId);
    current.evidence.push(...(row.evidence ?? []));
    grouped.set(key, current);
  }
  return <section className="afs-card"><h2>{title} <small>{subtitle}</small></h2><div className="afs-in"><p className="afs-note">기사에서 명시적으로 구조화된 보조 분류만 표시합니다. 논조나 의도를 직접 판정하는 지표가 아닙니다.</p>{grouped.size ? <ul className="afp-descriptor-list">{[...grouped.values()].sort((a, b) => b.articles.size - a.articles.size).map((row) => <li key={row.label}><strong>{row.label}</strong><span>{[...row.articles].map((id) => articles.get(id)?.outlet ?? "매체 미상").filter((outlet, index, all) => all.indexOf(outlet) === index).join(" · ")} · {row.articles.size}건</span><EvidenceRefs refs={row.evidence} /></li>)}</ul> : <p className="afp-state">이 표본의 semantic profile에는 아직 {title} 코드가 구조화되지 않았습니다. 규칙 기반 결과를 AI 결과로 대체하지 않았습니다.</p>}</div></section>;
}

function ScopeSection({ bundle, issue, compact = false, id = "sec-scope" }: { bundle: IssueAnalysisBundle; issue: IssueView; compact?: boolean; id?: string }) {
  const articles = new Map(issue.articles.map((article) => [article.articleId, article]));
  const values = bundle.semanticProfiles
    .map((entry) => ({ entry, profile: richProfile(entry) }))
    .filter(({ entry, profile }) => Boolean(profile) && semanticEntryIsEligible(entry, bundle))
    .map(({ entry, profile }) => ({
      entry,
      article: articles.get(entry.articleId),
      scope: profile?.scope?.code,
      depth: profile?.context_depth?.level,
      scopeEvidence: profile?.scope?.evidence,
      depthEvidence: profile?.context_depth?.evidence,
      scopeCaution: profile?.scope?.caution,
      depthCaution: profile?.context_depth?.caution,
    }));
  const count = (key: "scope" | "depth") => {
    const map = new Map<string, number>();
    for (const value of values) {
      const item = value[key];
      if (item) map.set(item, (map.get(item) ?? 0) + 1);
    }
    return [...map].sort((a, b) => b[1] - a[1]);
  };
  const scope = count("scope");
  const depth = count("depth");
  const translateScope = (code?: string) => SCOPE_KIND_LABEL[code ?? ""] === "일화적"
    ? "사건 중심"
    : SCOPE_KIND_LABEL[code ?? ""] === "주제적"
      ? "구조·주제 중심"
      : SCOPE_KIND_LABEL[code ?? ""] ?? "시야 판정 미관측";
  const translateDepth = (code?: string) => DEPTH_LABEL[code ?? ""] ?? "맥락 깊이 미관측";
  return <section className={`afs-card${compact ? " afp-scope-compact" : ""}`} id={id}>
    <h2>{compact ? "사건 중심인가, 구조 문제인가" : "사건 하나로 봤나, 구조 문제로 봤나"} <small>보도 시야 · 맥락 깊이</small></h2>
    <div className="afs-in">
      <div className="afp-stat-grid">
        <div><span>시야</span><strong>{scope.map(([key, value]) => `${translateScope(key)} ${value}`).join(" · ") || "시야 판정 미관측"}</strong><p className="afs-note">사건 중심과 구조·주제 중심은 기사에서 실제로 연결한 설명 범위만 집계합니다.</p></div>
        <div><span>맥락 깊이</span><strong>{depth.map(([key, value]) => `${translateDepth(key)} ${value}`).join(" · ") || "맥락 깊이 미관측"}</strong><p className="afs-note">판정 근거는 원문 대신 공개 위치·해시로 확인합니다.</p></div>
      </div>
      {compact ? <p className="afs-note">이 분류는 프레임의 옳고 그름이 아니라 사건을 구조적 맥락과 연결한 범위입니다.</p> : <div className="afp-scope-articles">{values.map((value) => <details key={value.entry.articleId}>
        <summary>{value.article ? `${value.article.outlet} · ${value.article.title}` : "기사 정보 미상"} · {translateScope(value.scope)} · {translateDepth(value.depth)}</summary>
        <div className="afp-evidence-body">
          <small className="afp-evidence-technical">article_id {value.entry.articleId}</small>
          <EvidenceRefs refs={value.scopeEvidence} label="시야 판단 근거" />
          <EvidenceRefs refs={value.depthEvidence} label="맥락 깊이 근거" />
          {value.scopeCaution || value.depthCaution ? <p className="afs-note">{value.scopeCaution ?? value.depthCaution}</p> : null}
        </div>
      </details>)}</div>}
    </div>
  </section>;
}

function ParaphraseObservationEvidence({ observations, label }: { observations: ParaphraseObservationRef[]; label: string }) {
  if (!observations.length) return null;
  return <details className="afp-evidence afp-evidence-compact">
    <summary>{label} {observations.length}건</summary>
    <div className="afp-evidence-body">
      {observations.map((observation) => <small key={observation.observationId}>
        article_id {observation.articleId} · claim_id {observation.claimId} · {observation.dimension} · 문단 {observation.evidence.locator.paragraph}, 문장 {observation.evidence.locator.sentence} · sha256 {observation.evidence.sentence_sha256} · prompt {observation.promptVersion}/schema {observation.schemaVersion}
      </small>)}
    </div>
  </details>;
}

function SourceNetwork({ analysis }: { analysis: ParaphraseLinguisticAnalysis }) {
  const { nodes, edges } = analysis.network;
  const labels = new Map(nodes.map((node) => [node.id, node.label]));
  const renderEdge = (edge: ParaphraseLinguisticAnalysis["network"]["edges"][number]) => <li key={`${edge.source}-${edge.target}`}>
    {labels.get(edge.source) ?? "노드 미상"} <span>↔</span> {labels.get(edge.target) ?? "노드 미상"}
    <small> · 같은 공개 paraphrase {edge.weight}건</small>
    <ParaphraseObservationEvidence observations={edge.observations} label="동시 등장 근거" />
  </li>;
  const remainingNodes = nodes.slice(30);
  const remainingEdges = edges.slice(60);
  return <section className="afs-card" id="sec-network"><h2>공개 paraphrase 동시 등장 연결망 <small>같은 문장 요약 안의 단어 관측</small></h2><div className="afs-in">
    <p className="afs-note">노드는 저장된 AI 공개 paraphrase에서 형태소 분석기로 찾은 내용어입니다. 연결선은 같은 paraphrase 하나 안에서 함께 나온 경우만 뜻합니다. 기사 원문 단어의 동시 출현, 인과관계, 매체 의도나 논조를 나타내지 않습니다. 취재원 발화 paraphrase는 제외합니다.</p>
    <p className="afp-summary-meta">기사 {analysis.analyzedArticleCount}/{analysis.issueArticleCount}건 · paraphrase {analysis.validParaphraseCount}개 · 노드 {nodes.length}개 · 연결 {edges.length}개 · 분석기 {analysis.analyzer.version} · 사전 {analysis.analyzer.dictionaryVersion}</p>
    {nodes.length && edges.length ? <div className="afp-network">
      <div className="afp-network-nodes">{nodes.slice(0, 30).map((node) => <div className="afp-network-node" key={node.id}><strong>{node.label}</strong><span>{node.count}개 요약 · {node.articleCount}개 기사</span></div>)}
        {remainingNodes.length ? <details><summary>추가 노드 {remainingNodes.length}개</summary>{remainingNodes.map((node) => <div className="afp-network-node" key={node.id}><strong>{node.label}</strong><span>{node.count}개 요약 · {node.articleCount}개 기사</span></div>)}</details> : null}
      </div>
      <ul className="afp-network-edges">{edges.slice(0, 60).map(renderEdge)}</ul>
      {remainingEdges.length ? <details className="afp-technical-disclosure"><summary>추가 연결 {remainingEdges.length}개</summary><ul className="afp-network-edges">{remainingEdges.map(renderEdge)}</ul></details> : null}
    </div> : <div className="afp-unavailable"><strong>{nodes.length ? "동시 등장 연결 없음" : "근거가 연결된 내용어 없음"}</strong><p>검증된 기자 서술 paraphrase 안에서 함께 관측된 단어 쌍이 없어 연결선을 만들지 않았습니다.</p></div>}
  </div></section>;
}

type MorphologyRow = {
  articleId: string;
  label: string;
  count?: number;
  perThousand?: number;
  pos?: string;
  evidence: SemanticDimensionItem["evidence"];
};

function parseEvidenceLocator(value: unknown) {
  if (value && typeof value === "object") {
    const locator = value as { paragraph?: unknown; sentence?: unknown };
    if (typeof locator.paragraph === "number" || typeof locator.sentence === "number") {
      return {
        paragraph: typeof locator.paragraph === "number" ? locator.paragraph : undefined,
        sentence: typeof locator.sentence === "number" ? locator.sentence : undefined,
      };
    }
  }
  if (typeof value !== "string") return null;
  const match = value.match(/(\d+)\s*문단(?:\s*[·,/]?\s*)(\d+)\s*문장/u);
  return match ? { paragraph: Number(match[1]), sentence: Number(match[2]) } : null;
}

function normalizeModuleEvidence(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const ref = value as AnalysisModuleEvidence;
  const articleId = typeof ref.articleId === "string" ? ref.articleId : typeof ref.article_id === "string" ? ref.article_id : "";
  const locator = parseEvidenceLocator(ref.locator ?? ref.evidenceLocator);
  const hash = typeof ref.sentence_sha256 === "string"
    ? ref.sentence_sha256
    : typeof ref.evidenceHash === "string"
      ? ref.evidenceHash
      : null;
  if (!articleId || !locator || !hash) return null;
  return { articleId, evidence: { locator, sentence_sha256: hash } };
}

function moduleEvidenceForBundle(bundle: IssueAnalysisBundle, value: unknown) {
  const normalized = normalizeModuleEvidence(value);
  if (!normalized) return null;
  const entry = bundle.semanticProfiles.find((candidate) => candidate.articleId === normalized.articleId);
  return entry && hasValidEvidence(normalized.evidence, entry.evidence) ? normalized : null;
}

function morphologyModule(bundle: IssueAnalysisBundle): MorphologyAnalysisModule | null {
  const data = bundle.comparison.data as Record<string, unknown>;
  const raw = data.analysisModules && typeof data.analysisModules === "object"
    ? (data.analysisModules as Record<string, unknown>).morphology
    : data.analysis_modules && typeof data.analysis_modules === "object"
      ? (data.analysis_modules as Record<string, unknown>).morphology
      : null;
  return raw && typeof raw === "object" ? raw as MorphologyAnalysisModule : null;
}

function profileMorphologyRows(bundle: IssueAnalysisBundle): MorphologyRow[] {
  return bundle.semanticProfiles.filter((entry) => semanticEntryIsEligible(entry, bundle)).flatMap((entry) => {
    const raw = (richProfile(entry) as (RichProfile & { morphology?: unknown }) | null)?.morphology;
    if (!raw || typeof raw !== "object") return [];
    const value = raw as { items?: unknown; term_frequencies?: unknown; term_evidence?: unknown };
    const items = Array.isArray(value.term_frequencies) ? value.term_frequencies : Array.isArray(value.items) ? value.items : [];
    const evidenceRows = Array.isArray(value.term_evidence) ? value.term_evidence : [];
    return items.flatMap((item): MorphologyRow[] => {
      if (!item || typeof item !== "object") return [];
      const term = item as { code?: unknown; label?: unknown; term?: unknown; pos?: unknown; count?: unknown; per_thousand?: unknown; perThousand?: unknown };
      const rawLabel = typeof term.label === "string" ? term.label : typeof term.term === "string" ? term.term : typeof term.code === "string" ? term.code : "";
      if (!rawLabel) return [];
      const evidenceRow = evidenceRows.find((candidate) => candidate && typeof candidate === "object" && (candidate as { term?: unknown }).term === term.term && ((candidate as { pos?: unknown }).pos === undefined || (candidate as { pos?: unknown }).pos === term.pos));
      const evidence = moduleEvidenceForBundle(bundle, evidenceRow && typeof evidenceRow === "object" ? (evidenceRow as { evidence?: unknown }).evidence : null);
      if (!evidence) return [];
      return [{
        articleId: entry.articleId,
        label: codeLabel(typeof term.code === "string" ? term.code : null, rawLabel),
        count: typeof term.count === "number" && term.count > 0 ? term.count : undefined,
        perThousand: typeof term.perThousand === "number" ? term.perThousand : typeof term.per_thousand === "number" ? term.per_thousand : undefined,
        pos: typeof term.pos === "string" ? term.pos : undefined,
        evidence: evidence.evidence,
      }];
    });
  });
}

function moduleMorphologyRows(bundle: IssueAnalysisBundle): MorphologyRow[] {
  const morphology = morphologyModule(bundle);
  if (!morphology) return [];
  const outlets = Array.isArray(morphology.byOutlet) ? morphology.byOutlet : Array.isArray(morphology.by_outlet) ? morphology.by_outlet : [];
  return outlets.flatMap((outlet) => {
    if (!outlet || typeof outlet !== "object") return [];
    const rawOutlet = outlet as Record<string, unknown>;
    const terms = Array.isArray(rawOutlet.terms) ? rawOutlet.terms : [];
    return terms.flatMap((term): MorphologyRow[] => {
      if (!term || typeof term !== "object") return [];
      const value = term as Record<string, unknown>;
      const label = typeof value.term === "string" ? value.term : "";
      if (!label) return [];
      const refs = Array.isArray(value.evidenceRefs) ? value.evidenceRefs : Array.isArray(value.evidence) ? value.evidence : [];
      return refs.flatMap((ref): MorphologyRow[] => {
        const evidence = moduleEvidenceForBundle(bundle, ref);
        if (!evidence) return [];
        return [{
          articleId: evidence.articleId,
          label,
          count: typeof value.count === "number" && value.count > 0 ? value.count : undefined,
          perThousand: typeof value.perThousand === "number" ? value.perThousand : typeof value.per_thousand === "number" ? value.per_thousand : undefined,
          pos: typeof value.pos === "string" ? value.pos : undefined,
          evidence: evidence.evidence,
        }];
      });
    });
  });
}

function morphologyRows(bundle: IssueAnalysisBundle): MorphologyRow[] {
  const rows = [...profileMorphologyRows(bundle), ...moduleMorphologyRows(bundle)];
  return [...new Map(rows.map((row) => [
    `${row.articleId}|${row.label}|${row.evidence?.locator?.paragraph ?? ""}|${row.evidence?.locator?.sentence ?? ""}|${row.evidence?.sentence_sha256 ?? ""}`,
    row,
  ])).values()];
}

function MorphologySection({ bundle, issue, analysis }: { bundle: IssueAnalysisBundle; issue: IssueView; analysis: ParaphraseLinguisticAnalysis }) {
  const rows = morphologyRows(bundle);
  const morphology = morphologyModule(bundle);
  const analyzer = morphology?.analyzer;
  const articles = new Map(issue.articles.map((article) => [article.articleId, article]));
  const analyzerNote = analyzer?.version ? `분석기 ${analyzer.version}${analyzer.dictionaryVersion || analyzer.dictionary_version ? ` · 사전 ${analyzer.dictionaryVersion ?? analyzer.dictionary_version}` : ""}` : null;
  const posLabels: Record<string, string> = { noun: "명사", predicate: "서술어", foreign: "외래어" };
  const issueStatusLabels: Record<string, string> = { queued: "대기", running: "진행 중", retry_wait: "재시도 대기", succeeded: "분석 실행 완료", review_needed: "검토 필요", dead_letter: "실패" };
  return <section className="afs-card" id="sec-morphology"><h2>형태소·반복 표현 <small>입력 출처를 나눈 언어 관측</small></h2><div className="afs-in">
    <p className="afs-note">단어 형태나 반복 표현은 어떤 문장이 눈에 띄는지 보여 줄 뿐, 그 자체로 프레임·논조·의도를 판정하지 않습니다. 아래 공개 paraphrase 집계는 기사 원문 단어 빈도가 아니며, 매체 간 차이나 기자의 의도를 확정하지 않습니다.</p>
    {analysis.terms.length ? <div>
      <h3>저장된 AI 공개 paraphrase 재분석</h3>
      <p className="afp-summary-meta">입력: 원문이 아닌 저장된 공개 paraphrase · 분석기 {analysis.analyzer.version} · 사전 {analysis.analyzer.dictionaryVersion} · 기사 {analysis.analyzedArticleCount}/{analysis.issueArticleCount}건 · 요약문 {analysis.validParaphraseCount}개</p>
      <p className="afp-state">{analysis.analyzer.limitation} paraphrase마다 상위 {analysis.analyzer.maxTermsPerParaphrase}개 내용어까지만 집계합니다.</p>
      <p className="afp-state">의제 전체 AI 의미 분석은 현재 <strong>{issueStatusLabels[analysis.issueSemanticStatus] ?? "상태 미상"}</strong>입니다. 아래는 성공한 기사 프로필 중 문장 근거가 확인된 부분 관측이며, 의제 전체 비교나 매체 결론이 아닙니다. 기자 서술만 포함하고 취재원 귀속 발화 {analysis.excludedSourceObservationCount}건은 제외했습니다. 입력은 자동 생성된 미검토 AI 초안입니다. 포함 프로필 {analysis.reviewRequiredProfileCount}개는 사람 검토 대상으로 표시되어 있고, 나머지 기사는 관측 범위에 포함되지 않습니다.</p>
      <p className="afp-summary-meta">{analysis.analysisRuns.map((run) => `${run.model ?? "모델 미상"} · prompt ${run.promptVersion} · schema ${run.schemaVersion}`).join(" / ")}</p>
      <div className="afp-morphology-list">{analysis.terms.map((term) => <div key={term.id}>
        <strong>{term.term}</strong>
        <span>{posLabels[term.pos] ?? term.pos} · paraphrase 안 {term.count}회 · {term.paraphraseCount}개 요약문 · {term.articleCount}개 기사</span>
        <ParaphraseObservationEvidence observations={term.observations} label="용례·claim 근거" />
      </div>)}</div>
    </div> : <div className="afp-unavailable"><strong>검증 가능한 공개 paraphrase 형태소 결과 없음</strong><p>기자 서술·성공 프로필·분석 버전·article/locator/hash 연결을 모두 확인한 입력만 사용합니다. 검증된 입력이 없어 형태소 집계를 만들지 않았습니다.</p></div>}
    {rows.length ? <div>
      <h3>저장된 별도 형태소 모듈</h3>
      {analyzerNote ? <p className="afp-summary-meta">{analyzerNote} · 기사 근거와 locator가 검증된 항목만 표시</p> : null}
      <div className="afp-morphology-list">{rows.map((row, index) => <div key={`${row.articleId}-${row.label}-${index}`}><strong>{row.label}</strong><span>{articles.get(row.articleId)?.outlet ?? "매체 미상"} · {articles.get(row.articleId)?.title ?? "제목 미상"}{row.pos ? ` · ${row.pos}` : ""}{row.count ? ` · ${row.count}회` : ""}{row.perThousand ? ` · 1,000개당 ${row.perThousand.toFixed(1)}회` : ""}</span><EvidenceRefs refs={[{ article_id: row.articleId, locator: row.evidence?.locator, sentence_sha256: row.evidence?.sentence_sha256 }]} label="형태소 근거" /><details className="afp-technical-disclosure"><summary>기술 식별자</summary><div className="afp-evidence-body"><small>article_id {row.articleId}</small></div></details></div>)}</div>
    </div> : <p className="afp-state">이 snapshot에는 paraphrase와 분리된 기사 본문 형태소 모듈이 없습니다. 위 계산을 기사 원문 단어 분석으로 해석하지 마세요.</p>}
  </div></section>;
}

function DevicesSection({ bundle, issue }: { bundle: IssueAnalysisBundle; issue: IssueView }) {
  const articles = new Map(issue.articles.map((article) => [article.articleId, article]));
  const devices = bundle.semanticProfiles.filter((entry) => semanticEntryIsEligible(entry, bundle)).flatMap((entry) => (richProfile(entry)?.framing_devices ?? []).map((device) => ({ ...device, articleId: entry.articleId })));
  return <section className="afs-card"><h2>기사에서 눈에 띄는 표현·근거 장치 <small>강조·수치·인과 연결</small></h2><div className="afs-in"><p className="afs-note">이 항목은 기사 표현의 구조를 보여 주며 프레임의 방향이나 기자의 의도를 판정하지 않습니다.</p>{devices.length ? <div className="afp-device-list">{devices.map((device, index) => { const article = articles.get(device.articleId); const count = typeof device.count === "number" && device.count > 0 ? `${device.count}건` : "건수 미상"; return <div key={`${device.code ?? device.label}-${device.articleId}-${index}`}><strong>{codeLabel(device.code, device.label)}</strong><span>{article?.outlet ?? "매체 미상"} · {article?.title ?? "제목 미상"} · {count}{device.appears_in_lead ? " · 제목/리드에 관측" : ""}</span><details className="afp-technical-disclosure"><summary>기술 식별자</summary><div className="afp-evidence-body"><small>article_id {device.articleId}</small></div></details><EvidenceRefs refs={device.evidence} label="장치 근거" /></div>; })}</div> : <p className="afp-state">현재 semantic profile에는 별도의 표현·근거 장치 코드가 구조화되지 않았습니다. 본문에 없다고 단정하지 않고 이 분류만 보류합니다.</p>}</div></section>;
}

function FramingRail() {
  return (
    <nav className="afs-rail" aria-label="프레이밍 분석 주요 층위 바로가기">
      <a className="afs-rail-item" href="#sec-synthesis">
        <b>공통·차이 요약</b>
        <small>확인된 설명 · 비교 보류</small>
      </a>
      <a className="afs-rail-item" href="#sec-four-functions">
        <b>프레임 4기능</b>
        <small>Entman 1993</small>
      </a>
      <a className="afs-rail-item" href="#sec-matrix">
        <b>전체 프레임 행렬</b>
        <small>5개 기능 · 취재원</small>
      </a>
      <a className="afs-rail-item" href="#sec-clusters">
        <b>보도 군집</b>
        <small>Matthes &amp; Kohring</small>
      </a>
      <a className="afs-rail-item" href="#sec-descriptors">
        <b>정책·보편 프레임</b>
        <small>Boydstun · Semetko</small>
      </a>
      <a className="afs-rail-item" href="#sec-sources">
        <b>취재원 구성</b>
        <small>역할 · 전달 방식</small>
      </a>
      <a className="afs-rail-item" href="#sec-scope">
        <b>보도 시야</b>
        <small>사건 중심 · 구조 중심</small>
      </a>
      <a className="afs-rail-item" href="#sec-network">
        <b>의미 연결망</b>
        <small>실제 노드·연결선만</small>
      </a>
      <a className="afs-rail-item" href="#sec-morphology">
        <b>표현·형태소</b>
        <small>프레임 판정과 별도</small>
      </a>
      <a className="afs-rail-item" href="#sec-evidence">
        <b>기사별 판정 근거</b>
        <small>Locator · Hash</small>
      </a>
    </nav>
  );
}

function MethodologyDisclaimer() {
  return (
    <details className="afs-card afs-fold" id="sec-methodology">
      <summary>이 분석 보고서를 읽는 원칙과 해석 한계 (학술적 방법론 안내)</summary>
      <div className="afs-in afs-prose" style={{ marginTop: "12px", fontSize: "13px", lineHeight: "1.7" }}>
        <p>
          <strong>포함한 비교 기준:</strong> 동일한 사건을 다룬 여러 기사를 사건 단위로 묶고, Entman(1993)의 4대 기능(문제 정의·원인 귀속·도덕적/정치적 평가·해법 제시)과 취재원 가시성(Gans 1979), 보도 시야(Iyengar 1991), 정책 프레임(Boydstun et al. 2014) 틀을 적용하여 관측 가능한 차이를 대조합니다.
        </p>
        <p>
          <strong>엄격한 근거 보존 원칙:</strong> 저작권 보호 및 허위 추론 방지를 위해 기사 원문 본문/HTML은 비공개 저장소에만 보관하며, 공개 화면에는 문장 위치(<code>locator</code>)와 64자리 SHA-256 지문(<code>sentence_sha256</code>)이 검증된 문장만 안전한 의역(paraphrase)으로 표시합니다.
        </p>
        <p>
          <strong>해석의 한계:</strong> 관측되지 않은 차원은 ‘기사에 명시되지 않음’ 또는 ‘공개 근거 부족’으로 처리하며, 매체의 고정 성향이나 의도적 왜곡으로 단정하지 않습니다. 취재원의 발언은 해당 발화 주체에게만 귀속되며 언론사 자체 주장으로 환원하지 않습니다.
        </p>
      </div>
    </details>
  );
}

function PendingAnalysisShell({ bundle, issue, mode }: { bundle: IssueAnalysisBundle; issue: IssueView; mode: AnalysisMode }) {
  return (
    <>
      <AnalysisPageHeader mode={mode} issue={issue} dimensions={[]} />
      <section className="afs-card afs-card-lead">
        <h2>{issue.title}</h2>
        <div className="afs-in afs-prose">
          <p>
            기사 {issue.articleCount}건 · 매체 {issue.outletCount}곳
            {typeof (bundle.issue as { agendaScore?: number }).agendaScore === "number"
              ? ` · 점수 ${(bundle.issue as { agendaScore?: number }).agendaScore!.toFixed(1)}`
              : ""}
          </p>
        </div>
      </section>
      <SynthesisNarrative bundle={bundle} />
      <section className="afs-card">
        <h2>이 의제에 묶인 기사</h2>
        <div className="afs-in">
          <ul>
            {issue.articles.map((article) => (
              <li key={article.articleId}>
                {article.outlet} · {article.title}
                {article.url ? (
                  <>
                    {" "}
                    <a href={article.url} target="_blank" rel="noreferrer">원문 ↗</a>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      </section>
    </>
  );
}

function isPendingLiveAnalysis(bundle: IssueAnalysisBundle) {
  return bundle.basisDate === "2026-08-15" && (bundle.semanticProfiles?.length ?? 0) === 0;
}

export function OutletsSemanticPage({ bundle, issue }: { bundle: IssueAnalysisBundle; issue: IssueView }) {
  if (isPendingLiveAnalysis(bundle)) return <PendingAnalysisShell mode="outlets" bundle={bundle} issue={issue} />;
  const dimensions = analyses(bundle, issue);
  return (
    <>
      <AnalysisPageHeader mode="outlets" issue={issue} dimensions={dimensions} />
      <ComparisonLeadV2 bundle={bundle} issue={issue} synthesis={synthesisData(bundle)} />
      <FineComparisonSection bundle={bundle} />
      <ArticleExplanations bundle={bundle} />
      <section className="afs-card" id="sec-evidence">
        <h2>
          기사 근거 <small>갈래를 만든 기사와 공개 locator</small>
        </h2>
        <div className="afs-in">
          <ArticleList bundle={bundle} issue={issue} dimensions={dimensions} />
        </div>
      </section>
      <details open className="afs-card afs-fold afp-detail-analysis" id="sec-detail-analysis">
        <summary>세부 프레임 분석 보기</summary>
        <div className="afp-detail-analysis-body">
          <div id="sec-axis-details">
            <AxisSection dimensions={dimensions} />
          </div>
          <DebateSection issue={issue} dimensions={dimensions} />
          <ComparisonAxisEvidence bundle={bundle} issue={issue} />
          <section className="afs-card" id="sec-matrix">
            <h2>
              언론사별 프레임 비교 <small>기사 단위 semantic AI</small>
            </h2>
            <div className="afs-in">
              <FrameMatrix issue={issue} dimensions={dimensions} />
            </div>
          </section>
          <section className="afs-card" id="sec-sources">
            <h2>
              누구의 말을 중심에 뒀나 <small>Gans · source selection</small>
            </h2>
            <div className="afs-in">
              <SourceTable issue={issue} />
            </div>
          </section>
          <section className="afs-card">
            <h2>
              어떤 말로 설명했나 <small>발화 방식과 표현 선택</small>
            </h2>
            <div className="afs-in">
              <VoiceTable issue={issue} />
            </div>
          </section>
        </div>
      </details>
      <MethodologyDisclaimer />
    </>
  );
}

export function FramingSemanticPage({ bundle, issue }: { bundle: IssueAnalysisBundle; issue: IssueView }) {
  if (isPendingLiveAnalysis(bundle)) return <PendingAnalysisShell mode="framing" bundle={bundle} issue={issue} />;
  const dimensions = analyses(bundle, issue);
  const linguisticAnalysis = buildParaphraseLinguisticAnalysis(bundle);
  return (
    <>
      <AnalysisPageHeader mode="framing" issue={issue} dimensions={dimensions} />
      <div className="afp-framing-lead-grid" id="sec-synthesis">
        <Summary bundle={bundle} issue={issue} analyses={dimensions} compact />
        <ScopeSection bundle={bundle} issue={issue} compact id="sec-scope-summary" />
      </div>
      <div id="sec-four-functions">
        <FourFunctionTable issue={issue} dimensions={dimensions} />
      </div>
      <FineComparisonSection bundle={bundle} />
      <ArticleExplanations bundle={bundle} />
      <div id="sec-guide">
        <DimensionGuide dimensions={dimensions} />
      </div>
      <FramingRail />
      <section className="afs-card" id="sec-matrix">
        <h2>
          매체별 전체 프레임 행렬 <small>5개 기능·취재원 구조</small>
        </h2>
        <div className="afs-in">
          <FrameMatrix issue={issue} dimensions={dimensions} />
        </div>
      </section>
      <ClusterSection issue={issue} dimensions={dimensions} />
      <ComparisonAxisEvidence bundle={bundle} issue={issue} />
      <StructuredObservationSection bundle={bundle} issue={issue} />
      <div id="sec-descriptors">
        <DescriptorSection bundle={bundle} issue={issue} field="policy_frames" title="정책 프레임" subtitle="Boydstun et al. 2014" />
        <DescriptorSection bundle={bundle} issue={issue} field="generic_frames" title="보편 프레임 다섯 종" subtitle="Semetko &amp; Valkenburg 2000" />
      </div>
      <ScopeSection bundle={bundle} issue={issue} />
      <section className="afs-card" id="sec-sources">
        <h2>
          누구의 말을 중심에 뒀나 <small>취재원 구조</small>
        </h2>
        <div className="afs-in">
          <SourceTable issue={issue} />
        </div>
      </section>
      <SourceRoleEvidence bundle={bundle} issue={issue} />
      <SourceNetwork analysis={linguisticAnalysis} />
      <MorphologySection bundle={bundle} issue={issue} analysis={linguisticAnalysis} />
      <DevicesSection bundle={bundle} issue={issue} />
      <section className="afs-card" id="sec-evidence">
        <h2>
          기사별 판정 근거 <small>evidence locator · hash</small>
        </h2>
        <div className="afs-in">
          <ArticleList bundle={bundle} issue={issue} dimensions={dimensions} />
        </div>
      </section>
      <MethodologyDisclaimer />
    </>
  );
}

export function AnalysisPageIntro({ title, description, children }: { title: string; description: string; children?: ReactNode }) {
  return <header className="afs-head afp-head"><span className="afs-eyebrow">AI EVIDENCE VIEW</span><h1>{title}</h1><p>{description}</p>{children}</header>;
}

type AnalysisMode = "outlets" | "framing";

function AnalysisPageHeader({
  mode,
  issue,
  dimensions,
}: {
  mode: AnalysisMode;
  issue: IssueView;
  dimensions: DimensionAnalysis[];
}) {
  const framing = mode === "framing";
  const observedDimensions = dimensions.filter((dimension) => dimension.observedArticles > 0).length;
  const kpis = framing
    ? [
        ["매체", String(issue.outletCount), "곳"],
        ["기사", String(issue.articleCount), "건"],
        ["관측 축", `${observedDimensions}/5`, "축"],
        ["공개 근거", String(issue.evidenceTotal), "지문"],
      ]
    : [];

  return (
    <>
      <header className="afs-head afp-page-head">
        <div className="afp-page-heading">
          <div className="afp-page-title-line">
            <h1>{framing ? "프레이밍 분석" : "언론사 비교"}</h1>
            <span className="afp-page-badge">{framing ? "핵심 6축 + 보조 3층위" : "기사별 근거 연결"}</span>
          </div>
          <p>
            {framing
              ? "문제·원인·책임·평가·해법·취재원 배치를 먼저 보고, 시야·표현 장치는 보조 관측으로 확인합니다."
              : "사건 경위 → 실제 비교 질문 → 대표 기사 묶음 → 기사 근거 순서로 비교합니다."}
          </p>
        </div>
        <Link className="afs-pill afs-pill-go afp-page-action" href={`/issues/${encodeURIComponent(issue.issueId)}/report`}>
          리포트로 보기
        </Link>
      </header>
      {framing ? (
        <section className="afp-kpis" aria-label="프레이밍 분석 요약 지표">
          {kpis.map(([label, value, unit]) => (
            <div className="afp-kpi" key={label}>
              <span>{label}</span>
              <strong>{value}<small>{unit}</small></strong>
            </div>
          ))}
        </section>
      ) : null}
    </>
  );
}
