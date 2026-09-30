import { DIM_LABEL, DIM_ORDER } from "./derive";
import { isPublishableEventSynthesis } from "./publication-contract";
import { stripEvidenceTokens } from "./public-text.mjs";
import type {
  ComparisonRelation,
  ComparisonResultStatus,
  EventSynthesisClaim,
  EventSynthesisComparisonDimension,
  EventSynthesisComparisonPoint,
  EventSynthesisComparisonResult,
  EventSynthesisData,
  EventSynthesisEvidence,
  IssueAnalysisBundle,
  SemanticDimensionItem,
  SemanticEvidenceSource,
} from "./types";

export type ComparisonStatus = ComparisonResultStatus;

export interface ComparisonObservation {
  observationId: string;
  articleId: string;
  outlet: string;
  title: string;
  url: string | null;
  dimension: string;
  valueKey: string;
  valueLabel: string;
  publicParaphrase: string | null;
  voiceKind: string;
  evidence: SemanticEvidenceSource;
  claimId?: string;
  relation?: ComparisonRelation;
}

export interface ComparisonGroupDetail {
  label: string;
  text: string;
  articleId: string;
  outlet: string;
  title: string;
  evidence: SemanticEvidenceSource;
}

export interface ComparisonGroup {
  key: string;
  dimension: string;
  dimensionLabel: string;
  title: string;
  emphasis: string;
  articleIds: string[];
  outlets: string[];
  articleCount: number;
  voiceLabel: string;
  observations: ComparisonObservation[];
  details: ComparisonGroupDetail[];
  relation?: ComparisonRelation;
  claimIds?: string[];
}

export interface DimensionComparison {
  dimension: string;
  label: string;
  question: string;
  status: ComparisonStatus;
  statusReason: string;
  groups: ComparisonGroup[];
  sourceGroups: ComparisonGroup[];
  narratedArticleCount: number;
  narratedOutletCount: number;
  sourceArticleCount: number;
  sourceOutletCount: number;
  variationAcrossOutlets: boolean;
  differenceText: string;
}

export interface ComparisonSummary {
  status: ComparisonStatus;
  statusLabel: string;
  reviewRequired: boolean;
  statusReason: string;
  commonText: string | null;
  commonObservations: ComparisonObservation[];
  commonScope: string | null;
  differenceText: string;
  whatToNotice: string;
  question: string;
  dimensionLabel: string | null;
  /** All evidence-backed groups in the selected dimension. */
  groups: ComparisonGroup[];
  /** Groups selected for the first comparison cards. */
  representativeGroups: ComparisonGroup[];
  /** Groups not shown in the first card row; the UI must keep them reachable. */
  allGroups: ComparisonGroup[];
  remainingGroupCount: number;
  sourceGroups: ComparisonGroup[];
  dimensions: DimensionComparison[];
  analyzedArticleCount: number;
  analyzedOutletCount: number;
}

export function distinctComparisonSummary(group: ComparisonGroup) {
  const emphasis = cleanText(group.emphasis);
  if (!emphasis || exactText(emphasis) === exactText(group.title)) return null;
  return emphasis;
}

const STATUS_LABEL: Record<ComparisonStatus, string> = {
  difference_confirmed: "기자 서술 차이 확인",
  no_clear_difference: "매체 간 뚜렷한 차이 없음",
  held_for_analysis: "비교 보류",
  analysis_failed: "분석 실패",
};

const RELATION_LABEL: Record<ComparisonRelation, string> = {
  same_core: "핵심 설명은 같음",
  same_core_with_detail: "핵심은 같고 세부가 추가됨",
  different_emphasis: "강조점이 다름",
  contradictory: "서술이 충돌함",
  insufficient_evidence: "근거 부족",
};

// SSR과 브라우저의 locale 설정 차이로 정렬 순서가 달라지지 않도록 한다.
function compareStableText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

const VOICE_LABEL: Record<string, string> = {
  journalist_narration: "기자 서술",
  direct_quote: "직접 인용",
  indirect_source: "간접 전언",
  uncertain_quote: "불확실 인용",
  synthesis_claim: "비교 결과",
};

const BLOCKED_ANALYSIS_STATES = new Set([
  "analysis_failed",
  "conflicting",
  "insufficient_evidence",
  "dead_letter",
  "failed",
]);

const COMPARISON_STATUSES = new Set<ComparisonStatus>([
  "difference_confirmed",
  "no_clear_difference",
  "held_for_analysis",
  "analysis_failed",
]);

