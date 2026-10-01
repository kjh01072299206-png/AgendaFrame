import {
  KOREAN_MORPHOLOGY_DICTIONARY_VERSION,
  KOREAN_MORPHOLOGY_MODE,
  KOREAN_MORPHOLOGY_VERSION,
  summarizeKoreanMorphology,
} from "../../worker/korean-morphology.mjs";
import { stripEvidenceTokens } from "./public-text.mjs";
import { hasValidPublicEvidence, semanticProfileEntryIsUsable } from "./analysis-summary";
import type { IssueAnalysisBundle, SemanticEvidenceSource } from "./types";

export type ParaphraseObservationRef = {
  observationId: string;
  articleId: string;
  claimId: string;
  dimension: string;
  voiceKind: "journalist_narration";
  evidence: {
    locator: { paragraph: number; sentence: number };
    sentence_sha256: string;
  };
  model: string | null;
  engineVersion: string | null;
  promptVersion: string;
  schemaVersion: number;
};

export type ParaphraseTerm = {
  id: string;
  term: string;
  pos: string;
  count: number;
  paraphraseCount: number;
  articleCount: number;
  observations: ParaphraseObservationRef[];
};

export type ParaphraseNetworkEdge = {
  source: string;
  target: string;
  weight: number;
  observations: ParaphraseObservationRef[];
};

export type ParaphraseLinguisticAnalysis = {
  inputLabel: "saved_public_paraphrases";
  analyzer: {
    mode: string;
    version: string;
    dictionaryVersion: string;
    limitation: string;
    maxTermsPerParaphrase: number;
  };
  issueArticleCount: number;
  analyzedArticleCount: number;
  analyzedProfileCount: number;
  validParaphraseCount: number;
  excludedSourceObservationCount: number;
  omittedProfileCount: number;
  issueSemanticStatus: string;
  reviewRequiredProfileCount: number;
  analysisRuns: Array<{
    model: string | null;
    engineVersion: string | null;
    promptVersion: string;
    schemaVersion: number;
  }>;
  terms: ParaphraseTerm[];
  network: {
    nodes: Array<{ id: string; label: string; count: number; articleCount: number }>;
    edges: ParaphraseNetworkEdge[];
  };
};

type ValidatedParaphrase = {
  text: string;
  ref: ParaphraseObservationRef;
  termFrequencies: Array<{ term: string; pos: string; count: number }>;
  reviewRequired: boolean;
};

const SOURCE_VOICES = new Set([
  "direct_quote",
  "indirect_source",
  "uncertain_quote",
  "source_attributed",
  "mixed",
]);

