import type {
  EventSynthesisComparisonDimension,
  EventSynthesisComparisonPoint,
  IssueAnalysisBundle,
} from "./types";
import { evidenceIntegrityValid } from "./evidence-integrity";

const PUBLISHABLE_SYNTHESIS_PROMPT = "event-synthesis-v2.2.0";
const PUBLISHABLE_SYNTHESIS_SCHEMA = "agendaframe.event-synthesis.v2.2";
const COMPARISON_CONTRACT_VERSION = "comparison-v1.0.0";
const COMPARISON_RESULT_STATUSES = new Set([
  "difference_confirmed",
  "no_clear_difference",
  "held_for_analysis",
  "analysis_failed",
]);
const COMPARISON_RELATIONS = new Set([
  "same_core",
  "same_core_with_detail",
  "different_emphasis",
  "contradictory",
  "insufficient_evidence",
]);
const COMPARISON_DIMENSIONS = new Set([
  "problem_definition",
  "causal_interpretation",
  "responsibility_attribution",
  "evaluation",
  "treatment_recommendation",
]);

function compactCopy(value?: string) {
  return String(value ?? "").toLowerCase().replace(/[^0-9a-z가-힣]+/gu, " ").replace(/\s+/gu, " ").trim();
}

export function pointEvidenceIsBound(point: EventSynthesisComparisonPoint, bundle: IssueAnalysisBundle) {
  const bundleArticles = bundle.articles ?? [];
  const declared = new Set(point.article_ids ?? []);
  if (!declared.size || [...declared].some((articleId) => !bundleArticles.some((article) => article.articleId === articleId))) return false;
  const profiles = new Map((bundle.semanticProfiles ?? []).map((entry) => [entry.articleId, entry]));
  const namedOutlets = ["뉴스1", "국민일보", "세계일보", "중앙일보", "KBS", "경향신문", "조선일보", "연합뉴스", "한겨레", "동아일보", "SBS", "MBC"];
  const copy = [point.headline, point.summary, point.text].join(" ");
  const outlets = bundleArticles.filter((row) => declared.has(row.articleId)).map((row) => row.outlet ?? "");
  if (namedOutlets.some((name) => copy.includes(name) && !outlets.some((outlet) => outlet.includes(name)))) return false;
  const evidenceArticles = new Set<string>();
  for (const evidence of point.evidence ?? []) {
    if (!evidence.article_id || !declared.has(evidence.article_id)) return false;
    if (!evidenceIntegrityValid(bundle, evidence, point.voice_basis?.kind)) return false;
    if (!Number.isInteger(evidence.locator?.paragraph) || !Number.isInteger(evidence.locator?.sentence)) return false;
    if (!/^[a-f0-9]{64}$/i.test(evidence.sentence_sha256 ?? "")) return false;
    const profile = profiles.get(evidence.article_id);
    const evidenceMatches = profile?.evidence.some((candidate) => (
      candidate.locator?.paragraph === evidence.locator?.paragraph
      && candidate.locator?.sentence === evidence.locator?.sentence
      && candidate.sentenceSha256?.toLowerCase() === evidence.sentence_sha256?.toLowerCase()
    ));
    if (!evidenceMatches) return false;
    evidenceArticles.add(evidence.article_id);
  }
  return [...declared].every((articleId) => evidenceArticles.has(articleId));
}

function hasCrossOutletRelation(
  dimensions: EventSynthesisComparisonDimension[],
  bundle: IssueAnalysisBundle,
  acceptedRelations: Set<string>,
) {
  return dimensions.some((dimension) => {
    const articleIds = new Set<string>();
    const outlets = new Set<string>();
    for (const point of dimension.points ?? []) {
      if (!acceptedRelations.has(String(point.relation)) || point.voice_basis?.kind !== "journalist_narration") continue;
      for (const articleId of point.article_ids ?? []) {
        const article = (bundle.articles ?? []).find((candidate) => candidate.articleId === articleId);
        const outlet = String(article?.outlet ?? article?.sourceId ?? "").trim();
        if (outlet) {
          articleIds.add(articleId);
          outlets.add(outlet);
        }
      }
    }
    return articleIds.size >= 2 && outlets.size >= 2;
  });
}

/**
 * A direct event synthesis is publishable only when the current comparison
 * contract is present. Legacy v2 prose may remain visible as review context,
 * but it cannot make an active snapshot look finalized.
 */