const COMPARISON_RELATIONS = new Set<ComparisonRelation>([
  "same_core",
  "same_core_with_detail",
  "different_emphasis",
  "contradictory",
  "insufficient_evidence",
]);

function blockedState(value: unknown) {
  return typeof value === "string" && BLOCKED_ANALYSIS_STATES.has(value);
}

function articleMap(bundle: IssueAnalysisBundle) {
  return new Map((bundle.articles ?? []).map((article) => [article.articleId, article]));
}

function profileMap(bundle: IssueAnalysisBundle) {
  return new Map((bundle.semanticProfiles ?? []).map((entry) => [entry.articleId, entry]));
}

function exactText(value?: string | null) {
  if (!value) return "";
  return stripEvidenceTokens(value)
    .toLowerCase()
    .replace(/[^0-9a-z가-힣]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanText(value?: string | null) {
  if (typeof value !== "string" || !value.trim()) return null;
  return stripEvidenceTokens(value).trim() || null;
}

function evidenceKey(evidence?: SemanticEvidenceSource | EventSynthesisEvidence | null) {
  if (!evidence?.locator || typeof evidence.sentence_sha256 !== "string") return "";
  return [
    evidence.locator.paragraph,
    evidence.locator.sentence,
    evidence.sentence_sha256.toLowerCase(),
  ].join(":");
}

export function synthesisRunMatches(bundle: IssueAnalysisBundle, synthesis?: EventSynthesisData | null) {
  const bundleRunId = String((bundle.lineage as { runId?: unknown } | undefined)?.runId ?? "").trim();
  const synthesisRunId = String(synthesis?.run_id ?? "").trim();
  return Boolean(bundleRunId && synthesisRunId && bundleRunId === synthesisRunId);
}

function publicEvidenceKey(evidence?: { locator?: { paragraph?: number; sentence?: number }; sentenceSha256?: string } | null) {
  if (!evidence?.locator || typeof evidence.sentenceSha256 !== "string") return "";
  return [
    evidence.locator.paragraph,
    evidence.locator.sentence,
    evidence.sentenceSha256.toLowerCase(),
  ].join(":");
}

export function semanticEntryBlockedState(entry: IssueAnalysisBundle["semanticProfiles"][number], bundle: IssueAnalysisBundle) {
  const profile = entry.profile as (IssueAnalysisBundle["semanticProfiles"][number]["profile"] & {
    review?: { analysis_state?: string; analysis_decision?: string; status?: string };
  }) | null;
  const candidates = [
    bundle.analysisStatus?.semantic?.status,
    entry.status,
    (entry.engine as { status?: string }).status,
    profile?.engine?.status,
    profile?.review?.analysis_state,
    profile?.review?.analysis_decision,
    profile?.review?.status,
  ];
  return candidates.find((candidate): candidate is string => blockedState(candidate)) ?? null;
}

export function semanticProfileEntryIsUsable(entry: IssueAnalysisBundle["semanticProfiles"][number]) {
  const profile = entry.profile as (IssueAnalysisBundle["semanticProfiles"][number]["profile"] & {
    review?: { analysis_state?: string; analysis_decision?: string; status?: string };
  }) | null;
  const rawEntry = entry as unknown as { status?: string };
  const rawEngine = entry.engine as unknown as { status?: string };
  return entry.status === "succeeded"
    && !blockedState(rawEntry.status)
    && !blockedState(rawEngine.status)
    && !blockedState(profile?.engine?.status)
    && !blockedState(profile?.review?.analysis_state)
    && !blockedState(profile?.review?.analysis_decision)
    && !blockedState(profile?.review?.status)
}

export function semanticEntryIsEligible(entry: IssueAnalysisBundle["semanticProfiles"][number], bundle: IssueAnalysisBundle) {
  return semanticProfileEntryIsUsable(entry)
    && !blockedState(bundle.analysisStatus?.semantic?.status);
}

export function hasValidPublicEvidence(
  evidence?: SemanticEvidenceSource | null,
  entryEvidence?: IssueAnalysisBundle["semanticProfiles"][number]["evidence"],
): evidence is SemanticEvidenceSource {
  if (!evidence?.locator) return false;
  const hasLocator = Number.isInteger(evidence.locator.paragraph)
    && Number.isInteger(evidence.locator.sentence);
  const validShape = hasLocator
    && typeof evidence.sentence_sha256 === "string"
    && /^[a-f0-9]{64}$/i.test(evidence.sentence_sha256);
  return validShape && (!entryEvidence || entryEvidence.some((candidate) => publicEvidenceKey(candidate) === evidenceKey(evidence)));
}

function isJournalistVoice(kind?: string) {
  return kind === "journalist_narration";
}

function isSourceVoice(kind?: string) {
  return kind === "direct_quote"
    || kind === "indirect_source"
    || kind === "uncertain_quote"
    || kind === "source_attributed"
    || kind === "mixed";
}

function uniqueItems(items: SemanticDimensionItem[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const evidence = item.evidence?.sentence_sha256 ?? "";
    const key = `${item.claim_id ?? ""}|${item.public_paraphrase ?? ""}|${evidence}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function observationsFor(
  bundle: IssueAnalysisBundle,
  dimension: string,
  voice: "journalist" | "source",
) {
  const articles = articleMap(bundle);
  const rows: ComparisonObservation[] = [];
  const seen = new Set<string>();
  if (blockedState(bundle.analysisStatus?.semantic?.status)) return rows;
  for (const entry of bundle.semanticProfiles ?? []) {
    if (!semanticEntryIsEligible(entry, bundle)) continue;
    const node = entry.profile?.dimensions?.[dimension];
    if (!node) continue;
    if (blockedState(node.status) || blockedState(node.model_status) || (node.model_status && node.model_status !== "supported")) continue;
    for (const item of uniqueItems(node.items ?? [])) {
      const kind = item.voice?.kind;
      if (voice === "journalist" ? !isJournalistVoice(kind) : !isSourceVoice(kind)) continue;
      if (!hasValidPublicEvidence(item.evidence, entry.evidence)) continue;
      const paraphrase = cleanText(item.public_paraphrase);
      if (!paraphrase) continue;
      const article = articles.get(entry.articleId);
      if (!article) continue;
      // A profile family is a coding aid, never a semantic merge key.
      const valueKey = `text:${exactText(paraphrase)}`;
      const observationKey = `${entry.articleId}|${valueKey}|${evidenceKey(item.evidence)}`;
      if (seen.has(observationKey)) continue;
      seen.add(observationKey);
      rows.push({
        observationId: `${dimension}:${entry.articleId}:${evidenceKey(item.evidence)}`,
        articleId: entry.articleId,
        outlet: article.outlet ?? "매체 미상",
        title: article.title ?? "제목 미상",
        url: article.canonicalUrl,
        dimension,
        valueKey,
        valueLabel: paraphrase,
        publicParaphrase: paraphrase,
        voiceKind: kind ?? "unknown",
        evidence: item.evidence,
        claimId: item.claim_id,
      });
    }
  }
  return rows;
}

const GROUP_DETAIL_DIMENSIONS = [
  ["problem_definition", "문제"],
  ["causal_interpretation", "원인"],
  ["responsibility_attribution", "책임"],
  ["moral_evaluation", "평가"],
  ["treatment_recommendation", "대응"],
] as const;

function detailsForGroup(bundle: IssueAnalysisBundle, articleIds: string[], voice: "journalist" | "source") {
  const allowed = new Set(articleIds);
  const details: ComparisonGroupDetail[] = [];
  for (const [dimension, label] of GROUP_DETAIL_DIMENSIONS) {
    for (const row of observationsFor(bundle, dimension, voice)) {
      if (!allowed.has(row.articleId) || !row.publicParaphrase) continue;
      details.push({
        label,
        text: row.publicParaphrase,
        articleId: row.articleId,
        outlet: row.outlet,
        title: row.title,
        evidence: row.evidence,
      });
    }
  }
  return details;
}

function groupObservations(
  bundle: IssueAnalysisBundle,
  rows: ComparisonObservation[],
  dimension: string,
  voice: "journalist" | "source",
  voiceLabel: string,
): ComparisonGroup[] {
  const grouped = new Map<string, ComparisonObservation[]>();
  for (const row of rows) {
    const key = row.valueKey;
    const observations = grouped.get(key) ?? [];
    observations.push(row);
    grouped.set(key, observations);
  }
  return [...grouped.entries()]
    .map(([key, observations]) => {
      const stableObservations = [...observations].sort((left, right) =>
        compareStableText(left.valueLabel, right.valueLabel)
        || compareStableText(left.articleId, right.articleId)
        || compareStableText(evidenceKey(left.evidence), evidenceKey(right.evidence)),
      );
      const articleIds = [...new Set(stableObservations.map((row) => row.articleId))].sort(compareStableText);
      const outlets = [...new Set(stableObservations.map((row) => row.outlet))].sort(compareStableText);
      const first = stableObservations[0];
      return {
        key,
        dimension,
        dimensionLabel: DIM_LABEL[dimension] ?? dimension,
        title: first.publicParaphrase ?? first.valueLabel,
        emphasis: "",
        articleIds,
        outlets,
        articleCount: articleIds.length,
        voiceLabel,
        observations: stableObservations,
        details: detailsForGroup(bundle, articleIds, voice),
      } satisfies ComparisonGroup;
    })
    .sort((a, b) => compareStableText(a.key, b.key));
}

function relation(value: unknown): ComparisonRelation | undefined {
  return typeof value === "string" && COMPARISON_RELATIONS.has(value as ComparisonRelation)
    ? value as ComparisonRelation
    : undefined;
}

function status(value: unknown): ComparisonStatus | undefined {
  return typeof value === "string" && COMPARISON_STATUSES.has(value as ComparisonStatus)
    ? value as ComparisonStatus
    : undefined;
}

function synthesisResult(synthesis?: EventSynthesisData | null): EventSynthesisComparisonResult | null {
  const result = synthesis?.comparison_result;
  return result && typeof result === "object" ? result : null;
}

function comparisonDimension(result: EventSynthesisComparisonResult | null, dimension: string) {
  return (result?.dimensions ?? []).find((candidate) => candidate?.dimension === dimension) ?? null;
}

function boundedEvidence(
  bundle: IssueAnalysisBundle,
  rawEvidence: EventSynthesisEvidence[] | undefined,
) {
  const entries = profileMap(bundle);
  const articles = articleMap(bundle);
  const byArticle = new Map<string, SemanticEvidenceSource[]>();
  for (const evidence of rawEvidence ?? []) {
    const articleId = typeof evidence.article_id === "string" ? evidence.article_id : "";
    const entry = entries.get(articleId);
    const article = articles.get(articleId);
    if (!article || !entry || !hasValidPublicEvidence(evidence, entry.evidence)) continue;
    const normalized = {
      locator: evidence.locator,
      sentence_sha256: evidence.sentence_sha256?.toLowerCase(),
    } satisfies SemanticEvidenceSource;
    const articleEvidence = byArticle.get(articleId) ?? [];
    if (!articleEvidence.some((candidate) => evidenceKey(candidate) === evidenceKey(normalized))) {
      articleEvidence.push(normalized);
      byArticle.set(articleId, articleEvidence);
    }
  }
  return new Map([...byArticle.entries()]
    .sort(([left], [right]) => compareStableText(left, right))
    .map(([articleId, evidenceRows]) => [
      articleId,
      evidenceRows.sort((left, right) => compareStableText(evidenceKey(left), evidenceKey(right))),
    ]));
}

function observationsFromClaim(
  bundle: IssueAnalysisBundle,
  claim: EventSynthesisClaim | null | undefined,
  dimension: string,
) {
  const text = cleanText(claim?.text);
  if (!text || claim?.status !== "observed") return [];
  const articles = articleMap(bundle);
  return [...boundedEvidence(bundle, claim.evidence)].flatMap(([articleId, evidenceRows]) => evidenceRows.map((evidence) => {
    const article = articles.get(articleId);
    return {
      observationId: `${dimension}:${articleId}:${evidenceKey(evidence)}`,
      articleId,
      outlet: article?.outlet ?? article?.sourceId ?? "매체 미상",
      title: article?.title ?? "제목 미상",
      url: article?.canonicalUrl ?? null,
      dimension,
      valueKey: `synthesis:${dimension}:${exactText(text)}`,
      valueLabel: text,
      publicParaphrase: text,
      voiceKind: "synthesis_claim",
      evidence,
    } satisfies ComparisonObservation;
  })).sort((a, b) => compareStableText(a.articleId, b.articleId)
    || compareStableText(evidenceKey(a.evidence), evidenceKey(b.evidence)));
}

function observationsFromPoint(
  bundle: IssueAnalysisBundle,
  dimension: string,
  point: EventSynthesisComparisonPoint,
  index: number,
) {
  const text = cleanText(point.text);
  const pointRelation = relation(point.relation) ?? "insufficient_evidence";
  if (!text || pointRelation === "insufficient_evidence" || point.status === "insufficient_evidence" || blockedState(point.status)) return null;
  const evidence = boundedEvidence(bundle, point.evidence);
  const declaredIds = new Set((point.article_ids ?? []).filter((articleId) => typeof articleId === "string"));
  const articles = articleMap(bundle);
  if ([...declaredIds].some((articleId) => !articles.has(articleId))) return null;
  if ([...declaredIds].some((articleId) => !evidence.has(articleId))) return null;
  const voiceKind = point.voice_basis?.kind ?? "not_observed";
  const voice = isSourceVoice(voiceKind)
    ? "취재원 발언"
    : isJournalistVoice(voiceKind) ? "기자 서술" : "발화 범위 미관측";
  const observations = [...evidence.entries()]
    .filter(([articleId]) => !declaredIds.size || declaredIds.has(articleId))
    .flatMap(([articleId, evidenceRows]) => evidenceRows.map((evidenceRef) => {
      const article = articles.get(articleId);
      return {
        observationId: `${point.observation_id ?? point.claim_id ?? `${dimension}:${pointRelation}:${exactText(text)}`}:${articleId}:${evidenceKey(evidenceRef)}`,
        articleId,
        outlet: article?.outlet ?? article?.sourceId ?? "매체 미상",
        title: article?.title ?? "제목 미상",
        url: article?.canonicalUrl ?? null,
        dimension,
        valueKey: `synthesis:${dimension}:${index}:${pointRelation}`,
        valueLabel: text,
        publicParaphrase: text,
        voiceKind,
        evidence: evidenceRef,
        claimId: point.claim_id,
        relation: pointRelation,
      } satisfies ComparisonObservation;
    }))
    .sort((a, b) => compareStableText(a.articleId, b.articleId)
      || compareStableText(evidenceKey(a.evidence), evidenceKey(b.evidence)));
  const articleIds = [...new Set(observations.map((row) => row.articleId))].sort(compareStableText);
  if (!articleIds.length) return null;
  const outlets = [...new Set(observations.map((row) => row.outlet))].sort(compareStableText);
  return {
    key: `synthesis:${dimension}:${pointRelation}:${exactText(text)}`,
    dimension,
    dimensionLabel: DIM_LABEL[dimension] ?? dimension,
    title: cleanText(point.headline) ?? text,
    emphasis: cleanText(point.summary) && exactText(point.summary) !== exactText(point.headline ?? text)
      ? cleanText(point.summary) as string
      : "",
    articleIds,
    outlets,
    articleCount: articleIds.length,
    voiceLabel: voice,
    observations,
    details: isSourceVoice(voiceKind)
      ? detailsForGroup(bundle, articleIds, "source")
      : isJournalistVoice(voiceKind) ? detailsForGroup(bundle, articleIds, "journalist") : [],
    relation: pointRelation,
    claimIds: point.claim_id ? [point.claim_id] : [],
  } satisfies ComparisonGroup;
}

function groupsFromComparisonDimension(
  bundle: IssueAnalysisBundle,
  dimension: string,
  raw: EventSynthesisComparisonDimension | null,
) {
  const groups: ComparisonGroup[] = [];
  for (const [index, point] of (raw?.points ?? []).entries()) {
    const group = observationsFromPoint(bundle, dimension, point, index);
    if (group) groups.push(group);
  }
  return groups.sort((a, b) => compareStableText(a.key, b.key));
}

function supportForDifference(groups: ComparisonGroup[]) {
  const differing = groups.filter((group) => group.relation === "different_emphasis" || group.relation === "contradictory");
  const articleIds = new Set(differing.flatMap((group) => group.articleIds));
  const outlets = new Set(differing.flatMap((group) => group.outlets));
  return differing.length >= 1 && articleIds.size >= 2 && outlets.size >= 2;
}

function dimensionCounts(rows: ComparisonObservation[]) {
  return {
    articleCount: new Set(rows.map((row) => row.articleId)).size,
    outletCount: new Set(rows.map((row) => row.outlet)).size,
  };
}

function comparisonFailureState(value: unknown) {
  return typeof value === "string"
    && ["analysis_failed", "conflicting", "dead_letter", "failed"].includes(value);
}

function comparisonInsufficientState(value: unknown) {
  return value === "insufficient_evidence";
}

function comparisonHeldState(value: unknown) {
  return value === "held_for_analysis";
}

function comparisonResultHasFailure(result: EventSynthesisComparisonResult | null | undefined) {
  return (result?.dimensions ?? []).some((dimension) => (
    comparisonFailureState(dimension?.status)
    || (dimension?.points ?? []).some((point) => comparisonFailureState(point?.status))
  ));
}

function dimensionComparison(
  bundle: IssueAnalysisBundle,
  dimension: string,
  result: EventSynthesisComparisonResult | null,
  rootResultStatus?: unknown,
): DimensionComparison {
  const narratedRows = observationsFor(bundle, dimension, "journalist");
  const sourceRows = observationsFor(bundle, dimension, "source");
  const sourceGroups = groupObservations(bundle, sourceRows, dimension, "source", "취재원 발언");
  const raw = comparisonDimension(result, dimension);
  const semanticStatus = bundle.analysisStatus?.semantic?.status;
  const failed = comparisonFailureState(semanticStatus)
    || comparisonFailureState(rootResultStatus)
    || comparisonFailureState(raw?.status);
  const insufficient = comparisonInsufficientState(semanticStatus)
    || comparisonInsufficientState(rootResultStatus)
    || comparisonInsufficientState(raw?.status)
    || comparisonHeldState(semanticStatus)
    || comparisonHeldState(rootResultStatus)
    || comparisonHeldState(raw?.status);
  const blocked = failed || insufficient;
  const resultGroups = blocked ? [] : groupsFromComparisonDimension(bundle, dimension, raw);
  const groups = resultGroups.filter((group) => group.voiceLabel === "기자 서술");
  const resultSourceGroups = resultGroups.filter((group) => group.voiceLabel === "취재원 발언");
  const counts = dimensionCounts(groups.flatMap((group) => group.observations));
  const sourceCounts = dimensionCounts(resultSourceGroups.flatMap((group) => group.observations));
  const fallbackCounts = dimensionCounts(narratedRows);
  const fallbackSourceCounts = dimensionCounts(sourceRows);
  const requestedStatus = failed
    ? "analysis_failed"
    : insufficient
      ? "held_for_analysis"
    : status(raw?.status)
      ?? (raw?.relation === "different_emphasis" || raw?.relation === "contradictory" ? "difference_confirmed" : undefined);
  const supportedDifference = supportForDifference(groups);
  const finalStatus: ComparisonStatus = requestedStatus === "analysis_failed"
    ? "analysis_failed"
    : requestedStatus === "difference_confirmed"
      ? supportedDifference ? "difference_confirmed" : "held_for_analysis"
      : requestedStatus === "no_clear_difference"
        ? "no_clear_difference"
        : "held_for_analysis";
  const label = raw?.label || DIM_LABEL[dimension] || dimension;
  const question = finalStatus === "difference_confirmed" || finalStatus === "no_clear_difference"
    ? cleanText(raw?.question) || `${label}에서 확인된 설명을 어떻게 비교할까?`
    : "비교 질문 미확정";
  const reason = cleanText(raw?.reason)
    || (finalStatus === "difference_confirmed"
      ? `${label}에서 관계가 다른 기자 서술이 두 개 이상 매체의 근거로 연결되었습니다.`
      : finalStatus === "no_clear_difference"
        ? `${label}에서 핵심 설명이 같거나 차이가 확정되지 않았습니다.`
        : finalStatus === "analysis_failed"
          ? `${label} 비교 분석이 실패해 차이를 표시하지 않습니다.`
          : `${label}의 비교 결과가 충분히 연결되지 않아 차이를 확정하지 않습니다.`);
  return {
    dimension,
    label,
    question,
    status: finalStatus,
    statusReason: reason,
    groups: finalStatus === "difference_confirmed" || finalStatus === "no_clear_difference" ? groups : [],
    sourceGroups: resultSourceGroups.length ? resultSourceGroups : sourceGroups,
    narratedArticleCount: counts.articleCount || fallbackCounts.articleCount,
    narratedOutletCount: counts.outletCount || fallbackCounts.outletCount,
    sourceArticleCount: sourceCounts.articleCount || fallbackSourceCounts.articleCount,
    sourceOutletCount: sourceCounts.outletCount || fallbackSourceCounts.outletCount,
    variationAcrossOutlets: finalStatus === "difference_confirmed" && supportedDifference,
    differenceText: reason,
  };
}

function observedSynthesisClaim(claim?: EventSynthesisClaim | null) {
  return claim?.status === "observed" ? cleanText(claim.text) : null;
}

function bundleRequiresHumanReview(bundle: IssueAnalysisBundle) {
  return Boolean(
    bundle.analysisStatus?.semantic?.requiresHumanReview
    || (bundle.semanticProfiles ?? []).some((entry) => Boolean(
      entry.engine?.reviewRequired
      || entry.profile?.review?.requires_human_review
      || entry.status === "review_needed"
      || entry.profile?.review?.status === "automatic_draft"
      || entry.profile?.review?.status === "review_needed",
    )),
  );
}

function validSynthesisCoverage(claim: EventSynthesisClaim | null | undefined, bundle: IssueAnalysisBundle, minimumArticleCount = 2) {
  const evidence = boundedEvidence(bundle, claim?.evidence);
  const articleCount = evidence.size;
  const text = cleanText(claim?.text) ?? "";
  const expected = bundle.issue.articleCount;
  if (articleCount < minimumArticleCount) return false;
  if (/(모든|모두|전\s*기사|전체)/u.test(text) && articleCount < expected) return false;
  if (/(대부분|다수)/u.test(text) && articleCount / Math.max(expected, 1) < 0.7) return false;
  return true;
}

function comparisonStatusFromResult(
  bundle: IssueAnalysisBundle,
  synthesis: EventSynthesisData | null | undefined,
) {
  const semanticStatus = bundle.analysisStatus?.semantic?.status;
  const result = synthesisResult(synthesis);
  if (comparisonFailureState(semanticStatus) || comparisonFailureState(result?.status) || comparisonResultHasFailure(result)) return "analysis_failed" as const;
  if (comparisonInsufficientState(semanticStatus) || comparisonInsufficientState(result?.status)) return "held_for_analysis" as const;
  if (comparisonHeldState(semanticStatus) || comparisonHeldState(result?.status)) return "held_for_analysis" as const;
  if (!isPublishableEventSynthesis(bundle) || !synthesisRunMatches(bundle, synthesis)) return "held_for_analysis" as const;
  return status(result?.status) ?? "held_for_analysis" as const;
}

function selectPrimaryDimension(dimensions: DimensionComparison[], result: EventSynthesisComparisonResult | null, target: ComparisonStatus) {
  const explicit = result?.primary_dimension && dimensions.find((dimension) => dimension.dimension === result.primary_dimension);
  if (explicit && explicit.status === target) return explicit;
  // DIM_ORDER is a documented display priority, not a confidence ranking by
  // group count. Never choose a dimension merely because it has more groups.
  return dimensions.find((dimension) => dimension.status === target) ?? null;
}

export function selectRepresentativeGroups(groups: ComparisonGroup[], limit = 3) {
  const remaining = [...groups].sort((left, right) =>
    (right.relation === "different_emphasis" || right.relation === "contradictory" ? 1 : 0)
      - (left.relation === "different_emphasis" || left.relation === "contradictory" ? 1 : 0)
      || right.outlets.length - left.outlets.length
      || right.articleCount - left.articleCount
      || compareStableText(left.key, right.key),
  );
  const selected: ComparisonGroup[] = [];
  const coveredOutlets = new Set<string>();
  while (remaining.length && selected.length < limit) {
    let bestIndex = 0;
    let bestScore = Number.NEGATIVE_INFINITY;
    remaining.forEach((candidate, index) => {
      const newOutlets = candidate.outlets.filter((outlet) => !coveredOutlets.has(outlet)).length;
      const relationScore = candidate.relation === "different_emphasis" || candidate.relation === "contradictory" ? 1 : 0;
      const score = newOutlets * 100 + relationScore * 10 + candidate.outlets.length * 2 + candidate.articleCount;
      if (score > bestScore || (score === bestScore && compareStableText(candidate.key, remaining[bestIndex].key) < 0)) {
        bestScore = score;
        bestIndex = index;
      }
    });
    const [picked] = remaining.splice(bestIndex, 1);
    selected.push(picked);
    picked.outlets.forEach((outlet) => coveredOutlets.add(outlet));
  }
  return selected;
}

export function comparisonSummary(bundle: IssueAnalysisBundle): ComparisonSummary {
  const synthesis = bundle.comparison?.data?.synthesis;
  const rawResult = synthesisResult(synthesis);
  const result = isPublishableEventSynthesis(bundle) && synthesisRunMatches(bundle, synthesis) ? rawResult : null;
  const rootResultStatus = comparisonResultHasFailure(rawResult) ? "analysis_failed" : rawResult?.status;
  const dimensions = DIM_ORDER.map((dimension) => dimensionComparison(bundle, dimension, result, rootResultStatus));
  const statusValue = comparisonStatusFromResult(bundle, synthesis);
  const selected = selectPrimaryDimension(dimensions, result, statusValue);
  const commonBlocked = comparisonFailureState(bundle.analysisStatus?.semantic?.status)
    || comparisonInsufficientState(bundle.analysisStatus?.semantic?.status)
    || comparisonFailureState(rawResult?.status)
    || comparisonInsufficientState(rawResult?.status);
  const commonText = !commonBlocked
    && synthesisRunMatches(bundle, synthesis)
    && observedSynthesisClaim(synthesis?.common_ground)
    && validSynthesisCoverage(synthesis?.common_ground, bundle)
    ? observedSynthesisClaim(synthesis?.common_ground)
    : null;
  const commonObservations = commonText ? observationsFromClaim(bundle, synthesis?.common_ground, "common") : [];
  const commonOutlets = new Set(commonObservations.map((observation) => observation.outlet));
  const commonScope = commonObservations.length
    ? `${new Set(commonObservations.map((observation) => observation.articleId)).size}건·${commonOutlets.size}개 매체`
    : null;
  const status = statusValue === "difference_confirmed"
    ? selected ? "difference_confirmed" : "held_for_analysis"
    : statusValue === "no_clear_difference"
      ? "no_clear_difference"
      : statusValue;
  const allGroups = selected?.groups ?? [];
  const representativeGroups = selectRepresentativeGroups(allGroups, 3);
  const representativeKeys = new Set(representativeGroups.map((group) => group.key));
  const reviewRequired = bundleRequiresHumanReview(bundle);
  const statusReason = cleanText(result?.reason)
    || selected?.statusReason
    || (status === "analysis_failed"
      ? "분석 실패 상태라 매체 간 차이를 표시하지 않습니다."
      : status === "held_for_analysis"
        ? "축별 비교 결과와 기사 근거가 연결되지 않아 매체 간 차이를 확정하지 않습니다."
        : "비교 결과를 기사별 근거와 함께 확인합니다.");
  const differenceText = status === "difference_confirmed"
    ? selected?.differenceText || statusReason
    : statusReason;
  const baseNotice = status === "difference_confirmed"
    ? `${selected?.label ?? "선택된 비교 축"}에서 모델이 명시한 관계와 기사별 근거를 확인하세요. 카드 수가 많다는 이유만으로 차이를 확정하지 않았습니다.`
    : status === "no_clear_difference"
      ? "핵심 설명이 같거나 차이가 확정되지 않은 상태입니다. 세부 정보가 추가된 경우에도 별도 매체 차이로 세지 않습니다."
      : status === "analysis_failed"
        ? "분석 실패와 취재원 발언을 매체 자체의 입장으로 해석하지 않습니다."
        : "기사별 공개 근거는 확인할 수 있지만, 현재 결과로 매체 간 차이를 단정할 수는 없습니다.";
  const reviewNote = reviewRequired ? " 현재 공개 결과는 사람 검토 전 상태입니다." : "";
  const analyzedArticleIds = result?.analyzed_article_ids?.filter((articleId) => articleMap(bundle).has(articleId)) ?? [];
  return {
    status,
    statusLabel: reviewRequired ? `${STATUS_LABEL[status]} · 사람 검토 전` : STATUS_LABEL[status],
    reviewRequired,
    statusReason,
    commonText,
    commonObservations,
    commonScope,
    differenceText,
    whatToNotice: `${baseNotice}${reviewNote}`,
    question: selected?.question || "비교 질문은 분석 근거가 연결된 뒤 표시합니다.",
    dimensionLabel: selected?.label ?? null,
    groups: allGroups,
    representativeGroups,
    allGroups,
    remainingGroupCount: allGroups.filter((group) => !representativeKeys.has(group.key)).length,
    sourceGroups: selected?.sourceGroups ?? [],
    dimensions,
    analyzedArticleCount: analyzedArticleIds.length || selected?.narratedArticleCount || 0,
    analyzedOutletCount: result?.analyzed_outlet_count || selected?.narratedOutletCount || 0,
  };
}

export function comparisonStatusLabel(status: ComparisonStatus) {
  return STATUS_LABEL[status];
}

export function comparisonRelationLabel(value?: ComparisonRelation) {
  return value ? RELATION_LABEL[value] : "비교 관계 미관측";
}

export function comparisonVoiceLabel(kind: string) {
  return VOICE_LABEL[kind] ?? "발화 범위 미관측";
}