function stableTextCompare(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function checkedEvidence(evidence: SemanticEvidenceSource | undefined, entryEvidence: IssueAnalysisBundle["semanticProfiles"][number]["evidence"]) {
  if (!hasValidPublicEvidence(evidence, entryEvidence) || !evidence.locator) return null;
  const paragraph = evidence.locator.paragraph;
  const sentence = evidence.locator.sentence;
  const hash = evidence.sentence_sha256;
  if (!Number.isInteger(paragraph) || !Number.isInteger(sentence) || typeof hash !== "string") return null;
  return {
    locator: { paragraph: paragraph as number, sentence: sentence as number },
    sentence_sha256: hash.toLowerCase(),
  };
}

function dimensionsFor(bundle: IssueAnalysisBundle) {
  const result: ValidatedParaphrase[] = [];
  const sourceObservationIds = new Set<string>();
  const articleIds = new Set(bundle.articles.map((article) => article.articleId));
  const seen = new Map<string, string>();
  const conflictingObservationIds = new Set<string>();

  for (const entry of bundle.semanticProfiles ?? []) {
    const profile = entry.profile;
    if (!profile || !semanticProfileEntryIsUsable(entry)) continue;
    if (entry.engine.semanticAi !== true && profile.engine?.semantic_ai !== true) continue;
    if (!articleIds.has(entry.articleId)) continue;
    const promptVersion = profile.engine?.prompt_version;
    const schemaVersion = profile.engine?.analysis_schema_version;
    if (typeof promptVersion !== "string" || !promptVersion.trim() || typeof schemaVersion !== "number") continue;

    const run = {
      model: entry.engine.model ?? null,
      engineVersion: profile.engine?.version ?? null,
      promptVersion,
      schemaVersion,
    };

    for (const [dimension, node] of Object.entries(profile.dimensions ?? {})) {
      if (["queued", "running", "retry_wait", "review_needed", "dead_letter", "failed"].includes(node.status ?? "")) continue;
      if (node.model_status && node.model_status !== "supported") continue;
      for (const item of node.items ?? []) {
        const voice = item.voice?.kind;
        const evidence = checkedEvidence(item.evidence, entry.evidence);
        const claimId = typeof item.claim_id === "string" ? item.claim_id.trim() : "";
        if (!evidence || !claimId) continue;
        const observationId = `${entry.articleId}:${claimId}:${dimension}:${evidence.locator.paragraph}.${evidence.locator.sentence}:${evidence.sentence_sha256}`;
        if (voice !== "journalist_narration") {
          if (voice && SOURCE_VOICES.has(voice)) sourceObservationIds.add(observationId);
          continue;
        }
        const publicParaphrase = typeof item.public_paraphrase === "string"
          ? stripEvidenceTokens(item.public_paraphrase).trim()
          : "";
        if (!publicParaphrase || publicParaphrase.length > 500) continue;
        const previousParaphrase = seen.get(observationId);
        if (previousParaphrase !== undefined) {
          if (previousParaphrase !== publicParaphrase) conflictingObservationIds.add(observationId);
          continue;
        }
        seen.set(observationId, publicParaphrase);
        const morphology = summarizeKoreanMorphology([{ text: publicParaphrase }]);
        const termFrequencies = morphology.term_frequencies.map((row) => ({ term: row.term, pos: row.pos, count: row.count }));
        if (!termFrequencies.length) continue;
        const ref: ParaphraseObservationRef = {
          observationId,
          articleId: entry.articleId,
          claimId,
          dimension,
          voiceKind: "journalist_narration",
          evidence,
          ...run,
        };
        result.push({
          text: publicParaphrase,
          ref,
          termFrequencies,
          reviewRequired: Boolean(entry.engine.reviewRequired || profile.review?.requires_human_review),
        });
      }
    }
  }

  const observations = result.filter((row) => !conflictingObservationIds.has(row.ref.observationId));
  const analyzedArticles = new Set(observations.map((row) => row.ref.articleId));
  const analyzedProfiles = new Set(observations.map((row) => row.ref.articleId));
  const reviewRequiredProfiles = new Set(observations.filter((row) => row.reviewRequired).map((row) => row.ref.articleId));
  const runs = new Map<string, ParaphraseLinguisticAnalysis["analysisRuns"][number]>();
  for (const row of observations) {
    const run = {
      model: row.ref.model,
      engineVersion: row.ref.engineVersion,
      promptVersion: row.ref.promptVersion,
      schemaVersion: row.ref.schemaVersion,
    };
    runs.set([run.model, run.engineVersion, run.promptVersion, run.schemaVersion].join("|"), run);
  }
  const articleProfileCount = new Set(bundle.semanticProfiles.map((entry) => entry.articleId)).size;
  return {
    observations,
    sourceObservationCount: sourceObservationIds.size,
    analyzedArticleCount: analyzedArticles.size,
    analyzedProfileCount: analyzedProfiles.size,
    reviewRequiredProfileCount: reviewRequiredProfiles.size,
    omittedProfileCount: Math.max(0, articleProfileCount - analyzedProfiles.size),
    runs: [...runs.values()].sort((left, right) => stableTextCompare(`${left.model}|${left.engineVersion}|${left.promptVersion}|${left.schemaVersion}`, `${right.model}|${right.engineVersion}|${right.promptVersion}|${right.schemaVersion}`)),
  };
}

export function buildParaphraseLinguisticAnalysis(bundle: IssueAnalysisBundle): ParaphraseLinguisticAnalysis {
  const collected = dimensionsFor(bundle);
  const analyzerSummary = summarizeKoreanMorphology([]);
  const termMap = new Map<string, { term: string; pos: string; count: number; observations: Map<string, ParaphraseObservationRef> }>();
  const edgeMap = new Map<string, { source: string; target: string; weight: number; observations: Map<string, ParaphraseObservationRef> }>();

  for (const observation of collected.observations) {
    const terms = observation.termFrequencies.map((row) => ({ ...row, id: `${row.pos}:${row.term}` }));
    for (const row of terms) {
      const current = termMap.get(row.id) ?? { term: row.term, pos: row.pos, count: 0, observations: new Map<string, ParaphraseObservationRef>() };
      current.count += row.count;
      current.observations.set(observation.ref.observationId, observation.ref);
      termMap.set(row.id, current);
    }
    for (let leftIndex = 0; leftIndex < terms.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < terms.length; rightIndex += 1) {
        const [source, target] = [terms[leftIndex].id, terms[rightIndex].id].sort(stableTextCompare);
        const key = `${source}\u0000${target}`;
        const current = edgeMap.get(key) ?? { source, target, weight: 0, observations: new Map<string, ParaphraseObservationRef>() };
        if (!current.observations.has(observation.ref.observationId)) current.weight += 1;
        current.observations.set(observation.ref.observationId, observation.ref);
        edgeMap.set(key, current);
      }
    }
  }

  const terms = [...termMap.entries()].map(([id, row]): ParaphraseTerm => {
    const observations = [...row.observations.values()].sort((left, right) => stableTextCompare(left.observationId, right.observationId));
    return {
      id,
      term: row.term,
      pos: row.pos,
      count: row.count,
      paraphraseCount: observations.length,
      articleCount: new Set(observations.map((observation) => observation.articleId)).size,
      observations,
    };
  }).sort((left, right) => right.count - left.count || stableTextCompare(left.term, right.term) || stableTextCompare(left.pos, right.pos));
  const edges = [...edgeMap.values()].map((edge): ParaphraseNetworkEdge => ({
    ...edge,
    observations: [...edge.observations.values()].sort((left, right) => stableTextCompare(left.observationId, right.observationId)),
  })).sort((left, right) => right.weight - left.weight || stableTextCompare(left.source, right.source) || stableTextCompare(left.target, right.target));

  return {
    inputLabel: "saved_public_paraphrases",
    analyzer: {
      mode: KOREAN_MORPHOLOGY_MODE,
      version: KOREAN_MORPHOLOGY_VERSION,
      dictionaryVersion: KOREAN_MORPHOLOGY_DICTIONARY_VERSION,
      limitation: analyzerSummary.limitation,
      maxTermsPerParaphrase: 40,
    },
    issueArticleCount: bundle.issue.articleCount,
    analyzedArticleCount: collected.analyzedArticleCount,
    analyzedProfileCount: collected.analyzedProfileCount,
    validParaphraseCount: collected.observations.length,
    excludedSourceObservationCount: collected.sourceObservationCount,
    omittedProfileCount: collected.omittedProfileCount,
    issueSemanticStatus: bundle.analysisStatus.semantic.status,
    reviewRequiredProfileCount: collected.reviewRequiredProfileCount,
    analysisRuns: collected.runs,
    terms,
    network: {
      nodes: terms.map((term) => ({ id: term.id, label: term.term, count: term.paraphraseCount, articleCount: term.articleCount })),
      edges,
    },
  };
}
