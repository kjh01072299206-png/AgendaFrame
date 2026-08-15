import type { ReactNode } from "react";
import {
  DIM_LABEL,
  DIM_ORDER,
  DIM_QUESTION,
  VOICE_LABEL,
  familyLabel,
  type IssueView,
  type LayerItem,
} from "../../lib/initial-five/derive";
import type {
  EventSynthesisData,
  IssueAnalysisBundle,
  RuleComparisonAxis,
  SemanticDimensionItem,
  SemanticProfileEntry,
} from "../../lib/initial-five/types";

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
  observedArticles: number;
  narratedArticles: number;
  attributedArticles: number;
  stateCounts: Record<string, number>;
};

const STATUS_COPY: Record<string, string> = {
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
) {
  if (!evidence?.locator) return false;
  const hasLocator = typeof evidence.locator.paragraph === "number" || typeof evidence.locator.sentence === "number";
  const hash = "sentence_sha256" in evidence
    ? evidence.sentence_sha256
    : "hash" in evidence
      ? evidence.hash
      : null;
  return hasLocator && typeof hash === "string" && /^[a-f0-9]{64}$/i.test(hash.trim());
}

function evidenceRefs(value: unknown): PublicEvidenceRef[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is PublicEvidenceRef => Boolean(entry && typeof entry === "object"));
}

function synthesisData(bundle: IssueAnalysisBundle): EventSynthesisData | null {
  const value = bundle.comparison.data.synthesis;
  return value && typeof value === "object" ? value : null;
}

function observedClaim(claim?: { text?: string | null; status?: string } | null): string | null {
  return claim?.status === "observed" && typeof claim.text === "string" && claim.text.trim() ? claim.text : null;
}

function comparisonAxes(bundle: IssueAnalysisBundle): RuleComparisonAxis[] {
  return Array.isArray(bundle.comparison.data.comparison_axes)
    ? bundle.comparison.data.comparison_axes
    : [];
}