export function isPublishableEventSynthesis(bundle: IssueAnalysisBundle | null): boolean {
  if (!bundle) return false;
  const bundleArticles = bundle.articles ?? [];
  const synthesis = bundle?.comparison?.data?.synthesis;
  const runId = String((bundle?.lineage as { runId?: unknown } | undefined)?.runId ?? "").trim();
  const comparisonResult = synthesis?.comparison_result;
  const dimensions = comparisonResult?.dimensions;
  const terms = synthesis?.terms;
  const commonGround = synthesis?.common_ground;
  const commonGroundValid = commonGround?.status === "observed"
    ? Boolean(commonGround.text?.trim() && commonGround.evidence?.length)
    : commonGround?.status === "insufficient_evidence"
      ? commonGround.text == null && commonGround.evidence?.length === 0
      : false;
  const differenceRelations = new Set(["different_emphasis", "contradictory"]);
  const sharedRelations = new Set(["same_core", "same_core_with_detail"]);
  const differenceSupported = Array.isArray(dimensions)
    && dimensions.some((dimension) => dimension?.status === "difference_confirmed"
      && hasCrossOutletRelation([dimension], bundle, differenceRelations));
  const sameCoreSupported = Array.isArray(dimensions)
    && dimensions.some((dimension) => dimension?.status === "no_clear_difference"
      && hasCrossOutletRelation([dimension], bundle, sharedRelations));
  const hasDifferenceRelation = Array.isArray(dimensions)
    && hasCrossOutletRelation(dimensions, bundle, differenceRelations);
  const declaredAnalyzedIds = comparisonResult?.analyzed_article_ids;
  const analyzedCoverageValid = Array.isArray(declaredAnalyzedIds)
    && declaredAnalyzedIds.every((articleId) => bundleArticles.some((article) => article.articleId === articleId))
    && new Set(declaredAnalyzedIds).size === declaredAnalyzedIds.length
    && Number.isInteger(comparisonResult?.analyzed_outlet_count)
    && new Set(bundleArticles
      .filter((article) => declaredAnalyzedIds.includes(article.articleId))
      .map((article) => String(article.outlet ?? article.sourceId ?? "").trim())
      .filter(Boolean)).size === comparisonResult?.analyzed_outlet_count;
  const comparisonCopyValid = Array.isArray(dimensions)
    && dimensions.length <= 5
    && dimensions.every((dimension) => Boolean(
      COMPARISON_DIMENSIONS.has(String(dimension?.dimension ?? ""))
      && ["difference_confirmed", "no_clear_difference", "held_for_analysis", "analysis_failed"].includes(String(dimension?.status ?? ""))
      && dimension.question?.trim()
      && dimension.question.length <= 70
      && Array.isArray(dimension.points)
      && dimension.points.length <= 6
      && dimension.points.every((point) => Boolean(
        COMPARISON_RELATIONS.has(String(point.relation ?? ""))
        && (point.status == null || point.status === "observed")
        && point?.observation_id?.trim()
        && point.headline?.trim()
        && point.headline.length <= 40
        && point.summary?.trim()
        && point.summary.length <= 120
        && compactCopy(point.summary) !== compactCopy(point.headline)
        && point.text?.trim()
        && point.text.length <= 1800
        && Array.isArray(point.article_ids)
        && point.article_ids.length > 0
        && Array.isArray(point.evidence)
        && point.evidence.length > 0
        && pointEvidenceIsBound(point, bundle)
      )),
    ));
  const blockedDimensionsClear = Array.isArray(dimensions)
    && dimensions.every((dimension) => (
      dimension.status !== "held_for_analysis" && dimension.status !== "analysis_failed"
        ? true
        : (dimension.points?.length ?? 0) === 0
    ));
  const statusSupported = comparisonResult?.status !== "difference_confirmed" || differenceSupported;
  const noDifferenceConsistent = comparisonResult?.status !== "no_clear_difference"
    || (sameCoreSupported && !hasDifferenceRelation);
  return Boolean(
    synthesis?.usable === true
    && synthesis.source === "gcp:event-synthesis"
    && synthesis.schemaVersion === PUBLISHABLE_SYNTHESIS_SCHEMA
    && synthesis.promptVersion === PUBLISHABLE_SYNTHESIS_PROMPT
    && comparisonResult != null
    && comparisonResult.version === COMPARISON_CONTRACT_VERSION
    && COMPARISON_RESULT_STATUSES.has(String(comparisonResult.status ?? ""))
    && analyzedCoverageValid
    && comparisonCopyValid
    && blockedDimensionsClear
    && statusSupported
    && noDifferenceConsistent
    && Array.isArray(synthesis.event_paragraphs)
    && synthesis.event_paragraphs.length >= 2
    && synthesis.event_paragraphs.length <= 4
    && Array.isArray(synthesis.terms)
    && synthesis.terms.length <= 4
    && Array.isArray(terms)
    && terms.every((term) => Boolean(term?.term?.trim() && term.gloss?.trim() && term.evidence?.length))
    && commonGroundValid
    && runId
    && String(synthesis.run_id ?? "").trim() === runId
    && synthesis.invocation?.provider === "vertex_ai"
  );
}
