import {
  DIM_LABEL,
  DIM_ORDER,
  familyLabel,
  particle,
  type IssueView,
} from "./derive";
import { stripEvidenceTokens } from "./public-text.mjs";
import type {
  EventSynthesisClaim,
  IssueAnalysisBundle,
  SemanticDimensionItem,
  SemanticEvidenceSource,
} from "./types";

export type ComparisonStatus = "difference_confirmed" | "no_clear_difference" | "held_for_analysis";

export interface ComparisonObservation {
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
  groups: ComparisonGroup[];
  sourceGroups: ComparisonGroup[];
  dimensions: DimensionComparison[];
  analyzedArticleCount: number;
  analyzedOutletCount: number;
}

const STATUS_LABEL: Record<ComparisonStatus, string> = {
  difference_confirmed: "기자 서술 차이 확인",
  no_clear_difference: "매체 간 뚜렷한 차이 없음",
  held_for_analysis: "비교 보류",
};

const VOICE_LABEL: Record<string, string> = {
  journalist_narration: "기자 서술",
  direct_quote: "직접 인용",
  indirect_source: "간접 전언",
  uncertain_quote: "불확실 인용",
};

const BLOCKED_ANALYSIS_STATES = new Set([
  "analysis_failed",
  "conflicting",
  "insufficient_evidence",
  "dead_letter",
  "failed",
]);