function validComparisonEvidence(pattern: NonNullable<RuleComparisonAxis["patterns"]>[number]) {
  return evidenceRefs(pattern.evidence).filter((ref) =>
    hasValidEvidence({ locator: ref.locator, hash: ref.sentence_sha256 ?? ref.hash }),
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
    const reviewStatus = profile?.review?.status ?? null;
    const reviewRequired = Boolean(profile?.review?.requires_human_review ?? entry?.engine.reviewRequired);
    const itemRows = uniqueItems(node.items ?? []);
    const items = itemRows.length ? itemRows : [{ } as SemanticDimensionItem];
    for (const item of items) {
      const stateOnly = itemRows.length === 0;
      rows.push({
        articleId: article.articleId,
        outlet: view?.outlet ?? article.outlet ?? "매체 미상",
        title: view?.title ?? article.title ?? "제목 미상",
        url: view?.url ?? article.canonicalUrl,
        item,
        status: node.status ?? "not_observed",
        modelStatus,
        reviewStatus,
        reviewRequired,
        stateReason: stateReason(modelStatus, node.status ?? "not_observed", nodeRecord.abstention_reason),
        stateOnly,
        validEvidence: !stateOnly && hasValidEvidence(item.evidence),
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
  const grouped = new Map<string, Row[]>();
  for (const row of rows.filter((candidate) => !candidate.stateOnly && candidate.validEvidence && candidate.item.frame_family)) {
    const family = row.item.frame_family ?? "unclassified";
    const group = grouped.get(family) ?? [];
    group.push(row);
    grouped.set(family, group);
  }
  const groups = [...grouped.entries()]
    .map(([family, groupRows]) => {
      const articleIds = [...new Set(groupRows.map((row) => row.articleId))];
      return {
        family,
        label: family === "unclassified" ? "분류 코드 미확정" : familyLabel(family),
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
    .sort((a, b) => b.articleIds.length - a.articleIds.length || a.label.localeCompare(b.label));
  return {
    dimension,
    label: DIM_LABEL[dimension] ?? dimension,
    question: DIM_QUESTION[dimension] ?? dimension,
    rows,
    groups,
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
  const reviewStatuses = [...new Set(profiles.map((entry) => richProfile(entry)?.review?.status).filter(Boolean))];
  const reviewRequired = semantic.requiresHumanReview || profiles.some((entry) => Boolean(richProfile(entry)?.review?.requires_human_review));
  const synthesis = synthesisData(bundle);
  const isVertexDirect = Boolean(
    semantic.semanticAi
    && comparison.semanticAi
    && synthesis?.usable === true
    && /gcp:event-synthesis|gcp:vertex/i.test(String(comparison.source ?? synthesis.source ?? "")),
  );
  const comparisonLabel = comparison.semanticAi ? "semantic AI 비교" : "규칙·구조화 비교 (rules_local)";
  const artifactSource = bundle.lineage?.source?.semanticDirectory || "공개 산출물 출처 미상";
  return (
    <p className="afp-method-note">
      <span className={`afs-chip ${isVertexDirect ? "afs-chip-brand" : "afs-badge-ex"}`}>
        {isVertexDirect ? "Vertex AI 실호출 직접 생성" : "프로필 합성기 fallback (profile-backed)"}
      </span>{" "}
      <span className="afs-chip">{comparisonLabel}</span>
      <br />
      <strong>AI 출처:</strong> {semantic.model ?? clusterAi?.model ?? "모델 미상"} · prompt {semantic.promptVersion ?? clusterAi?.promptVersion ?? "v1.0.0"} · schema {semantic.schemaVersion ?? "v2"} · snapshot {bundle.lineage.issueId ?? "미상"} · 산출물 {artifactSource}.
      <br />
      <strong>상태:</strong> {reviewRequired ? "사람 검토 전 자동 분석 초안 (requires_human_review)" : "사람 검토 완료"}. {reviewStatuses.length ? `(profile review: ${reviewStatuses.join(", ")})` : ""}
      <br />
      <strong>보호 원칙:</strong> 공개 화면에는 paraphrase·근거 위치(locator)·SHA-256 해시 지문만 표시하며, 원문 본문·HTML·원문 문장 자체는 노출하지 않습니다.
    </p>
  );
}

function Summary({ bundle, issue, analyses: dimensions }: { bundle: IssueAnalysisBundle; issue: IssueView; analyses: DimensionAnalysis[] }) {
  const observed = dimensions.filter((dimension) => dimension.groups.length > 0);
  const split = observed.filter((dimension) => dimension.groups.length >= 2);
  const directSplit = split.filter((dimension) => dimension.groups.filter((group) => group.narratedArticles > 0).length >= 2);
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
  const common = observed.filter((dimension) => dimension.groups.length === 1).slice(0, 2);
  const derivedCommonText = common.length
    ? common.map((dimension) => `${dimension.label}은 ${dimension.groups[0].label} 계열로 모였습니다`).join(", ")
    : "공통으로 묶이는 단일 계열은 확인되지 않았습니다.";
  const derivedDifferenceText = directSplit.length
    ? `${directSplit.map((dimension) => dimension.label).join(", ")}에서 매체 서술 계열이 갈렸습니다.`
    : split.length
      ? `${split.map((dimension) => dimension.label).join(", ")}에서 차이가 관측됐지만, 대부분 취재원 발언에 귀속되어 매체 자체의 논조 차이로 확정하지 않았습니다.`
      : "현재 semantic profile에서 매체 자체 서술이 갈린 축은 확정되지 않았습니다.";
  const synthesis = synthesisData(bundle);
  const synthesisCommon = observedClaim(synthesis?.agreed_line) ?? observedClaim(synthesis?.what_happened);
  const synthesisDifference = observedClaim(synthesis?.split_line);
  const synthesisSoWhat = observedClaim(synthesis?.so_what);
  const commonText = synthesisCommon ?? (issue.commonGround ?? derivedCommonText);
  const differenceText = synthesis
    ? synthesisDifference ?? "서로 다른 근거 그룹이 확인되지 않아 대립 구도로 표시하지 않습니다."
    : (issue.mainDifference ?? derivedDifferenceText);
  const readerPath = synthesisSoWhat ?? (directSplit.length
    ? `독자는 ${directSplit[0].groups.map((group) => group.label).join(" 또는 ")} 중 서로 다른 설명 경로를 만납니다.`
    : "독자가 보는 차이는 우선 어떤 취재원 발언을 선택·배치했는지에서 생깁니다. 이를 매체의 동의나 의도로 단정하지 않습니다.");
  return (
    <section className="afs-card afs-card-lead">
      <h2>이 사안의 프레이밍 요약 <small>{issue.articleCount}건 · {issue.outletCount}개 매체</small></h2>
      <div className="afs-in afs-prose afp-summary">
        <p><strong>공통으로 보이는 설명:</strong> {commonText}</p>
        <p><strong>갈라지는 질문:</strong> {differenceText}</p>
        <p><strong>읽기 경로:</strong> {readerPath}</p>
        {issue.sourceContext ? <p><strong>취재원 맥락:</strong> {issue.sourceContext}</p> : null}
        <p className="afp-summary-meta">{observed.length}/{DIMENSION_LIST.length}개 차원에서 AI 구조화 항목이 관측됐고, 관측 항목의 {allRows.length ? Math.round((attributed / allRows.length) * 100) : 0}%가 명시적 취재원 발언으로 분류됐습니다. 미확인 발화는 별도 귀속하지 않습니다.</p>
        {stateText ? <p className="afp-summary-meta"><strong>판정 보류·상태:</strong> {stateText}</p> : null}
      </div>
      <EngineNote bundle={bundle} />
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
  const what = observedClaim(synthesis.what_happened);
  const agreed = observedClaim(synthesis.agreed_line);
  const split = observedClaim(synthesis.split_line);
  const soWhat = observedClaim(synthesis.so_what);
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
                    key={`${camp.index ?? camp.name}`}
                    style={{ borderLeft: `3px solid ${color}`, paddingLeft: "12px" }}
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
                      {row.status === "explicit_not_stated" ? "명시적으로 언급되지 않음" : "공개 근거 지문 부족으로 내용 미표시 (insufficient_evidence)"}
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
                      {row.status === "explicit_not_stated" ? "명시적으로 언급되지 않음" : "공개 근거 지문 부족으로 내용 미표시 (insufficient_evidence)"}
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

function IssueThirtySecond({ issue }: { issue: IssueView }) {
  const articles = issue.articles.slice().sort((a, b) => (a.publishedAt ?? "").localeCompare(b.publishedAt ?? ""));
  return (
    <section className="afs-card afp-issue-brief">
      <h2>사건 30초 요약 <small>기사 묶음의 공통 사실</small></h2>
      <div className="afs-in afs-prose">
        <p>{issue.lead ?? "공개 semantic 요약이 아직 생성되지 않았습니다."}</p>
        {issue.commonGround ? <p><strong>공통으로 확인된 설명:</strong> {issue.commonGround}</p> : null}
        {issue.mainDifference ? <p><strong>비교할 차이:</strong> {issue.mainDifference}</p> : null}
        {issue.sourceContext ? <p><strong>취재원 맥락:</strong> {issue.sourceContext}</p> : null}
        {issue.commonSubjects.length ? <p className="afp-summary-meta"><strong>반복 등장한 주제:</strong> {issue.commonSubjects.join(" · ")}</p> : null}
        <details className="afp-article-index">
          <summary>공통 사실을 확인한 기사 {articles.length}건</summary>
          <ul>{articles.map((article) => <li key={article.articleId}><span>{article.outlet}</span><strong>{article.title}</strong>{article.url ? <a href={article.url} target="_blank" rel="noreferrer">원문 ↗</a> : null}</li>)}</ul>
        </details>
        <p className="afs-note">이 요약은 기사 메타데이터와 공개 semantic paraphrase를 집계한 것입니다. 원문 본문이나 인용문을 화면에 복사하지 않습니다.</p>
      </div>
    </section>
  );
}

function AxisCard({ analysis }: { analysis: DimensionAnalysis }) {
  if (analysis.groups.length < 2) return null;
  return (
    <article className="afp-axis-card">
      <header><span className="afp-kicker">{analysis.label}</span><h3>{analysis.question}</h3></header>
      <div className="afp-axis-groups">
        {analysis.groups.slice(0, 3).map((group) => (
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
  const split = dimensions.filter((dimension) => dimension.groups.length >= 2);
  return (
    <section className="afs-card">
      <h2>논조 갈래 축 <small>같은 사건에서 무엇을 다르게 강조했나</small></h2>
      <div className="afs-in">
        <p className="afs-note">한 단어로 매체 성향을 정하지 않습니다. 동일 사건의 기사에서 반복된 문제·원인·책임·평가·해법 배치와 발화 주체를 함께 비교합니다.</p>
        <div className="afp-status-strip">{dimensions.map((analysis) => <span key={analysis.dimension}><b>{analysis.label}</b> {Object.entries(analysis.stateCounts).map(([state, count]) => `${STATUS_COPY[state] ?? state} ${count}`).join(" · ") || "공개 상태 없음"}</span>)}</div>
        {split.length ? <div className="afp-axis-list">{split.map((analysis) => <AxisCard key={analysis.dimension} analysis={analysis} />)}</div> : <p className="afp-state">현재 semantic AI 결과에서는 명확한 양극 축이 확정되지 않았습니다. 공통 설명과 취재원 배치 차이는 아래 표에서 확인할 수 있습니다.</p>}
      </div>
    </section>
  );
}

function DebateSection({ issue, dimensions }: { issue: IssueView; dimensions: DimensionAnalysis[] }) {
  const split = dimensions.filter((dimension) => dimension.groups.length >= 2);
  const common = dimensions.filter((dimension) => dimension.groups.length === 1).slice(0, 3);
  return (
    <section className="afs-card afp-debate">
      <h2>공통으로 본 것과 갈린 지점 <small>관찰된 선택만 비교</small></h2>
      <div className="afs-in">
        <div className="afp-common-ground">
          <strong>공통으로 본 것</strong>
          <p>{issue.commonGround ?? (common.length ? common.map((item) => `${item.label}: ${item.groups[0].label}`).join(" · ") : "검증 가능한 단일 공통 계열이 없습니다.")}</p>
        </div>
        {split.length ? <div className="afp-debate-boxes">{split.map((dimension, index) => (
          <details className="afp-debate-box" key={dimension.dimension}>
            <summary><span>관측 축 {String.fromCharCode(65 + index)}</span><strong>{dimension.label}: {dimension.question}</strong><small>{dimension.groups.length}개 계열 · {dimension.observedArticles}건</small></summary>
            <div className="afp-debate-body">
              {dimension.groups.slice(0, 3).map((group) => <article key={group.family}><h3>{group.label}</h3><p className="afp-summary-meta">{group.outlets.join(" · ")} · {group.articleIds.length}건</p>{group.rows.slice(0, 3).map((row, rowIndex) => <div className="afp-proof-row" key={`${row.articleId}-${rowIndex}`}><b>{row.outlet}</b><span>{row.validEvidence ? row.item.public_paraphrase : row.stateReason}</span><small>{statusCopy(displayStatus(row), row.item.voice?.kind, row.modelStatus)}</small><EvidenceDisclosure row={row} compact /></div>)}</article>)}
              <p className="afs-note">이 갈래는 기사에서 관측된 표현·책임·발화 배치의 차이입니다. 매체의 고정 성향이나 의도를 의미하지 않습니다.</p>
            </div>
          </details>
        ))}</div> : <p className="afp-state">현재 매체 자체 서술이 두 계열 이상으로 갈린 축은 확정되지 않았습니다.</p>}
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
              const refs = validComparisonEvidence(pattern);
              const articleRows = (pattern.article_ids ?? []).map((id) => articles.get(id)).filter(Boolean);
              const outlets = [...new Set(articleRows.map((article) => article?.outlet).filter(Boolean))];
              return <div className="afp-ledger-pattern" key={`${axis.dimension}-${pattern.voice_scope}-${index}`}>
                <div className="afp-axis-group-head"><strong>{comparisonScopeLabel(pattern.voice_scope)}</strong><span>{pattern.article_count ?? articleRows.length}건 · {outlets.length}개 매체</span></div>
                {refs.length && pattern.public_paraphrase ? <p>{pattern.public_paraphrase}</p> : <p className="afp-state">{refs.length ? "검증된 공개 paraphrase가 없습니다." : "위치·해시가 함께 검증된 공개 근거가 없어 내용을 표시하지 않습니다."}</p>}
                {articleRows.length ? <small className="afp-summary-meta">{articleRows.slice(0, 4).map((article) => `${article?.outlet ?? "매체 미상"} · ${article?.title ?? "제목 미상"}`).join(" / ")}</small> : null}
                {refs.length ? <EvidenceRefs refs={refs} label="축별 근거" /> : <small className="afp-state">근거 상태: insufficient_evidence</small>}
              </div>;
            })}</div> : <p className="afp-state">이 축에는 공개 패턴이 없습니다. 기사에 해당 요소가 없다고 단정하지 않습니다.</p>}
          </article>;
        })}</div> : <p className="afp-state">비교 원장에 축별 패턴이 없습니다. semantic AI 기사 프로필의 상태와 근거를 기준으로만 비교합니다.</p>}
      </div>
    </section>
  );
}

function StructuredObservationSection({ bundle }: { bundle: IssueAnalysisBundle }) {
  const profiles = (bundle.ruleProfiles ?? []).map((entry) => ({ entry, profile: structuredProfile(entry) })).filter(({ profile }) => Boolean(profile));
  const countValues = (values: Array<string | undefined>) => [...values.reduce((map, value) => {
    if (value) map.set(value, (map.get(value) ?? 0) + 1);
    return map;
  }, new Map<string, number>())].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const genre = countValues(profiles.map(({ profile }) => profile?.genre?.label ?? profile?.genre?.code));
  const scope = countValues(profiles.map(({ profile }) => profile?.scope?.label ?? profile?.scope?.code));
  const depth = countValues(profiles.map(({ profile }) => profile?.context_depth?.label ?? profile?.context_depth?.level));
  const devices = profiles.flatMap(({ entry, profile }) => (profile?.framing_devices ?? []).map((device) => ({ ...device, articleId: entry.articleId })));
  const descriptors = profiles.flatMap(({ entry, profile }) => [
    ...(profile?.secondary_descriptors?.policy_frames ?? []).map((row) => ({ ...row, kind: "정책 프레임", articleId: entry.articleId })),
    ...(profile?.secondary_descriptors?.generic_frames ?? []).map((row) => ({ ...row, kind: "보편 프레임", articleId: entry.articleId })),
  ]);
  return (
    <section className="afs-card afp-structured-observation">
      <h2>구조화 보조 관측 <small>rules_local · semantic AI와 별도</small></h2>
      <div className="afs-in">
        <p className="afs-note">아래 값은 공개 snapshot에 포함된 결정론적 구조화 프로필입니다. semantic AI의 의미 판정이나 언론사의 의도를 대신하지 않으며, 해당 보조 엔진의 관측 범위와 근거 위치만 보여 줍니다.</p>
        {profiles.length ? <>
          <div className="afp-stat-grid">
            <div><span>장르</span><strong>{genre.map(([label, count]) => `${label} ${count}`).join(" · ") || "미분류"}</strong></div>
            <div><span>시야</span><strong>{scope.map(([label, count]) => `${label} ${count}`).join(" · ") || "미관측"}</strong></div>
            <div><span>맥락 깊이</span><strong>{depth.map(([label, count]) => `${label} ${count}`).join(" · ") || "미관측"}</strong></div>
          </div>
          {descriptors.length ? <div className="afp-descriptor-list">{descriptors.slice(0, 20).map((row, index) => <div key={`${row.kind}-${row.code ?? row.label}-${index}`}><strong>{row.kind}: {row.label ?? row.code ?? "분류 미상"}</strong><span>{row.articleId} · {row.article_count ?? 0}건</span><EvidenceRefs refs={row.evidence} label="보조 관측 근거" /></div>)}</div> : <p className="afp-state">정책·보편 프레임 코드는 이 snapshot에서 구조화되지 않았습니다.</p>}
          {devices.length ? <div className="afp-device-list">{devices.slice(0, 20).map((device, index) => <div key={`${device.code ?? device.label}-${index}`}><strong>{device.label ?? device.code ?? "장치 미상"}</strong><span>{device.articleId} · {device.count ?? 1}건{device.appears_in_lead ? " · 제목/리드에 관측" : ""}</span><EvidenceRefs refs={device.evidence} label="장치 근거" /></div>)}</div> : <p className="afp-state">구조화된 표현 장치가 없습니다. 본문에 장치가 없다고 단정하지 않고 이 분류만 미관측으로 둡니다.</p>}
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
          return <article key={dimension}><span className="afp-kicker">{String(index + 1).padStart(2, "0")}</span><h3>{GUIDE_LABEL[dimension]}</h3><p>{CORE_DIM_EXPLANATIONS[dimension]}</p><small>{dimension === "actor_visibility" ? `${sourceProfiles ?? 0}건 취재원 귀속 관측` : `${analysis?.observedArticles ?? 0}건 관측 · ${analysis?.stateCounts.explicit_not_stated ?? 0}건 명시적 미제시`}</small></article>;
        })}
      </div>
      <p className="afs-note">차원은 기사에 실제로 제시된 문제·원인·책임·평가·해법을 분리해 읽는 틀입니다. 한 차원의 미관측은 해당 요소가 실제로 없거나 의도적으로 빠졌다는 뜻이 아닙니다.</p>
    </section>
  );
}

function FourFunctionTable({ issue, dimensions }: { issue: IssueView; dimensions: DimensionAnalysis[] }) {
  const core = CORE_DIMENSIONS;
  return (
    <section className="afs-card afp-four-functions">
      <h2>프레임 4기능 비교 <small>문제·원인·평가·해법</small></h2>
      <div className="afs-in">
        <div className="afs-scroll"><table className="afs-table"><caption>각 셀은 검증된 public paraphrase만 표시합니다. 출처 발언은 매체 서술과 분리합니다.</caption><thead><tr><th scope="col">매체·기사</th>{core.filter((dimension) => dimension !== "responsibility_attribution").map((dimension) => <th scope="col" key={dimension}>{DIM_LABEL[dimension]}</th>)}</tr></thead><tbody>
          {issue.articles.map((article) => <tr key={article.articleId}><th scope="row"><strong>{article.outlet}</strong><small>{article.title}</small></th>{core.filter((dimension) => dimension !== "responsibility_attribution").map((dimension) => {
            const row = dimensions.find((entry) => entry.dimension === dimension)?.rows.find((entry) => entry.articleId === article.articleId && entry.validEvidence);
            return <td key={dimension}>{row ? <><span className="afp-cell-voice">{statusCopy(displayStatus(row), row.item.voice?.kind, row.modelStatus)}</span><p>{row.item.public_paraphrase ?? "검증된 paraphrase 없음"}</p><EvidenceDisclosure row={row} compact /></> : <StateDisclosure summary="분석 상태" reason={dimensions.find((entry) => entry.dimension === dimension)?.rows.find((entry) => entry.articleId === article.articleId)?.stateReason ?? "명시적 판정 없음"} />}</td>;
          })}</tr>)}
        </tbody></table></div>
        <p className="afs-note">‘책임 귀속’은 4기능과 별도의 관계·주체 축으로 기사별 근거 목록에서 함께 확인합니다. 빈 셀은 의도적 누락이 아니라 공개 근거가 확인되지 않은 상태입니다.</p>
      </div>
    </section>
  );
}

function SourceTable({ issue }: { issue: IssueView }) {
  return (
    <div className="afs-scroll"><table className="afs-table"><caption>인용 횟수는 목소리의 가시성이지 신뢰도나 매체의 지지 여부가 아닙니다.</caption><thead><tr><th>매체</th><th>주요 역할</th><th>직접 인용</th><th>간접 전언</th></tr></thead><tbody>
      {issue.outlets.map((outlet) => <tr key={outlet.outlet}><th>{outlet.outlet}</th><td>{outlet.roles.slice(0, 3).map((role) => `${role.label} ${role.count}건`).join(" · ") || "역할 분석 대기"}</td><td className="afs-num">{outlet.directQuotes}</td><td className="afs-num">{outlet.indirectQuotes}</td></tr>)}
    </tbody></table></div>
  );
}

function SourceRoleEvidence({ bundle }: { bundle: IssueAnalysisBundle }) {
  const rows = bundle.semanticProfiles.flatMap((entry) => (richProfile(entry)?.actors_and_sources ?? []).map((actor) => ({ ...actor, articleId: entry.articleId })));
  return <section className="afs-card"><h2>취재원 역할과 전달 방식 <small>기사별 공개 근거 위치</small></h2><div className="afs-in"><p className="afs-note">취재원 구성은 목소리의 가시성에 대한 관측이며, 매체의 지지·균형·의도를 의미하지 않습니다.</p>{rows.length ? <div className="afp-source-evidence">{rows.map((row, index) => <article key={`${row.articleId}-${row.actor_id ?? row.role}-${index}`}><strong>{row.role_label ?? row.role ?? "역할 미상"}</strong><span>{row.articleId} · 직접 인용 {row.direct_quote_count ?? 0} · 간접 전언 {row.indirect_attribution_count ?? 0}</span><EvidenceRefs refs={row.evidence} label="취재원 근거" /></article>)}</div> : <p className="afp-state">기사별 취재원 역할·근거가 공개 프로필에 구조화되지 않았습니다.</p>}</div></section>;
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
    return <details className="afp-article" key={article.articleId}><summary><span>{article.outlet}</span><strong>{article.title}</strong><small>{STATUS_COPY[articleStatus] ?? articleStatus} · {entry?.evidence.length ?? 0}개 공개 지문 · {article.publishedAt ?? "발행일 미상"}</small></summary><div className="afp-article-body">{rows.length ? rows.slice(0, 8).map((row, index) => <div className="afp-article-row" key={`${row.dimension}-${index}`}><b>{row.dimension}</b><span>{row.stateOnly || !row.validEvidence ? row.stateReason : row.item.public_paraphrase ?? "공개 paraphrase 미제공"}</span><small>{statusCopy(displayStatus(row), row.item.voice?.kind)} · {row.validEvidence ? evidenceLocator(row) : "공개 근거 지문 없음"}{row.reviewRequired ? " · 사람 검토 전" : ""}</small><EvidenceDisclosure row={row} compact /></div>) : <p className="afp-state">이 기사에는 현재 공개된 semantic 차원 항목이 없습니다. 원문 본문을 대신 표시하지 않습니다.</p>}{profileReview?.fallback_reason ? <p className="afp-state">분석 보류 사유: {profileReview.fallback_reason}</p> : null}{article.url ? <a href={article.url} target="_blank" rel="noreferrer">원문 링크 열기 ↗</a> : null}</div></details>;
  })}</div>;
}

function ClusterSection({ issue }: { issue: IssueView }) {
  const clusters = issue.narratedClusters.length ? issue.narratedClusters : issue.frameClusters;
  const narrated = issue.narratedClusters.length > 0;
  return <section className="afs-card"><h2>비슷한 방식으로 보도한 기사 묶음 <small>Matthes &amp; Kohring 2008</small></h2><div className="afs-in"><p className="afs-note">{narrated ? "기자 서술의 5개 기능 조합으로 묶었습니다." : "기자 서술만으로 충분한 군집이 없어 취재원 발언까지 포함한 보조 군집을 표시합니다."}</p><div className="afp-clusters">{clusters.slice(0, 8).map((cluster, index) => <article key={cluster.key}><span className="afp-cluster-no">{String(index + 1).padStart(2, "0")}</span><div><h3>{cluster.articleIds.length}건 · {cluster.outlets.length}개 매체</h3><p>{Object.entries(cluster.signature).map(([dimension, family]) => `${DIM_LABEL[dimension] ?? dimension}: ${family ? familyLabel(family) : "분석 대기"}`).join(" · ")}</p>{cluster.differsAt.length ? <small>대표 군집과 다른 축: {cluster.differsAt.map((dimension) => DIM_LABEL[dimension] ?? dimension).join(", ")}</small> : null}</div></article>)}{!clusters.length ? <p className="afp-state">군집을 구성할 semantic profile이 아직 충분하지 않습니다.</p> : null}</div></div></section>;
}

function DescriptorSection({ bundle, field, title, subtitle }: { bundle: IssueAnalysisBundle; field: "generic_frames" | "policy_frames"; title: string; subtitle: string }) {
  const rows = bundle.semanticProfiles.flatMap((entry) => {
    const descriptors = richProfile(entry)?.secondary_descriptors?.[field] ?? [];
    return descriptors.map((descriptor) => ({ ...descriptor, articleId: entry.articleId }));
  });
  const grouped = new Map<string, { label: string; articles: Set<string>; evidence: unknown[] }>();
  for (const row of rows) {
    const key = row.code ?? row.label ?? "unclassified";
    const current = grouped.get(key) ?? { label: row.label ?? key, articles: new Set<string>(), evidence: [] };
    current.articles.add(row.articleId);
    current.evidence.push(...(row.evidence ?? []));
    grouped.set(key, current);
  }
  return <section className="afs-card"><h2>{title} <small>{subtitle}</small></h2><div className="afs-in"><p className="afs-note">semantic profile이 명시적으로 구조화한 보조 분류만 표시합니다. 논조나 의도를 직접 판정하는 지표가 아닙니다.</p>{grouped.size ? <ul className="afp-descriptor-list">{[...grouped.values()].sort((a, b) => b.articles.size - a.articles.size).map((row) => <li key={row.label}><strong>{row.label}</strong><span>{row.articles.size}건</span><EvidenceRefs refs={row.evidence} /></li>)}</ul> : <p className="afp-state">이 표본의 semantic profile에는 아직 {title} 코드가 구조화되지 않았습니다. 규칙 기반 결과를 AI 결과로 대체하지 않았습니다.</p>}</div></section>;
}

function ScopeSection({ bundle }: { bundle: IssueAnalysisBundle }) {
  const values = bundle.semanticProfiles.map((entry) => ({ entry, profile: richProfile(entry) })).filter(({ profile }) => Boolean(profile)).map(({ entry, profile }) => ({ entry, scope: profile?.scope?.code ?? "unknown", depth: profile?.context_depth?.level ?? "unknown", scopeEvidence: profile?.scope?.evidence, depthEvidence: profile?.context_depth?.evidence, scopeCaution: profile?.scope?.caution, depthCaution: profile?.context_depth?.caution }));
  const count = (key: "scope" | "depth") => { const map = new Map<string, number>(); for (const value of values) map.set(value[key], (map.get(value[key]) ?? 0) + 1); return [...map].sort((a, b) => b[1] - a[1]); };
  const scope = count("scope"); const depth = count("depth");
  const translate = (code: string) => ({ episodic: "사건 중심", thematic: "구조·주제 중심", mixed: "혼합", unknown: "시야 판정 미관측", shallow: "얕은 맥락", moderate: "중간 맥락", deep: "깊은 맥락" }[code] ?? code);
  return <section className="afs-card"><h2>사건 하나로 봤나, 구조 문제로 봤나 <small>Iyengar · context depth</small></h2><div className="afs-in"><div className="afp-stat-grid"><div><span>시야</span><strong>{scope.map(([key, value]) => `${translate(key)} ${value}`).join(" · ") || "시야 판정 미관측"}</strong><p className="afs-note">사건 중심/구조 중심 판정은 본문에서 확인된 설명 범위에만 적용합니다.</p></div><div><span>맥락 깊이</span><strong>{depth.map(([key, value]) => `${translate(key)} ${value}`).join(" · ") || "맥락 깊이 미관측"}</strong><p className="afs-note">판정 근거는 원문 대신 공개 위치·해시로만 확인합니다.</p></div></div><div className="afp-scope-articles">{values.map((value) => <details key={value.entry.articleId}><summary>{value.entry.articleId} · {translate(value.scope)} · {translate(value.depth)}</summary><div className="afp-evidence-body"><EvidenceRefs refs={value.scopeEvidence} label="시야 판단 근거" /><EvidenceRefs refs={value.depthEvidence} label="맥락 깊이 근거" />{value.scopeCaution || value.depthCaution ? <p className="afs-note">{value.scopeCaution ?? value.depthCaution}</p> : null}</div></details>)}</div></div></section>;
}

function SourceNetwork({ dimensions }: { dimensions: DimensionAnalysis[] }) {
  const groups = dimensions.flatMap((dimension) => dimension.groups.map((group) => ({ dimension: dimension.label, group })));
  return <section className="afs-card"><h2>프레임별 의미 연결망 <small>semantic profile co-occurrence</small></h2><div className="afs-in"><p className="afs-note">기사별로 함께 관측된 프레임 계열과 취재원 구조를 연결해 보여줍니다. 연결은 기사 안의 동시 관측을 뜻하며 인과나 의도를 뜻하지 않습니다.</p><div className="afp-network">{groups.slice(0, 15).map(({ dimension, group }) => <div className="afp-network-node" key={`${dimension}-${group.family}`}><b>{dimension}</b><strong>{group.label}</strong><span>{group.articleIds.length}건 · {group.outlets.join(" · ")}</span></div>)}</div></div></section>;
}

function DevicesSection({ bundle }: { bundle: IssueAnalysisBundle }) {
  const devices = bundle.semanticProfiles.flatMap((entry) => (richProfile(entry)?.framing_devices ?? []).map((device) => ({ ...device, articleId: entry.articleId })));
  return <section className="afs-card"><h2>근거 장치 <small>기사 안에서 확인된 구조화 항목</small></h2><div className="afs-in">{devices.length ? <div className="afp-device-list">{devices.map((device, index) => <div key={`${device.code ?? device.label}-${index}`}><strong>{device.label ?? device.code ?? "장치 미상"}</strong><span>{device.count ?? 1}건 · article {device.articleId}</span><EvidenceRefs refs={device.evidence} label="장치 근거" /></div>)}</div> : <p className="afp-state">현재 semantic profile에는 별도의 근거 장치 코드가 구조화되지 않았습니다. 본문에 없다고 단정하지 않고, 이 분류만 보류합니다.</p>}</div></section>;
}

function FramingRail() {
  return (
    <nav className="afs-rail" aria-label="프레이밍 분석 주요 층위 바로가기">
      <a className="afs-rail-item" href="#sec-synthesis">
        <b>사건 종합 비교</b>
        <small>공통선 · 갈림길 · Camps</small>
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
      <a className="afs-rail-item" href="#sec-scope">
        <b>보도 시야</b>
        <small>Iyengar · Episodic/Thematic</small>
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
          <strong>해석의 한계:</strong> 관측되지 않은 차원은 &apos;명시되지 않음(explicit_not_stated)&apos; 또는 &apos;근거 부족(insufficient_evidence)&apos;으로 처리하며, 매체의 고정 성향이나 의도적 왜곡으로 단정하지 않습니다. 취재원의 발언은 해당 발화 주체에게만 귀속되며 언론사 자체 주장으로 환원하지 않습니다.
        </p>
      </div>
    </details>
  );
}

function PendingAnalysisShell({ bundle, issue }: { bundle: IssueAnalysisBundle; issue: IssueView }) {
  return (
    <>
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
  if (isPendingLiveAnalysis(bundle)) return <PendingAnalysisShell bundle={bundle} issue={issue} />;
  const dimensions = analyses(bundle, issue);
  return (
    <>
      <IssueThirtySecond issue={issue} />
      <div id="sec-synthesis">
        <SynthesisNarrative bundle={bundle} />
      </div>
      <Summary bundle={bundle} issue={issue} analyses={dimensions} />
      <AxisSection dimensions={dimensions} />
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
      <section className="afs-card" id="sec-evidence">
        <h2>
          기사 근거 <small>원문은 링크로만 열기</small>
        </h2>
        <div className="afs-in">
          <ArticleList bundle={bundle} issue={issue} dimensions={dimensions} />
        </div>
      </section>
      <MethodologyDisclaimer />
    </>
  );
}

export function FramingSemanticPage({ bundle, issue }: { bundle: IssueAnalysisBundle; issue: IssueView }) {
  if (isPendingLiveAnalysis(bundle)) return <PendingAnalysisShell bundle={bundle} issue={issue} />;
  const dimensions = analyses(bundle, issue);
  return (
    <>
      <FramingRail />
      <IssueThirtySecond issue={issue} />
      <div id="sec-synthesis">
        <SynthesisNarrative bundle={bundle} />
      </div>
      <Summary bundle={bundle} issue={issue} analyses={dimensions} />
      <div id="sec-guide">
        <DimensionGuide dimensions={dimensions} />
      </div>
      <div id="sec-four-functions">
        <FourFunctionTable issue={issue} dimensions={dimensions} />
      </div>
      <section className="afs-card" id="sec-matrix">
        <h2>
          매체별 전체 프레임 행렬 <small>5개 기능·취재원 구조</small>
        </h2>
        <div className="afs-in">
          <FrameMatrix issue={issue} dimensions={dimensions} />
        </div>
      </section>
      <div id="sec-clusters">
        <ClusterSection issue={issue} />
      </div>
      <ComparisonAxisEvidence bundle={bundle} issue={issue} />
      <StructuredObservationSection bundle={bundle} />
      <div id="sec-descriptors">
        <DescriptorSection bundle={bundle} field="policy_frames" title="정책 프레임" subtitle="Boydstun et al. 2014" />
        <DescriptorSection bundle={bundle} field="generic_frames" title="보편 프레임 다섯 종" subtitle="Semetko &amp; Valkenburg 2000" />
      </div>
      <div id="sec-scope">
        <ScopeSection bundle={bundle} />
      </div>
      <section className="afs-card" id="sec-sources">
        <h2>
          누구의 말을 중심에 뒀나 <small>취재원 구조</small>
        </h2>
        <div className="afs-in">
          <SourceTable issue={issue} />
        </div>
      </section>
      <SourceRoleEvidence bundle={bundle} />
      <SourceNetwork dimensions={dimensions} />
      <DevicesSection bundle={bundle} />
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