function blockedState(value: unknown) {
  return typeof value === "string" && BLOCKED_ANALYSIS_STATES.has(value);
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

export function semanticEntryIsEligible(entry: IssueAnalysisBundle["semanticProfiles"][number], bundle: IssueAnalysisBundle) {
  const profile = entry.profile as (IssueAnalysisBundle["semanticProfiles"][number]["profile"] & {
    review?: { analysis_state?: string; analysis_decision?: string; status?: string };
  }) | null;
  const rawEntry = entry as unknown as { status?: string };
  const rawEngine = entry.engine as unknown as { status?: string };
  const semanticState = bundle.analysisStatus?.semantic?.status;
  return entry.status === "succeeded"
    && !semanticEntryBlockedState(entry, bundle)
    && !blockedState(rawEntry.status)
    && !blockedState(rawEngine.status)
    && !blockedState(profile?.engine?.status)
    && !blockedState(profile?.review?.analysis_state)
    && !blockedState(profile?.review?.analysis_decision)
    && !blockedState(profile?.review?.status)
    && !blockedState(semanticState);
}

function articleMap(bundle: IssueAnalysisBundle) {
  return new Map((bundle.articles ?? []).map((article) => [article.articleId, article]));
}

export function hasValidPublicEvidence(evidence?: SemanticEvidenceSource | null): evidence is SemanticEvidenceSource {
  if (!evidence?.locator) return false;
  const hasLocator = Object.values(evidence.locator).some((value) => typeof value === "number");
  return hasLocator && typeof evidence.sentence_sha256 === "string" && /^[a-f0-9]{64}$/i.test(evidence.sentence_sha256);
}

function isJournalistVoice(kind?: string) {
  return kind === "journalist_narration";
}

function isSourceVoice(kind?: string) {
  return kind === "direct_quote" || kind === "indirect_source" || kind === "uncertain_quote";
}

function cleanText(value?: string | null) {
  if (typeof value !== "string" || !value.trim()) return null;
  return stripEvidenceTokens(value).trim() || null;
}

/**
 * Compare public paraphrases rather than frame-family codes. The latter are
 * useful taxonomy labels, but are too coarse to decide whether two articles
 * actually explain an event in the same way.
 */
export function normalizeComparisonText(value?: string | null) {
  if (!value) return "";
  return value
    .toLowerCase()
    .replace(/불구속\s*기소|재판에\s*넘겨(?:지|졌|짐|진|졌다)|재판행/g, "기소")
    .replace(/기소(?:되었|됐다|되|됨|했다|한|된)?/g, "기소")
    .replace(/밝혔(?:다|다는|다고)|주장(?:했|한|한다|했다|함)?/g, "발언")
    .replace(/언급(?:했|한|한다|했다|함)?/g, "언급")
    .replace(/보도(?:했|한|한다|했다|함)?/g, "보도")
    .replace(/[^0-9a-z가-힣]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function comparisonFeatures(value: string) {
  const normalized = normalizeComparisonText(value);
  const tokens = new Set(
    normalized
      .split(" ")
      .map((token) => token.replace(/(으로|에서|에게|에는|은|는|이|가|을|를|의|와|과|도|만|부터|까지)$/u, ""))
      .filter((token) => token.length >= 2),
  );
  const compact = normalized.replace(/\s/g, "");
  const grams = new Set<string>();
  for (let index = 0; index < compact.length - 2; index += 1) grams.add(compact.slice(index, index + 3));
  return { tokens, grams };
}

function jaccard(left: Set<string>, right: Set<string>) {
  if (!left.size && !right.size) return 1;
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const value of left) if (right.has(value)) shared += 1;
  return shared / new Set([...left, ...right]).size;
}

/** A conservative, deterministic near-duplicate check for public paraphrases. */
export function comparisonTextSimilarity(left?: string | null, right?: string | null) {
  const a = comparisonFeatures(left ?? "");
  const b = comparisonFeatures(right ?? "");
  if (!a.tokens.size || !b.tokens.size) return 0;
  const sharedTokens = [...a.tokens].filter((token) => b.tokens.has(token)).length;
  const tokenSimilarity = jaccard(a.tokens, b.tokens);
  const characterSimilarity = jaccard(a.grams, b.grams);
  const subsetSimilarity = sharedTokens / Math.min(a.tokens.size, b.tokens.size);
  return Math.max(
    0.65 * tokenSimilarity + 0.35 * characterSimilarity,
    subsetSimilarity >= 0.72 ? 0.55 * subsetSimilarity + 0.45 * characterSimilarity : 0,
  );
}

const COMPARISON_ANCHORS: Array<[string, RegExp]> = [
  ["energy_price", /에너지|유가|가격\s*(?:급등|상승|인상|부담)/u],
  ["hormuz_blockade", /호르무즈.{0,16}봉쇄|봉쇄.{0,16}호르무즈/u],
  ["hormuz_control", /호르무즈.{0,20}(?:통제권|영유권|영토)|(?:통제권|영유권|영토).{0,20}호르무즈/u],
  ["us_iran", /미국과\s*이란|이란과\s*미국|트럼프|이란/u],
  ["arrest_interference", /(?:체포|영장).{0,24}방해|방해.{0,24}(?:체포|영장)/u],
  ["prosecution", /기소|재판에\s*넘|불구속\s*기소/u],
  ["party_target", /국민의힘|의원|정치인/u],
  ["special_prosecutor", /특검/u],
  ["former_president", /윤\s*석열|윤\s*전\s*대통령/u],
  ["political_responsibility", /책임|주도/u],
];

function comparisonAnchors(value: string) {
  return new Set(
    COMPARISON_ANCHORS
      .filter(([, pattern]) => pattern.test(value))
      .map(([anchor]) => anchor),
  );
}

export function sameComparisonMeaning(left?: string | null, right?: string | null, dimension?: string) {
  const a = normalizeComparisonText(left);
  const b = normalizeComparisonText(right);
  if (!a || !b) return false;
  if (a === b || a.includes(b) || b.includes(a)) return true;
  const leftFeatures = comparisonFeatures(a);
  const rightFeatures = comparisonFeatures(b);
  const sharedTokens = [...leftFeatures.tokens].filter((token) => rightFeatures.tokens.has(token)).length;
  const score = comparisonTextSimilarity(a, b);
  if (sharedTokens >= 3 && score >= 0.54) return true;
  if (!dimension) return false;
  const leftAnchors = comparisonAnchors(a);
  const rightAnchors = comparisonAnchors(b);
  const sharedAnchors = [...leftAnchors].filter((anchor) => rightAnchors.has(anchor));
  return sharedAnchors.length >= 3;
}

function uniqueItems(items: SemanticDimensionItem[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const evidence = item.evidence?.sentence_sha256 ?? "";
    const key = `${item.claim_id ?? ""}|${item.frame_family ?? ""}|${item.public_paraphrase ?? ""}|${evidence}`;
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
      if (!hasValidPublicEvidence(item.evidence)) continue;
      if (!cleanText(item.public_paraphrase)) continue;
      const article = articles.get(entry.articleId);
      if (!article) continue;
      const paraphrase = cleanText(item.public_paraphrase);
      const valueKey = item.frame_family ? `family:${item.frame_family}` : `text:${paraphrase}`;
      const observationKey = `${entry.articleId}|${valueKey}|${paraphrase ?? ""}`;
      if (seen.has(observationKey)) continue;
      seen.add(observationKey);
      rows.push({
        articleId: entry.articleId,
        outlet: article.outlet ?? "매체 미상",
        title: article.title ?? "제목 미상",
        url: article.canonicalUrl,
        dimension,
        valueKey,
        valueLabel: item.frame_family ? familyLabel(item.frame_family) : paraphrase ?? "관측된 설명",
        publicParaphrase: paraphrase,
        voiceKind: kind ?? "unknown",
        evidence: item.evidence,
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
    const row = observationsFor(bundle, dimension, voice).find(
      (candidate) => allowed.has(candidate.articleId) && candidate.publicParaphrase,
    );
    if (row?.publicParaphrase) details.push({
      label,
      text: row.publicParaphrase,
      articleId: row.articleId,
      outlet: row.outlet,
      title: row.title,
      evidence: row.evidence,
    });
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
  const grouped: Array<{ key: string; observations: ComparisonObservation[] }> = [];
  for (const row of rows) {
    const target = grouped.find((candidate) => sameComparisonMeaning(
      candidate.observations[0]?.publicParaphrase,
      row.publicParaphrase,
      dimension,
    ));
    if (target) target.observations.push(row);
    else grouped.push({ key: `text:${normalizeComparisonText(row.publicParaphrase)}`, observations: [row] });
  }
  return grouped
    .map(({ key, observations }) => {
      const articleIds = [...new Set(observations.map((row) => row.articleId))];
      const outlets = [...new Set(observations.map((row) => row.outlet))];
      const first = observations[0];
      return {
        key,
        dimension,
        dimensionLabel: DIM_LABEL[dimension] ?? dimension,
        title: first.publicParaphrase ?? first.valueLabel,
        emphasis: first.publicParaphrase ?? first.valueLabel,
        articleIds,
        outlets,
        articleCount: articleIds.length,
        voiceLabel,
        observations,
        // 보조 기능은 이 묶음의 대표 기사 한 건에서만 가져온다. 서로 다른 기사에서
        // 문제·원인·평가·대응을 한 줄씩 조립해 묶음 전체의 주장처럼 만들지 않는다.
        details: detailsForGroup(bundle, [first.articleId], voice),
      } satisfies ComparisonGroup;
    })
    .sort((a, b) => b.articleCount - a.articleCount || b.outlets.length - a.outlets.length || a.title.localeCompare(b.title));
}

function quote(value: string, limit = 76) {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > limit ? `${compact.slice(0, limit - 1)}…` : compact;
}

function compareQuestion(label: string, groups: ComparisonGroup[]) {
  const values = groups.slice(0, 3).map((group) => `“${quote(group.title, 52)}”`);
  if (!values.length) return `${label}에서 매체가 무엇을 강조했는지 확인할 수 있나?`;
  if (values.length === 1) return `${label}에서 다음 설명을 어떻게 제시했나: ${values[0]}`;
  return `${label}에서 ${values.join(" · ")} 중 무엇을 앞세웠나?`;
}

function differenceText(groups: ComparisonGroup[], narratedOutletCount: number) {
  if (groups.length < 2) return "";
  const parts = groups.slice(0, 3).map((group) => `${group.outlets.map((outlet) => `${outlet}${particle(outlet, "은", "는")}`).join("·")} “${quote(group.emphasis)}”`);
  return `${parts.join(" / ")}로 설명이 나뉘었습니다. 기자 서술이 확인된 매체 ${narratedOutletCount}곳의 기사에서 나온 차이입니다.`;
}

function outletSignatures(rows: ComparisonObservation[]) {
  const byOutlet = new Map<string, Set<string>>();
  for (const row of rows) {
    const set = byOutlet.get(row.outlet) ?? new Set<string>();
    set.add(row.valueKey);
    byOutlet.set(row.outlet, set);
  }
  const signatures = new Set([...byOutlet.values()].map((values) => [...values].sort().join("|")));
  return { outletCount: byOutlet.size, signatureCount: signatures.size };
}

function groupSignatures(groups: ComparisonGroup[]) {
  const byOutlet = new Map<string, Set<string>>();
  for (const group of groups) {
    for (const outlet of group.outlets) {
      const set = byOutlet.get(outlet) ?? new Set<string>();
      set.add(group.key);
      byOutlet.set(outlet, set);
    }
  }
  const signatures = new Set([...byOutlet.values()].map((values) => [...values].sort().join("|")));
  return { outletCount: byOutlet.size, signatureCount: signatures.size };
}

function dimensionComparison(bundle: IssueAnalysisBundle, dimension: string): DimensionComparison {
  const narratedRows = observationsFor(bundle, dimension, "journalist");
  const sourceRows = observationsFor(bundle, dimension, "source");
  const groups = groupObservations(bundle, narratedRows, dimension, "journalist", "기자 서술");
  const sourceGroups = groupObservations(bundle, sourceRows, dimension, "source", "취재원 발언");
  const narratedArticles = new Set(narratedRows.map((row) => row.articleId));
  const sourceArticles = new Set(sourceRows.map((row) => row.articleId));
  const narrated = outletSignatures(narratedRows);
  const source = outletSignatures(sourceRows);
  const signatures = groupSignatures(groups);
  const adequate = narratedArticles.size >= 2 && narrated.outletCount >= 2;
  const variationAcrossOutlets = signatures.signatureCount >= 2;
  const status: ComparisonStatus = groups.length >= 2 && adequate && variationAcrossOutlets
    ? "difference_confirmed"
    : adequate
      ? "no_clear_difference"
      : "held_for_analysis";
  const label = DIM_LABEL[dimension] ?? dimension;
  const question = compareQuestion(label, groups.length >= 2 ? groups : sourceGroups);
  const reason = status === "difference_confirmed"
    ? `${label}에서 기자 서술이 확인된 ${narratedArticles.size}건·${narrated.outletCount}곳의 강조 묶음이 서로 달랐습니다.`
    : status === "no_clear_difference"
      ? groups.length >= 2
        ? "기사 단위의 다른 값은 보이지만, 매체별 서술 분포가 달라졌다고 확정할 만큼 일관된 차이는 확인되지 않았습니다."
        : `${label}은 분석 가능한 기자 서술 ${narratedArticles.size}건에서 하나의 설명 계열로 모였습니다.`
      : sourceGroups.length >= 2
        ? `${label}의 다른 설명은 취재원 발언에서만 확인되어 매체 자체의 차이로 세지 않았습니다.`
        : narratedArticles.size
          ? `${label}에서 비교할 수 있는 기자 서술이 ${narratedArticles.size}건·${narrated.outletCount}곳으로 충분하지 않습니다.`
          : "이 차원의 공개 근거가 없거나 분석 결과가 없어 비교를 보류합니다.";
  return {
    dimension,
    label,
    question,
    status,
    statusReason: reason,
    groups,
    sourceGroups,
    narratedArticleCount: narratedArticles.size,
    narratedOutletCount: narrated.outletCount,
    sourceArticleCount: sourceArticles.size,
    sourceOutletCount: source.outletCount,
    variationAcrossOutlets,
    differenceText: status === "difference_confirmed" ? differenceText(groups, narrated.outletCount) : reason,
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

function validSynthesisCoverage(claim: EventSynthesisClaim | null | undefined, bundle: IssueAnalysisBundle, expectedArticleCount: number) {
  const articleIds = new Set(
    (claim?.evidence ?? [])
      .filter((evidence) => typeof evidence.article_id === "string"
        && typeof evidence.sentence_sha256 === "string"
        && /^[a-f0-9]{64}$/i.test(evidence.sentence_sha256)
        && Boolean(evidence.locator)
        && Object.values(evidence.locator ?? {}).some((value) => typeof value === "number"))
      .map((evidence) => evidence.article_id as string),
  );
  const knownArticleIds = new Set((bundle.articles ?? []).map((article) => article.articleId));
  return articleIds.size >= expectedArticleCount
    && [...articleIds].every((articleId) => knownArticleIds.has(articleId));
}

export function comparisonSummary(bundle: IssueAnalysisBundle, issue: IssueView): ComparisonSummary {
  const dimensions = DIM_ORDER.map((dimension) => dimensionComparison(bundle, dimension));
  const rank: Record<ComparisonStatus, number> = {
    difference_confirmed: 0,
    no_clear_difference: 1,
    held_for_analysis: 2,
  };
  const ordered = [...dimensions].sort((a, b) =>
    rank[a.status] - rank[b.status]
    || b.groups.length - a.groups.length
    || b.narratedOutletCount - a.narratedOutletCount
    || b.narratedArticleCount - a.narratedArticleCount,
  );
  const chosen = ordered[0];
  const synthesis = bundle.comparison.data.synthesis;
  const commonCandidate = dimensions
    .flatMap((dimension) => dimension.groups)
    .filter((group) => group.articleCount >= 2 && group.outlets.length >= 2)
    .sort((a, b) => b.articleCount - a.articleCount || b.outlets.length - a.outlets.length)[0];
  const commonText = commonCandidate?.emphasis
    ?? (observedSynthesisClaim(synthesis?.common_ground) && validSynthesisCoverage(synthesis?.common_ground, bundle, issue.articleCount)
      ? observedSynthesisClaim(synthesis?.common_ground)
      : null);
  const commonObservations = commonCandidate?.observations ?? [];
  const commonScope = commonCandidate
    ? `${commonCandidate.articleCount}건·${commonCandidate.outlets.length}개 매체`
    : null;
  const status = chosen?.status ?? "held_for_analysis";
  const reviewRequired = bundleRequiresHumanReview(bundle);
  const groups = chosen?.status === "difference_confirmed" || chosen?.status === "no_clear_difference"
    ? chosen.groups
    : [];
  const sourceGroups = chosen?.sourceGroups ?? [];
  const difference = chosen?.differenceText
    ?? "기자 서술 근거가 없어 매체 간 강조 차이를 확정하지 않습니다.";
  const reviewNote = reviewRequired ? " 현재 공개 결과는 자동 분석 초안이므로 사람 검토 전 상태입니다." : "";
  const whatToNotice = status === "difference_confirmed"
    ? `${chosen?.label}에서 매체가 실제로 쓴 설명의 초점이 어떻게 갈렸는지, 각 묶음의 기사 근거를 확인하세요.`
    : status === "no_clear_difference"
      ? `${chosen?.label ?? "각 질문"}에서 분석 가능한 기자 서술이 같은 방향으로 모이는지와, 기사별 근거가 충분한지 확인하세요.`
      : "취재원 발언·분석 실패·공개 근거 부족을 매체 자체의 입장과 섞지 말고 기사별 상태를 먼저 확인하세요.";
  return {
    status,
    statusLabel: reviewRequired ? {
      difference_confirmed: "기자 서술 차이 관측 · 사람 검토 전",
      no_clear_difference: "뚜렷한 매체 차이 미관측 · 사람 검토 전",
      held_for_analysis: "비교 보류 · 분석 검토 전",
    }[status] : STATUS_LABEL[status],
    reviewRequired,
    statusReason: chosen?.statusReason ?? "비교할 수 있는 공개 분석 결과가 없습니다.",
    commonText,
    commonObservations,
    commonScope,
    differenceText: difference,
    whatToNotice: `${whatToNotice}${reviewNote}`,
    question: chosen?.question ?? "매체가 무엇을 다르게 강조했는지 확인할 수 있나?",
    dimensionLabel: chosen?.label ?? null,
    groups,
    sourceGroups,
    dimensions,
    analyzedArticleCount: chosen?.narratedArticleCount ?? 0,
    analyzedOutletCount: chosen?.narratedOutletCount ?? 0,
  };
}

export function comparisonStatusLabel(status: ComparisonStatus) {
  return STATUS_LABEL[status];
}

export function comparisonVoiceLabel(kind: string) {
  return VOICE_LABEL[kind] ?? "발화 범위 미관측";
}
