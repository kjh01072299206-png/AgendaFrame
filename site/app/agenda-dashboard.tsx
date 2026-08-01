"use client";

import { FormEvent, KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CommunityPanel } from "./community-panel";
import { EvidenceChat } from "./evidence-chat";
import { SelfCheck } from "./self-check";
import top5PilotData from "../data/top5-2026-07-26.json";

type Health = {
  status: string;
  mode: "demo" | "live_metadata" | "unavailable";
  dataAsOf: string | null;
  collection: { articleCount: number; authorizedContentCount: number; transientEvidenceCount: number; bodyEvidenceCount: number; configuredSources: number; latestSourceCount: number; latestStatus: string };
  analysis?: { id: string; targetDate: string; provider: string; modelVersion: string; finishedAt: number; articleCount: number; issueCount: number } | null;
  freshness: { status: "normal" | "collection_delayed" | "partial_collection" | "analysis_pending" | "stale_snapshot"; label: string; staleDays: number | null };
  timestamps: { collectedAt: string | null; analyzedAt: number | null; publishedAt: number | null; nextScheduledAt: number | null };
};

type Source = {
  id: string;
  name: string;
  sampleOrder: number;
  sourceType: "general_daily" | "business_media" | "news_agency";
  sourceTypeLabel: string;
  mediaGroupId: string;
  mediaGroupLabel: string;
  active: boolean;
};

type Issue = {
  id: string;
  issueDate: string;
  title: string;
  summary: string;
  category: string;
  articleCount: number;
  sourceCount: number;
  agendaScore: number | null;
  diversityScore: number;
  placementScore: number | null;
  volumeScore: number;
  repetitionScore: number;
  followUpVolumeScore: number;
  placementObservedCount: number;
  placementTotalCount: number;
  scoreStatus: "legacy_reanalysis_required" | "observed_components" | "scope_observed_components" | "placement_excluded";
  calibrationStatus: "not_calibrated";
  clusterQuality: "review_required" | "not_human_reviewed" | "cohesive" | "insufficient_evidence";
  contentAvailableCount: number;
  evidenceBasis: "headline_metadata_only" | "body_signals_and_metadata" | "structured_body_profiles_and_metadata";
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
  placementObservationCount?: number;
  contentAvailable?: number | boolean;
  representative?: number;
  similarity?: number;
};

type Frame = { frame: string; score: number; calibrationStatus: string; evidenceBasis: "headline" | "body_private" | "body_public" | "body_transient"; evidenceText?: string | null; source?: string | null; articleId?: string | null; sourceUrl?: string | null };
type ClaimEvidence = {
  claimId: string;
  articleId: string;
  source: string;
  sourceUrl: string;
  evidenceLocator: string | null;
  evidenceHash: string | null;
  voiceKind: string | null;
};
type IssueMapAnchor = {
  groupId: string;
  label: string;
  frameFamily: string | null;
  articleCount: number;
  outletCount: number;
  independentMediaGroups: number;
  claimIds: string[];
  evidence: ClaimEvidence[];
};
type IssueMapOutlet = {
  sourceId: string;
  source: string;
  classification: "left" | "mixed" | "right" | "insufficient";
  score: number | null;
  displayPosition: number | null;
  articleCount: number;
  eligibleArticleCount: number;
  leftArticleCount: number;
  mixedArticleCount: number;
  rightArticleCount: number;
  evidenceStatus: "insufficient" | "single_article_observation" | "automatic_draft" | "supported";
  claimIds: string[];
  evidence: ClaimEvidence[];
};
type IssueMap = {
  status: "available" | "provisional" | "withheld_insufficient_evidence" | "withheld_source_dominated" | "withheld_review_required";
  reason: string;
  axisId: string | null;
  dimension: "problem_definition";
  label: string;
  leftAnchor: IssueMapAnchor | null;
  rightAnchor: IssueMapAnchor | null;
  selectionBasis: {
    minimumArticles: number;
    minimumOutlets: number;
    minimumIndependentMediaGroups: number;
    minimumArticlesPerAnchor: number;
    articleCount: number;
    outletCount: number;
    independentMediaGroups: number;
    balancedCoverage: number | null;
    overlap: number | null;
    axisStrength: number | null;
    coveredArticleCount: number;
    formula: string | null;
  };
  outlets: IssueMapOutlet[];
};
type NarrativeClause = {
  dimension: string;
  label: string;
  groupId: string;
  summary: string;
  supportingArticleCount: number;
  observedArticleCount: number;
  supportShare: number;
  claimIds: string[];
  evidence: ClaimEvidence[];
};
type Narrative = {
  narrativeId: string;
  status: "automatic_draft" | "supported";
  summary: string;
  articleCount: number;
  outletCount: number;
  independentMediaGroups: number;
  completeness: number;
  supportingArticleIds: string[];
  supportingOutlets: string[];
  claimIds: string[];
  evidence: ClaimEvidence[];
  problem: NarrativeClause;
  cause: NarrativeClause | null;
  responsibility: NarrativeClause | null;
  evaluation: NarrativeClause | null;
  remedy: NarrativeClause | null;
};
type ReaderQuestion = {
  questionId: string;
  triggerType: "narrative_contrast" | "issue_axis_contrast" | "affected_voice_gap" | "source_voice_gap" | "context_gap";
  question: string;
  basisClaimIds: string[];
  basisArticleIds: string[];
  evidence: ClaimEvidence[];
};
type ComparisonSource = {
  source: string;
  articleId: string;
  sourceUrl: string;
  claimId: string;
  evidenceLocator?: string | null;
  evidenceHash?: string | null;
  voiceKind?: string | null;
};
type ComparisonAxis = {
  dimension: string;
  label: string;
  variants: Array<{
    groupId: string;
    frameFamily: string | null;
    claimIds: string[];
    summary: string;
    outlets: ComparisonSource[];
    commitment: string;
    status: string;
    evidenceLocator?: string | null;
    basis?: string | null;
  }>;
};
type Comparison = {
  status: string;
  lineage?: {
    modelId: string;
    promptVersion: string;
    analysisSchemaVersion: string;
    comparisonEngineVersion: string;
    approval: null | {
      authorizationId: string;
      fingerprint: string;
      clusterId: string;
      reviewer: string;
      reviewedAt: string;
      approvedUrlsSha256: string;
    };
  };
  divergenceDetected?: boolean;
  evidenceBasis?: "headline_metadata_only" | "body_signals_not_structured_comparison" | "evidence_spans" | string;
  reason?: string;
  commonFacts?: Array<{ id: string; text: string; articleCount: number; sourceCount: number; evidence: Array<{ articleId: string; source: string; sourceUrl: string; text: string }> }>;
  divergenceQuestions?: Array<{ id: string; question: string; status: string; answerGroups: Array<{ id: string; label: string; sources: string[]; evidence: Array<{ articleId: string; source: string; sourceUrl: string; text: string }> }> }>;
  sourceVoices?: Array<{ sourceType: string; people: string[]; supports: string; evidence: Array<{ articleId: string; sourceUrl: string; text: string }> }>;
  recommendedPair?: null | { primary: Article; complement: Article; reason: string };
  availableHeadlineEvidence?: Array<{ articleId: string; source: string; sourceUrl: string; text: string }>;
  methodologyLabel?: string;
  reviewStatus?: string;
  summary?: {
    commonGround?: string | null;
    mainDifference?: string | null;
    whyItMatters?: string | null;
    sourceContext?: string | null;
  };
  sample?: {
    analyzedArticles: number;
    textScope?: "provider_excerpt" | "article_body" | string;
    outlets: number;
    independentMediaGroups: number;
    excludedArticles: number;
    inputTruncatedArticles?: number;
  };
  axes?: ComparisonAxis[];
  issueMap?: IssueMap;
  narratives?: Narrative[];
  readerQuestions?: ReaderQuestion[];
  sourceLens?: {
    sharedVoices: string[];
    voicesPresentInSomeOutlets: string[];
    byOutlet: Array<{
      source: string;
      articleCount: number;
      sourceArticleCount: number;
      voices: string[];
      roleCounts: Array<{
        role: string;
        roleLabel: string;
        count: number;
        articleCount: number;
        presenceRate: number;
        directQuoteArticleCount: number;
        indirectAttributionArticleCount: number;
        mentionCount: number;
      }>;
      officialShare: number | null;
      affectedGroupVoice: boolean;
      affectedGroupPresenceRate: number;
    }>;
    caution: string | null;
  };
  contextGaps?: Array<{
    feature: string;
    presentInOutlets: string[];
    notObservedInOutlets: string[];
    displayText: string;
  }>;
  limitations?: string[];
};
type IssueDetail = {
  issue: Issue & { provider: string; modelVersion: string; analyzedAt: number };
  articles: Article[];
  frames: Frame[];
  report: { summary: string; missingPerspective: string; caution: string; provider: string; modelVersion: string } | null;
  outlets: Array<{ source: string; articleCount: number; placement: string }>;
  comparison: Comparison;
};

type AnalysisTab = "compare" | "outlets" | "frames" | "articles" | "chat" | "selfcheck" | "community";
type IssueDateOption = { date: string; analyzedAt: number | null; articleCount: number; issueCount: number };
type ArticleFilters = { q: string; source: string; section: string; articleDate: string };

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
const sourceRoleColors: Record<string, string> = {
  government_official: "#3f5c96",
  political_actor: "#a84052",
  judiciary_law_enforcement: "#5b4a8f",
  expert_research: "#7a5aa8",
  civil_society: "#3d7d4f",
  business: "#b0812c",
  affected_person: "#2b7f8e",
  anonymous_official: "#6b7280",
  other: "#9099a6",
};
const placementLabels: Record<string, string> = { top: "최상단", main: "주요 영역", section: "섹션", list: "목록" };
const outletPlacementLabels: Record<string, string> = { TOP: "최상단", MAIN: "주요 영역", SECTION: "섹션", LIST: "목록", 미확인: "관측 없음" };

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

function formatAgendaDate(value?: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "분석일";
  const [, month, day] = value.split("-");
  return `${Number(month)}월 ${Number(day)}일`;
}

const ISSUE_SCOPE = "general_daily_10";
const ISSUE_SCOPE_LABEL = "국내 10대 종합일간지";
type Top5PilotIssue = (typeof top5PilotData.issues)[number];

function normalizedArticleUrl(value?: string | null) {
  if (!value) return "";
  try {
    const url = new URL(value);
    [...url.searchParams.keys()]
      .filter((key) => key.toLowerCase().startsWith("utm_") || ["ref", "source", "fbclid", "gclid"].includes(key.toLowerCase()))
      .forEach((key) => url.searchParams.delete(key));
    url.hash = "";
    return url.toString().replace(/\/$/u, "");
  } catch {
    return String(value).trim();
  }
}

function findTop5PilotIssue(detail: IssueDetail): Top5PilotIssue | null {
  if (detail.issue.issueDate !== "2026-07-26") return null;
  const articleUrls = new Set(detail.articles.map((article) => normalizedArticleUrl(article.url)));
  const ranked = top5PilotData.issues
    .map((candidate) => ({
      candidate,
      overlap: candidate.articleMetadata.filter((article) => articleUrls.has(normalizedArticleUrl(article.canonicalUrl))).length,
    }))
    .sort((left, right) => right.overlap - left.overlap || left.candidate.rank - right.candidate.rank);
  const best = ranked[0];
  return best && best.overlap >= 2 ? best.candidate : null;
}

function pilotComparisonToPublic(pilotIssue: Top5PilotIssue, articles: Article[]): Comparison {
  const pilot = pilotIssue.comparison;
  const metadataById = new Map(pilotIssue.articleMetadata.map((article) => [article.articleId, article]));
  const articleByUrl = new Map(articles.map((article) => [normalizedArticleUrl(article.url), article]));
  const sourceForArticle = (articleId: string) => {
    const metadata = metadataById.get(articleId);
    const article = metadata ? articleByUrl.get(normalizedArticleUrl(metadata.canonicalUrl)) : undefined;
    return {
      source: metadata?.source ?? article?.source ?? "출처 미확인",
      sourceUrl: metadata?.canonicalUrl ?? article?.url ?? "#",
    };
  };
  const toEvidence = (pattern: (typeof pilot.comparison_axes)[number]["patterns"][number]) => (pattern.evidence ?? []).map((evidence) => {
    const source = sourceForArticle(evidence.article_id);
    return {
      source: source.source,
      articleId: evidence.article_id,
      sourceUrl: source.sourceUrl,
      claimId: pattern.variant_key,
      evidenceLocator: evidence.locator ? `${evidence.locator.paragraph}문단 ${evidence.locator.sentence}문장` : null,
      evidenceHash: evidence.sentence_sha256 ?? null,
      voiceKind: pattern.voice_scope === "outlet_narration" ? "journalist_narration" : "source_attributed",
    };
  });
  const axes: ComparisonAxis[] = pilot.comparison_axes.map((axis) => ({
    dimension: axis.dimension,
    label: axis.label,
    variants: axis.patterns.map((pattern) => ({
      groupId: pattern.variant_key,
      frameFamily: pattern.code,
      claimIds: [pattern.variant_key],
      summary: pattern.public_paraphrase,
      outlets: toEvidence(pattern),
      commitment: pattern.voice_scope === "outlet_narration" ? "explicit" : "source_attributed",
      status: pattern.voice_scope === "outlet_narration" ? "supported" : "attributed_source",
      evidenceLocator: pattern.evidence?.[0]?.locator ? `${pattern.evidence[0].locator.paragraph}문단 ${pattern.evidence[0].locator.sentence}문장` : null,
      basis: "기사 본문 위치·비복원 지문 확인 · 원문 문장 미저장",
    })),
  }));
  const articleCountBySource = new Map<string, number>();
  for (const article of pilotIssue.articleMetadata) articleCountBySource.set(article.source, (articleCountBySource.get(article.source) ?? 0) + 1);
  const roleArticlesBySource = new Map<string, Map<string, Set<string>>>();
  for (const profile of pilotIssue.profiles) {
    const metadata = metadataById.get(profile.article.article_id);
    if (!metadata) continue;
    const observedRoles = new Set<string>();
    const dimensions = Object.values(profile.dimensions) as Array<{ items?: Array<{ voice?: { speaker_role?: string | null } | null }> }>;
    for (const dimension of dimensions) {
      for (const item of dimension.items ?? []) {
        if (item.voice?.speaker_role) observedRoles.add(item.voice.speaker_role);
      }
    }
    const sourceRoles = roleArticlesBySource.get(metadata.source) ?? new Map<string, Set<string>>();
    for (const role of observedRoles) {
      const articleIds = sourceRoles.get(role) ?? new Set<string>();
      articleIds.add(profile.article.article_id);
      sourceRoles.set(role, articleIds);
    }
    roleArticlesBySource.set(metadata.source, sourceRoles);
  }
  const roles = pilot.source_lens?.roles ?? [];
  const sourceLens = pilot.source_lens ? {
    sharedVoices: roles.filter((role) => role.outlet_count >= pilot.sample.outlet_count).map((role) => role.role_label),
    voicesPresentInSomeOutlets: roles.filter((role) => role.outlet_count > 0 && role.outlet_count < pilot.sample.outlet_count).map((role) => role.role_label),
    byOutlet: (pilot.source_lens.by_outlet ?? []).map((entry) => {
      const articleCount = articleCountBySource.get(entry.outlet) ?? 0;
      const roleArticles = roleArticlesBySource.get(entry.outlet) ?? new Map<string, Set<string>>();
      return {
        source: entry.outlet,
        articleCount,
        sourceArticleCount: articleCount,
        voices: entry.roles.map((role) => role.role_label),
        roleCounts: entry.roles.map((role) => ({
          role: role.role,
          roleLabel: role.role_label,
          count: roleArticles.get(role.role)?.size ?? 0,
          articleCount: roleArticles.get(role.role)?.size ?? 0,
          presenceRate: articleCount ? (roleArticles.get(role.role)?.size ?? 0) / articleCount : 0,
          directQuoteArticleCount: 0,
          indirectAttributionArticleCount: 0,
          mentionCount: role.count,
        })),
        officialShare: null,
        affectedGroupVoice: false,
        affectedGroupPresenceRate: 0,
      };
    }),
    caution: pilot.source_lens.caution ?? null,
  } : undefined;
  const reviewStatus = pilot.review?.cluster_status === "review_required" ? "cluster_review_required" : "automatic_draft";
  return {
    status: "provisional",
    lineage: {
      modelId: "korean-evidence-rules-v2",
      promptVersion: "framing-codebook-v5",
      analysisSchemaVersion: "agendaframe.issue-frame-comparison.v1",
      comparisonEngineVersion: "korean-evidence-rules-v2",
      approval: null,
    },
    divergenceDetected: Boolean(pilot.summary_30_seconds?.divergence_detected),
    evidenceBasis: "evidence_spans",
    methodologyLabel: "본문 기반 구조화 추출",
    reviewStatus,
    summary: {
      commonGround: pilot.summary_30_seconds?.common_ground ?? null,
      mainDifference: pilot.summary_30_seconds?.main_difference ?? null,
      whyItMatters: "이 결과는 사람 검토 전 자동 분석 초안입니다. 매체의 의도나 정치적 성향이 아니라, 분석한 본문에서 확인된 설명 요소만 비교합니다.",
      sourceContext: pilot.summary_30_seconds?.source_context ?? null,
    },
    sample: {
      analyzedArticles: pilot.sample.article_count,
      textScope: "article_body",
      outlets: pilot.sample.outlet_count,
      independentMediaGroups: pilot.sample.independent_media_group_count,
      excludedArticles: pilot.sample.short_body_article_count,
      inputTruncatedArticles: 0,
    },
    axes,
    sourceLens,
    limitations: [
      pilot.summary_30_seconds?.limit ?? "자동 추출 결과이며 사람 검토 전입니다.",
      "같은 사건으로 묶인 기사 집합의 경계가 검토되기 전이므로, 매체 간 차이를 최종 판정으로 해석하지 마세요.",
      "본문 전문은 공개하거나 저장하지 않고 기사별 위치와 비복원 지문으로만 근거를 연결합니다.",
    ],
  };
}

function applyTop5Pilot(detail: IssueDetail): IssueDetail {
  const pilotIssue = findTop5PilotIssue(detail);
  if (!pilotIssue) return detail;
  const pilotUrls = new Set(pilotIssue.articleMetadata.map((article) => normalizedArticleUrl(article.canonicalUrl)));
  const articles = detail.articles.map((article) => ({
    ...article,
    contentAvailable: pilotUrls.has(normalizedArticleUrl(article.url)) ? 1 : article.contentAvailable,
  }));
  return {
    ...detail,
    issue: {
      ...detail.issue,
      contentAvailableCount: pilotIssue.articleCount,
      evidenceBasis: "structured_body_profiles_and_metadata",
      clusterQuality: pilotIssue.clusterQuality === "review_required" ? "review_required" : "cohesive",
      modelVersion: "korean-evidence-rules-v2",
      provider: "structured_extractive",
    },
    articles,
    comparison: pilotComparisonToPublic(pilotIssue, articles),
  };
}

type ClusterDiagnostic = {
  tone: "ok" | "watch" | "caution";
  label: string;
  reason: string;
  articleCount: number;
  minSimilarity: number | null;
  medianSimilarity: number | null;
};

function getClusterDiagnostic(detail: IssueDetail): ClusterDiagnostic {
  const similarities = detail.articles
    .map((article) => article.similarity)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
    .sort((left, right) => left - right);
  const toPercent = (value: number | undefined) => value === undefined ? null : Math.round(Math.max(0, Math.min(1, value)) * 100);
  const minSimilarity = toPercent(similarities[0]);
  const medianSimilarity = toPercent(similarities.length ? similarities[Math.floor((similarities.length - 1) / 2)] : undefined);
  if (!similarities.length) {
    return {
      tone: "watch",
      label: "유사도 자료 부족",
      reason: "현재 응답에 기사별 제목 유사도가 없어 묶음 응집도를 확인할 수 없습니다.",
      articleCount: detail.articles.length,
      minSimilarity,
      medianSimilarity,
    };
  }
  if (detail.issue.clusterQuality === "review_required" || (minSimilarity ?? 100) < 25) {
    return {
      tone: "caution",
      label: "묶음 검토 필요",
      reason: "대표 제목과의 유사도가 낮은 기사가 포함되어 있어, 후속 보도나 관련 사건이 함께 묶였는지 확인해야 합니다.",
      articleCount: detail.articles.length,
      minSimilarity,
      medianSimilarity,
    };
  }
  if ((minSimilarity ?? 100) < 40) {
    return {
      tone: "watch",
      label: "유사도 편차 있음",
      reason: "기사 수가 적더라도 제목의 사건·행동이 충분히 겹치는지 확인한 뒤 비교 결과를 읽어 주세요.",
      articleCount: detail.articles.length,
      minSimilarity,
      medianSimilarity,
    };
  }
  return {
    tone: "ok",
    label: "상대적으로 응집된 묶음",
    reason: "제목 유사도가 비교적 고르게 나타납니다. 최종 사건 동일성은 사람 검토 전입니다.",
    articleCount: detail.articles.length,
    minSimilarity,
    medianSimilarity,
  };
}

function naturalIssueTitle(value?: string | null) {
  const normalized = String(value ?? "")
    .replace(/\[[^\]]*\]|\([^)]*\)|<[^>]*>/g, " ")
    .replace(/["“”‘’']/gu, " ")
    .replace(/`/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s+(?:관련\s+)?이슈$/u, "")
    .trim();
  const words = normalized.split(/\s+/).filter(Boolean);
  const deduped: string[] = [];
  for (const word of words) {
    const previous = deduped.at(-1);
    if (!previous || previous === word) {
      if (!previous) deduped.push(word);
      continue;
    }
    if (word.length >= 2 && previous.length >= 2 && (previous.endsWith(word) || word.endsWith(previous)) && Math.abs(previous.length - word.length) <= 2) {
      if (word.length > previous.length) deduped[deduped.length - 1] = word;
      continue;
    }
    deduped.push(word);
  }
  const title = deduped.join(" ").trim();
  if (title.length <= 58) return title || "주요 의제";
  const firstClause = title.split(/\s*[|·]\s*|\s+[―–—]\s+/u)[0]?.trim();
  if (firstClause && firstClause.length >= 10 && firstClause.length <= 58) return firstClause;
  return `${title.slice(0, 57).trimEnd()}…`;
}

function ScorePart({ label, value, note }: { label: string; value: number | null; note?: string }) {
  return (
    <div className="score-part">
      <header><span>{label}</span><b>{value === null ? "미확인" : value.toFixed(1)}</b></header>
      <div className="score-track"><i style={{ width: `${value === null ? 0 : Math.max(0, Math.min(100, value))}%` }} /></div>
      {note && <small>{note}</small>}
    </div>
  );
}

const analysisTabs: Array<[AnalysisTab, string]> = [
  ["compare", "프레이밍 분석"],
  ["outlets", "매체 비교"],
  ["frames", "보조 프레임 태그"],
  ["articles", "관련 기사"],
  ["chat", "AI 대화"],
  ["selfcheck", "자기점검"],
  ["community", "커뮤니티"],
];
const agendaCategoryOrder = ["정치", "경제", "사회", "국제", "스포츠", "생활·IT"];

const statusLabels: Record<string, string> = {
  available: "구조화 비교 가능",
  provisional: "자동 분석 초안",
  partial: "일부 비교 가능",
  withheld_insufficient_evidence: "근거 부족으로 보류",
  withheld_source_dominated: "취재원 발언 중심이라 보류",
  withheld_review_required: "동일 사건 검토 대기",
  supported: "근거 확인",
  automatic_draft: "자동 분석 초안",
  single_article_observation: "기사 1건 관측",
  insufficient: "근거 부족",
  abstained: "판단 보류",
  conflicting: "근거가 엇갈림",
  not_observed: "본문에서 미관측",
  attributed_source: "취재원 발언에서 확인",
};

const reviewLabels: Record<string, string> = {
  human_reviewed: "사람 검토 완료",
  reviewed: "사람 검토 완료",
  ai_draft: "AI 분석 초안",
  automatic_draft: "자동 구조화 초안",
  review_required: "사람 검토 필요",
  cluster_review_required: "동일 사건 검토 대기",
  not_human_reviewed: "사람 검토 전",
  pending: "검토 대기",
};

const commitmentLabels: Record<string, string> = {
  explicit: "명시적 서술",
  source_attributed: "취재원 귀속 발언",
  implicit: "간접적 서술",
  mixed: "명시·간접 혼합",
  uncertain: "판정 유보",
  not_observed: "본문에서 미관측",
};

const issueMapClassLabels: Record<IssueMapOutlet["classification"], string> = {
  left: "왼쪽 문제 정의에 더 연결",
  mixed: "두 문제 정의가 함께 관측",
  right: "오른쪽 문제 정의에 더 연결",
  insufficient: "위치 판단 근거 부족",
};

const readerQuestionLabels: Record<ReaderQuestion["triggerType"], string> = {
  narrative_contrast: "서사 연결 차이",
  issue_axis_contrast: "문제 정의 차이",
  affected_voice_gap: "당사자 목소리 차이",
  source_voice_gap: "취재원 구성 차이",
  context_gap: "맥락 관측 차이",
};

function readableCode(value?: string | null, labels: Record<string, string> = {}) {
  if (!value) return null;
  return labels[value] ?? value.replaceAll("_", " ");
}

function formatShare(value?: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const percentage = value <= 1 ? value * 100 : value;
  return `${Math.round(Math.max(0, Math.min(100, percentage)))}%`;
}

function affectedVoiceLabel(value?: boolean | number | string | null) {
  if (typeof value === "boolean") return value ? "당사자 목소리 있음" : "당사자 목소리 미관측";
  if (typeof value === "number") {
    const share = formatShare(value);
    return share ? `당사자 등장 기사 비율 ${share}` : null;
  }
  return value || null;
}

function hasStructuredComparison(comparison: Comparison) {
  return Boolean(
    comparison.methodologyLabel
    || comparison.summary
    || comparison.axes?.length
    || comparison.issueMap
    || comparison.narratives?.length
    || comparison.readerQuestions?.length
    || comparison.sourceLens
    || comparison.contextGaps?.length
    || comparison.limitations?.length
  );
}

function ComparisonSourceLinks({ outlets }: { outlets: ComparisonSource[] }) {
  return (
    <ul className="comparison-source-links" aria-label="이 설명을 뒷받침하는 기사">
      {outlets.map((outlet, index) => (
        <li key={`${outlet.articleId}-${index}`}>
          <a href={outlet.sourceUrl} target="_blank" rel="noopener noreferrer">
            {outlet.source}<span className="sr-only"> 원문 새 창에서 열기</span>
          </a>
          {outlet.evidenceLocator && <small>{outlet.evidenceLocator}{outlet.evidenceHash ? ` · ${outlet.evidenceHash.slice(0, 12)}` : ""}</small>}
        </li>
      ))}
    </ul>
  );
}

function SourcingBars({ byOutlet }: { byOutlet: NonNullable<Comparison["sourceLens"]>["byOutlet"] }) {
  const rows = byOutlet.filter((entry) => entry.roleCounts.length > 0);
  if (rows.length < 2) return null;
  return (
    <div className="sourcing-bars">
      <h4>누구의 목소리로 말하는가 <small>역할별 기사 등장률</small></h4>
      <p className="viz-caption">같은 역할이 한 기사에서 여러 번 인용돼도 기사 한 건으로 셉니다. 비율은 각 언론사의 분석 기사 중 해당 역할이 한 번 이상 등장한 기사 비율이며, 매체의 지지나 취재원 신뢰도 판정이 아닙니다.</p>
      {rows.map((row) => (
        <div className="source-prevalence-row" key={row.source}>
          <div className="source-prevalence-heading">
            <strong>{row.source}</strong>
            <span>취재원 관측 {row.sourceArticleCount}/{row.articleCount}건</span>
          </div>
          <div className="source-prevalence-roles">
            {row.roleCounts.map((role) => {
              const percentage = Math.round(role.presenceRate * 100);
              return (
                <div key={role.role} aria-label={`${role.roleLabel}: ${row.articleCount}건 중 ${role.articleCount}건, ${percentage}%`}>
                  <span><i style={{ width: `${percentage}%`, background: sourceRoleColors[role.role] ?? sourceRoleColors.other }} /></span>
                  <b>{role.roleLabel}</b>
                  <small>{role.articleCount}/{row.articleCount}건 · {percentage}%</small>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function EntmanMatrix({ axes }: { axes: ComparisonAxis[] }) {
  const outlets = [...new Set(axes.flatMap((axis) => axis.variants.flatMap((variant) => variant.outlets.map((outlet) => outlet.source))))];
  if (axes.length < 2 || outlets.length < 2) return null;
  return (
    <section className="comparison-section entman-section" aria-labelledby="entman-matrix-title">
      <div className="comparison-section-heading">
        <div><h3 id="entman-matrix-title">문제 정의·원인·평가·해결책</h3><p>같은 분석축을 언론사 기준으로 재배열한 표입니다. 본문에서 실제 관측된 설명만 요약합니다.</p></div>
        <span>Entman (1993) 4기능</span>
      </div>
      <div className="entman-matrix-wrap">
        <table className="entman-matrix">
          <thead><tr><th scope="col">언론사</th>{axes.map((axis) => <th scope="col" key={axis.dimension}>{axis.label}</th>)}</tr></thead>
          <tbody>
            {outlets.map((source) => (
              <tr key={source}>
                <th scope="row">{source}</th>
                {axes.map((axis) => {
                  const summaries = axis.variants
                    .filter((variant) => variant.outlets.some((outlet) => outlet.source === source))
                    .map((variant) => variant.summary);
                  return <td key={axis.dimension}>{summaries.length ? summaries.join(" · ") : <span className="not-observed">미관측</span>}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="viz-caption">‘미관측’은 분석 대상 본문에서 확인되지 않았다는 뜻이며, 요소의 실제 부재나 의도적 누락을 뜻하지 않습니다.</p>
    </section>
  );
}

function FrameCompositionByOutlet({ frames }: { frames: Frame[] }) {
  const [selected, setSelected] = useState<{ source: string; frame: string } | null>(null);
  const bySource = new Map<string, Map<string, Frame[]>>();
  for (const frame of frames) {
    if (!frame.source) continue;
    const frameMap = bySource.get(frame.source) ?? new Map<string, Frame[]>();
    const list = frameMap.get(frame.frame) ?? [];
    list.push(frame);
    frameMap.set(frame.frame, list);
    bySource.set(frame.source, frameMap);
  }
  const rows = [...bySource.entries()].map(([source, frameMap]) => ({
    source,
    segments: [...frameMap.entries()].map(([code, list]) => ({ code, count: list.length, evidence: list })).sort((a, b) => b.count - a.count),
  }));
  if (rows.length < 2) return null;
  const legendCodes = [...new Set(rows.flatMap((row) => row.segments.map((segment) => segment.code)))];
  const selectedEvidence = selected
    ? rows.find((row) => row.source === selected.source)?.segments.find((segment) => segment.code === selected.frame)?.evidence ?? []
    : [];
  return (
    <div className="frame-composition">
      <h4>프레임 구성 <small>매체별 표현 단서 · 다중 라벨</small></h4>
      <p className="viz-caption">막대의 구간을 누르면 해당 프레임 판단의 근거 문장이 표시됩니다. 구간 크기는 검출된 표현 단서 수이며 기사 논조 점수가 아닙니다.</p>
      {rows.map((row) => {
        const total = row.segments.reduce((sum, segment) => sum + segment.count, 0);
        return (
          <div className="viz-bar-row" key={row.source}>
            <span className="viz-bar-label">{row.source}</span>
            <div className="viz-bar-track">
              {row.segments.map((segment) => (
                <button
                  type="button"
                  key={segment.code}
                  className={selected?.source === row.source && selected?.frame === segment.code ? "active" : ""}
                  style={{ flexGrow: segment.count, background: frameColors[segment.code] ?? "#9099a6" }}
                  title={`${frameLabels[segment.code] ?? segment.code} 단서 ${segment.count}건`}
                  aria-label={`${row.source}의 ${frameLabels[segment.code] ?? segment.code} 프레임 근거 ${segment.count}건 보기`}
                  onClick={() => setSelected(selected?.source === row.source && selected?.frame === segment.code ? null : { source: row.source, frame: segment.code })}
                >{segment.count}</button>
              ))}
            </div>
            <b className="viz-bar-total">{total}건</b>
          </div>
        );
      })}
      <div className="viz-legend">{legendCodes.map((code) => <span key={code}><i style={{ background: frameColors[code] ?? "#9099a6" }} aria-hidden="true" />{frameLabels[code] ?? code}</span>)}</div>
      {selected && (
        <div className="frame-evidence-detail" role="status">
          <h5>{selected.source} · {frameLabels[selected.frame] ?? selected.frame} 근거</h5>
          {selectedEvidence.length ? selectedEvidence.map((frame, index) => (
            <p key={`${frame.articleId}-${index}`}>
              {frame.evidenceText ?? "근거 문장이 저장되지 않았습니다."}
              {frame.sourceUrl && <> · <a href={frame.sourceUrl} target="_blank" rel="noopener noreferrer">원문 확인 →</a></>}
            </p>
          )) : <p>표시할 근거 문장이 없습니다.</p>}
        </div>
      )}
    </div>
  );
}

function IssueMapView({ issueMap, isProviderExcerpt }: { issueMap: IssueMap; isProviderExcerpt: boolean }) {
  const leftAnchor = issueMap.leftAnchor;
  const rightAnchor = issueMap.rightAnchor;
  const isAvailable = ["available", "provisional"].includes(issueMap.status)
    && leftAnchor !== null
    && rightAnchor !== null;
  const positionedOutlets = issueMap.outlets.filter(
    (outlet): outlet is IssueMapOutlet & { displayPosition: number } => typeof outlet.displayPosition === "number",
  );
  const insufficientOutlets = issueMap.outlets.filter((outlet) => outlet.displayPosition === null || outlet.classification === "insufficient");

  return (
    <section className={`issue-spectrum-card issue-map-${issueMap.status}`} aria-labelledby="issue-spectrum-title">
      <header>
        <div><p className="context-label">어디서 갈렸나</p><h3 id="issue-spectrum-title">{issueMap.label}의 쟁점 지도</h3></div>
        <span>{readableCode(issueMap.status, statusLabels)}</span>
      </header>
      <p className="spectrum-intro">{issueMap.reason} 좌우 위치는 정치 성향 점수가 아니라, 기사당 한 표로 아래 두 문제 정의와 연결된 정도를 계산한 값입니다.</p>
      {isAvailable ? (
        <>
          <div className="spectrum-labels">
            <strong>{leftAnchor.label}<small>{leftAnchor.articleCount}건 · {leftAnchor.outletCount}개 매체</small></strong>
            <strong>{rightAnchor.label}<small>{rightAnchor.articleCount}건 · {rightAnchor.outletCount}개 매체</small></strong>
          </div>
          <div className="spectrum-track" aria-label={`${leftAnchor.label}와 ${rightAnchor.label} 사이 계산된 매체별 위치`}>
            <i aria-hidden="true" />
            {positionedOutlets.map((outlet, index) => (
              <span
                className={`${outlet.classification} evidence-${outlet.evidenceStatus}`}
                key={outlet.sourceId}
                style={{ left: `${outlet.displayPosition}%`, top: `${index % 2 ? 44 : 2}px` }}
                title={`${issueMapClassLabels[outlet.classification]} · 점수 ${outlet.score?.toFixed(3) ?? "미산출"} · ${outlet.eligibleArticleCount}건`}
              >{outlet.source.replace(/일보|신문|뉴스$/u, "")}</span>
            ))}
          </div>
          <div className="issue-map-outlet-list" aria-label="매체별 계산 근거">
            {issueMap.outlets.map((outlet) => (
              <article key={outlet.sourceId} className={outlet.classification === "insufficient" ? "insufficient" : ""}>
                <strong>{outlet.source}</strong>
                <span>{issueMapClassLabels[outlet.classification]}</span>
                <small>
                  {outlet.score === null ? "점수 미산출" : `점수 ${outlet.score.toFixed(3)} · 화면 위치 ${outlet.displayPosition}%`}
                  {` · 좌 ${outlet.leftArticleCount} / 함께 ${outlet.mixedArticleCount} / 우 ${outlet.rightArticleCount}건`}
                  {` · ${readableCode(outlet.evidenceStatus, statusLabels)}`}
                </small>
              </article>
            ))}
          </div>
          {insufficientOutlets.length > 0 && <p className="issue-map-caution">기사 한 건 이하의 관측치는 위치 해석에서 충분한 근거로 보지 않습니다: {insufficientOutlets.map((outlet) => outlet.source).join(" · ")}</p>}
          <dl className="issue-map-method">
            <div><dt>축 강도</dt><dd>{issueMap.selectionBasis.axisStrength?.toFixed(3) ?? "미산출"}</dd></div>
            <div><dt>양쪽 균형 포괄률</dt><dd>{formatShare(issueMap.selectionBasis.balancedCoverage) ?? "미산출"}</dd></div>
            <div><dt>양쪽 중복률</dt><dd>{formatShare(issueMap.selectionBasis.overlap) ?? "미산출"}</dd></div>
            <div><dt>계산 표본</dt><dd>{issueMap.selectionBasis.articleCount}건 · {issueMap.selectionBasis.outletCount}개 매체 · {issueMap.selectionBasis.independentMediaGroups}개 독립 그룹</dd></div>
          </dl>
        </>
      ) : (
        <div className="issue-map-withheld">
          <strong>지도 산출을 보류했습니다.</strong>
          <p>현재 {issueMap.selectionBasis.articleCount}건·{issueMap.selectionBasis.outletCount}개 매체·{issueMap.selectionBasis.independentMediaGroups}개 독립 그룹입니다. 최소 기준은 기사 {issueMap.selectionBasis.minimumArticles}건, 언론사 {issueMap.selectionBasis.minimumOutlets}곳, 독립 그룹 {issueMap.selectionBasis.minimumIndependentMediaGroups}개, 양쪽 문제 정의별 {issueMap.selectionBasis.minimumArticlesPerAnchor}건입니다.</p>
        </div>
      )}
      <p className="issue-map-basis">{isProviderExcerpt ? "본문 발췌" : "본문"}의 검증된 위치·해시와 claim ID를 사용했습니다. 같은 문장의 반복이나 인용 횟수는 위치 점수를 키우지 않습니다.</p>
    </section>
  );
}

function NarrativeReport({ narratives }: { narratives: Narrative[] }) {
  return (
    <section className="comparison-section narrative-report" aria-labelledby="narrative-report-title">
      <div className="comparison-section-heading">
        <div><h3 id="narrative-report-title">기사들이 연결한 서사</h3><p>문제 정의가 같고 원인·책임·평가·해법 중 두 차원 이상이 충돌 없이 함께 나타난 기사만 묶었습니다. 모든 기사끼리 호환되는 완전연결 군집만 최대 두 개 표시합니다.</p></div>
        <span>{narratives.length}개 서사</span>
      </div>
      {narratives.length ? (
        <div className="narrative-grid">
          {narratives.map((narrative, narrativeIndex) => {
            const clauses = [
              ["문제", narrative.problem],
              ["원인", narrative.cause],
              ["책임", narrative.responsibility],
              ["평가", narrative.evaluation],
              ["해법", narrative.remedy],
            ] as const;
            return (
              <article className="narrative-card" key={narrative.narrativeId}>
                <header>
                  <div><span>서사 {narrativeIndex + 1}</span><h4>{narrative.problem.summary}</h4></div>
                  <small>{readableCode(narrative.status, statusLabels)}</small>
                </header>
                <ol className="narrative-flow">
                  {clauses.map(([label, clause]) => (
                    <li key={label} className={clause ? "observed" : "not-observed"}>
                      <span>{label}</span>
                      <p>{clause?.summary ?? "공통 연결을 확정할 근거 부족"}</p>
                      {clause && <small>{clause.supportingArticleCount}/{clause.observedArticleCount}건 지지 · {formatShare(clause.supportShare)}</small>}
                    </li>
                  ))}
                </ol>
                <p className="narrative-sample">기사 {narrative.articleCount}건 · 매체 {narrative.outletCount}곳 · 독립 그룹 {narrative.independentMediaGroups}개 · 완성도 {formatShare(narrative.completeness)}</p>
                <ComparisonSourceLinks outlets={narrative.evidence.slice(0, 6)} />
              </article>
            );
          })}
        </div>
      ) : <p className="withheld">문제 정의와 두 개 이상의 후속 차원을 함께 연결하는 기사 군집이 두 건 이상 모이지 않아 서사를 만들지 않았습니다.</p>}
    </section>
  );
}

function StructuredComparisonView({ comparison }: { comparison: Comparison }) {
  const summaryItems = [
    ["여러 매체가 함께 설명한 것", comparison.summary?.commonGround],
    ["설명이 가장 크게 갈린 지점", comparison.summary?.mainDifference],
    ["이 차이를 살펴볼 이유", comparison.summary?.whyItMatters],
    ["취재원 구성에서 확인된 것", comparison.summary?.sourceContext],
  ].filter((entry): entry is [string, string] => Boolean(entry[1]));
  const axes = comparison.axes ?? [];
  const issueMap = comparison.issueMap;
  const narratives = comparison.narratives ?? [];
  const readerQuestions = comparison.readerQuestions ?? [];
  const sourceLens = comparison.sourceLens;
  const contextGaps = comparison.contextGaps ?? [];
  const limitations = comparison.limitations ?? [];
  const isProviderExcerpt = comparison.sample?.textScope === "provider_excerpt";

  return (
    <div className="structured-comparison">
      <header className="comparison-brief">
        <div className="comparison-brief-heading">
          <div>
            <p className="context-label">30초 비교 요약</p>
            <h3>{comparison.divergenceDetected ? "같은 사건을 설명하는 방식이 여기서 갈렸습니다" : "공통점과 관측 가능한 설명 요소를 비교했습니다"}</h3>
          </div>
          <div className="comparison-badges" aria-label="분석 상태">
            <span>{readableCode(comparison.status, statusLabels)}</span>
            {comparison.reviewStatus && <span className="review-badge">{readableCode(comparison.reviewStatus, reviewLabels)}</span>}
            {comparison.methodologyLabel && <span className="method-badge">{comparison.methodologyLabel}</span>}
          </div>
        </div>
        {summaryItems.length ? (
          <div className="comparison-summary-strip">
            {summaryItems.map(([label, text]) => <article key={label}><h4>{label}</h4><p>{text}</p></article>)}
          </div>
        ) : <p className="withheld">비교 요약을 만들 수 있을 만큼 서로 독립적인 본문 근거가 확인되지 않았습니다.</p>}
        {comparison.status !== "available" && comparison.reason && <p className="comparison-reason">{comparison.reason}</p>}
        {comparison.sample && (
          <dl className="comparison-sample" aria-label="이번 비교에 사용한 표본">
            <div><dt>{isProviderExcerpt ? "본문 발췌 분석" : "본문 분석"}</dt><dd>{comparison.sample.analyzedArticles}건</dd></div>
            <div><dt>언론사</dt><dd>{comparison.sample.outlets}곳</dd></div>
            <div><dt>독립 미디어그룹</dt><dd>{comparison.sample.independentMediaGroups}개</dd></div>
            <div><dt>제외·유보</dt><dd>{comparison.sample.excludedArticles}건</dd></div>
            <div><dt>입력 절단</dt><dd>{comparison.sample.inputTruncatedArticles ?? 0}건</dd></div>
          </dl>
        )}
      </header>

      {issueMap && <IssueMapView issueMap={issueMap} isProviderExcerpt={isProviderExcerpt} />}

      <NarrativeReport narratives={narratives} />

      <section className="comparison-section" aria-labelledby="comparison-axes-title">
        <div className="comparison-section-heading">
          <div><h3 id="comparison-axes-title">무엇을 다르게 설명했나</h3><p>기사별 판정을 먼저 만든 뒤, 같은 분석축에서 실제로 확인된 설명만 묶었습니다.</p></div>
          <span>{axes.length}개 분석축</span>
        </div>
        {axes.length ? (
          <div className="comparison-axes">
            {axes.map((axis) => (
              <section className="comparison-axis" key={axis.dimension}>
                <header><span>분석축</span><h4>{axis.label}</h4></header>
                <div className="comparison-variants">
                  {axis.variants.map((variant, index) => (
                    <article key={`${axis.dimension}-${variant.summary}-${index}`}>
                      <div className="variant-heading">
                        <p>{variant.summary}</p>
                        <div className="variant-status">
                          <span>{readableCode(variant.commitment, commitmentLabels)}</span>
                          <span>{readableCode(variant.status, statusLabels)}</span>
                        </div>
                      </div>
                      {variant.outlets.length ? <ComparisonSourceLinks outlets={variant.outlets} /> : <small className="variant-empty">연결된 공개 원문 없음</small>}
                      {(variant.evidenceLocator || variant.basis) && <p className="variant-evidence">{variant.evidenceLocator && <span>근거 위치 {variant.evidenceLocator}</span>}{variant.basis && <span>{variant.basis}</span>}</p>}
                    </article>
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : <p className="withheld">문제 정의·원인·책임·평가·해법을 매체 간에 비교할 만큼 본문 근거가 모이지 않았습니다.</p>}
      </section>

      <EntmanMatrix axes={axes} />

      {sourceLens && (
        <section className="comparison-section source-lens" aria-labelledby="source-lens-title">
          <div className="comparison-section-heading">
            <div><h3 id="source-lens-title">누구의 목소리로 설명했나</h3><p>각 역할이 등장한 고유 기사 비율입니다. 같은 기사의 반복 인용은 한 번만 세며, 미관측은 의도적 배제를 뜻하지 않습니다.</p></div>
          </div>
          <SourcingBars byOutlet={sourceLens.byOutlet} />
          {sourceLens.caution && <p className="source-lens-caution">{sourceLens.caution}</p>}
          <div className="voice-overview">
            <div><h4>여러 매체에 공통 등장</h4>{sourceLens.sharedVoices.length ? <ul>{sourceLens.sharedVoices.map((voice) => <li key={voice}>{voice}</li>)}</ul> : <p>공통 발화자 범주가 확인되지 않았습니다.</p>}</div>
            <div><h4>일부 매체에서만 등장</h4>{sourceLens.voicesPresentInSomeOutlets.length ? <ul>{sourceLens.voicesPresentInSomeOutlets.map((voice) => <li key={voice}>{voice}</li>)}</ul> : <p>매체별 차이가 확인되지 않았습니다.</p>}</div>
          </div>
          {sourceLens.byOutlet.length > 0 && (
            <div className="voice-by-outlet" role="table" aria-label="언론사별 발화자 구성">
              <div className="voice-table-head" role="row"><span role="columnheader">언론사</span><span role="columnheader">확인된 목소리</span><span role="columnheader">구성 단서</span></div>
              {sourceLens.byOutlet.map((entry) => {
                const officialShare = formatShare(entry.officialShare);
                const affectedVoice = affectedVoiceLabel(entry.affectedGroupPresenceRate);
                return (
                  <div className="voice-table-row" role="row" key={entry.source}>
                    <strong role="cell">{entry.source}</strong>
                    <p role="cell">{entry.voices.length ? entry.voices.join(" · ") : "본문에서 발화자 미관측"}</p>
                    <p role="cell">{[officialShare ? `기관·정치권 등장 기사 비율 ${officialShare}` : null, affectedVoice].filter(Boolean).join(" · ") || "추가 단서 없음"}</p>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {contextGaps.length > 0 && (
        <section className="comparison-section context-gap-section" aria-labelledby="context-gap-title">
          <div className="comparison-section-heading">
            <div><h3 id="context-gap-title">본문에서 관측 여부가 달랐던 요소</h3><p>‘누락’이나 ‘편향’ 판정이 아니라, 이번에 분석한 본문에서 관측됐는지를 비교한 결과입니다.</p></div>
          </div>
          <div className="context-gap-list">
            {contextGaps.map((gap) => (
              <article key={`${gap.feature}-${gap.displayText}`}>
                <h4>{gap.feature}</h4>
                <p>{gap.displayText}</p>
                <dl>
                  <div><dt>관측됨</dt><dd>{gap.presentInOutlets.length ? gap.presentInOutlets.join(" · ") : "없음"}</dd></div>
                  <div><dt>본문에서 미관측</dt><dd>{gap.notObservedInOutlets.length ? gap.notObservedInOutlets.join(" · ") : "없음"}</dd></div>
                </dl>
              </article>
            ))}
          </div>
        </section>
      )}

      <section className="reading-brief" aria-labelledby="reading-brief-title">
        <header><p className="context-label">근거로 만든 독자 질문</p><h3 id="reading-brief-title">이 비교에서 더 확인할 질문</h3></header>
        {readerQuestions.length ? (
          <div>
            {readerQuestions.map((question, index) => (
              <article key={question.questionId}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <h4>{readerQuestionLabels[question.triggerType]}</h4>
                <p>{question.question}</p>
                <small className="reader-question-basis">claim {question.basisClaimIds.length}개 · 기사 {question.basisArticleIds.length}건 근거</small>
                <ComparisonSourceLinks outlets={question.evidence.slice(0, 5)} />
              </article>
            ))}
          </div>
        ) : <p className="withheld">서사·쟁점축·취재원 구성의 차이를 뒷받침하는 claim과 기사 근거가 함께 확인되지 않아 독자 질문을 자동 생성하지 않았습니다.</p>}
        <aside>
          <h4>질문 생성 기준</h4>
          <p>두 서사가 두 차원 이상 다르거나, 쟁점축 양쪽 근거가 있거나, 역할별 기사 등장률 차이가 50%p 이상일 때만 질문 후보를 만듭니다. 각 질문은 위 원문 링크와 claim ID에 연결됩니다.</p>
        </aside>
      </section>

      {limitations.length > 0 && (
        <details className="comparison-limitations">
          <summary>이 분석을 해석할 때 확인할 한계 <span>{limitations.length}개</span></summary>
          <ul>{limitations.map((limitation, index) => <li key={`${limitation}-${index}`}>{limitation}</li>)}</ul>
        </details>
      )}
      {comparison.lineage && (
        <details className="comparison-limitations">
          <summary>분석 이력과 승인 근거</summary>
          <dl>
            <div><dt>분석 모델</dt><dd>{comparison.lineage.modelId}</dd></div>
            <div><dt>프롬프트</dt><dd>{comparison.lineage.promptVersion}</dd></div>
            <div><dt>분석 스키마</dt><dd>{comparison.lineage.analysisSchemaVersion}</dd></div>
            <div><dt>비교 엔진</dt><dd>{comparison.lineage.comparisonEngineVersion}</dd></div>
            {comparison.lineage.approval ? (
              <>
                <div><dt>승인 ID</dt><dd>{comparison.lineage.approval.authorizationId}</dd></div>
                <div><dt>클러스터 ID</dt><dd>{comparison.lineage.approval.clusterId}</dd></div>
                <div><dt>검토자</dt><dd>{comparison.lineage.approval.reviewer}</dd></div>
                <div><dt>검토 시각</dt><dd>{formatDateTime(comparison.lineage.approval.reviewedAt)}</dd></div>
                <div><dt>승인 지문</dt><dd><code>{comparison.lineage.approval.fingerprint}</code></dd></div>
                <div><dt>승인 URL 집합</dt><dd><code>{comparison.lineage.approval.approvedUrlsSha256}</code></dd></div>
              </>
            ) : <div><dt>동일 사건 승인</dt><dd>별도 승인 지문 없음</dd></div>}
          </dl>
        </details>
      )}
    </div>
  );
}

function FramingEditorialView({ comparison, articles }: { comparison: Comparison; articles: Article[] }) {
  const summary = comparison.summary ?? {};
  const narratives = comparison.narratives ?? [];
  const sourceLens = comparison.sourceLens;
  const issueMap = comparison.issueMap;
  const axes = comparison.axes ?? [];
  const readerQuestions = comparison.readerQuestions ?? [];
  const outletCards = new Map<string, { summary: string; outlets: ComparisonSource[] }>();
  for (const axis of axes) {
    for (const variant of axis.variants) {
      for (const outlet of variant.outlets) {
        const current = outletCards.get(outlet.source);
        outletCards.set(outlet.source, {
          summary: current?.summary ?? variant.summary,
          outlets: [...(current?.outlets ?? []), outlet],
        });
      }
    }
  }
  const cards = [...outletCards.entries()].map(([source, value]) => ({ source, ...value }));
  const divergence = summary.mainDifference
    || (narratives.length >= 2 ? `${narratives[0].problem.summary} ↔ ${narratives[1].problem.summary}` : null);
  const hasEditorialEvidence = Boolean(divergence || narratives.length || issueMap || sourceLens || axes.length);

  return (
    <div className="framing-editorial">
      <section className="framing-lede" aria-labelledby="framing-lede-title">
        <div className="framing-lede-copy">
          <p className="context-label">어디서 갈렸나</p>
          <h3 id="framing-lede-title">{divergence ?? "같은 사건을 어떤 문제로 설명했는지부터 확인합니다."}</h3>
          <p>{summary.whyItMatters ?? "이 화면은 언론사의 성향을 점수화하지 않고, 본문에서 확인된 문제 정의·원인·책임·해법의 차이를 사건별로 비교합니다."}</p>
          <div className="framing-method-line"><span>{readableCode(comparison.status, statusLabels)}</span>{comparison.sample && <span>본문 근거 {comparison.sample.analyzedArticles}건 · {comparison.sample.outlets}개 매체</span>}<span>{comparison.reviewStatus ? readableCode(comparison.reviewStatus, reviewLabels) : "자동 구조화 초안"}</span></div>
        </div>
        {issueMap && <IssueMapView issueMap={issueMap} isProviderExcerpt={comparison.sample?.textScope === "provider_excerpt"} />}
      </section>

      <section className="framing-report" aria-labelledby="framing-report-title">
        <header><p className="context-label">이슈 리포트</p><h3 id="framing-report-title">무엇이 문제인가부터 달라집니다</h3><p>기사의 제목만으로 결론을 내리지 않고, 동일 사건에 연결된 본문 근거를 분석축별로 모아 읽을 수 있게 했습니다.</p></header>
        <div className="framing-report-section">
          <h4>쟁점 구도: ‘무엇이 문제인가’부터 다르다</h4>
          <p>{summary.mainDifference ?? (issueMap?.reason ?? "현재 표본에서 문제 정의의 양쪽을 안정적으로 연결할 근거가 충분하지 않습니다.")}</p>
          {issueMap?.leftAnchor && issueMap.rightAnchor && <div className="framing-contrast"><div><b>{issueMap.leftAnchor.label}</b><span>{issueMap.leftAnchor.articleCount}건 · {issueMap.leftAnchor.outletCount}개 매체</span></div><strong>↔</strong><div><b>{issueMap.rightAnchor.label}</b><span>{issueMap.rightAnchor.articleCount}건 · {issueMap.rightAnchor.outletCount}개 매체</span></div></div>}
        </div>
        <div className="framing-report-section">
          <h4>두 개의 서사</h4>
          {narratives.length >= 2 ? <div className="framing-story-grid">{narratives.slice(0, 2).map((narrative, index) => <article key={narrative.narrativeId}><span>서사 {index + 1}</span><h5>{narrative.problem.summary}</h5><p>{narrative.summary}</p><small>기사 {narrative.articleCount}건 · 매체 {narrative.outletCount}곳 · {readableCode(narrative.status, statusLabels)}</small><ComparisonSourceLinks outlets={narrative.evidence.slice(0, 4)} /></article>)}</div> : <p className="withheld">서로 다른 문제 정의와 후속 설명이 함께 확인된 서사가 두 개 미만이라, 대립하는 서사를 만들지 않았습니다.</p>}
        </div>
        <div className="framing-report-section">
          <h4>누구의 목소리로 말하는가</h4>
          {sourceLens ? <><p>{sourceLens.sharedVoices.length ? `여러 매체에서 공통으로 등장한 목소리: ${sourceLens.sharedVoices.join(" · ")}` : "모든 매체에 공통으로 등장한 발화자 범주는 확인되지 않았습니다."}</p><SourcingBars byOutlet={sourceLens.byOutlet} />{sourceLens.voicesPresentInSomeOutlets.length ? <p className="framing-voice-gap">일부 매체에서만 확인된 목소리: {sourceLens.voicesPresentInSomeOutlets.join(" · ")}</p> : null}</> : <p className="withheld">취재원 구성 비교에 필요한 본문 근거가 아직 공개 기준을 충족하지 않았습니다.</p>}
        </div>
      </section>

      {cards.length > 0 ? <section className="framing-outlet-cards" aria-labelledby="framing-outlet-title"><header><div><p className="context-label">매체별 한 문장</p><h4 id="framing-outlet-title">각 매체는 어디에 초점을 두었나</h4></div><span>{cards.length}개 매체</span></header><div>{cards.slice(0, 10).map((card) => <article key={card.source}><strong>{card.source}</strong><p>{card.summary}</p><ComparisonSourceLinks outlets={card.outlets.slice(0, 2)} /></article>)}</div></section> : <section className="framing-outlet-cards framing-outlet-empty"><header><div><p className="context-label">매체별 한 문장</p><h4>본문 근거가 모이면 이곳에 표시합니다</h4></div></header><p className="withheld">현재는 제목·배치 메타데이터와 제한된 본문 단서만 확인됩니다. 근거 없는 매체별 프레임을 채우지 않았습니다.</p><div className="headline-fallback">{articles.slice(0, 5).map((article) => <a key={article.id} href={article.url} target="_blank" rel="noopener noreferrer"><strong>{article.source}</strong><span>{article.title}</span></a>)}</div></section>}

      <section className="framing-reader-questions" aria-labelledby="framing-reader-title">
        <header><h4 id="framing-reader-title">이렇게 읽어 보세요</h4><p>분석이 대신 판단하지 않고, 사용자가 원문에서 확인할 질문을 남깁니다.</p></header>
        {readerQuestions.length ? <ul>{readerQuestions.slice(0, 3).map((question) => <li key={question.questionId}>{question.question}</li>)}</ul> : <ul><li>각 매체는 사건을 어떤 문제로 정의했나요?</li><li>원인과 책임을 직접 말한 근거가 본문에 있나요?</li><li>누구의 목소리가 공통으로 등장하고, 누구의 목소리는 보이지 않나요?</li></ul>}
      </section>

      {!hasEditorialEvidence && <p className="framing-release-note">현재 프레이밍 분석은 근거 부족으로 보류되어 있습니다. 본문 분석과 동일 사건 검토가 완료되면 위 리포트가 채워집니다.</p>}
      {hasEditorialEvidence && <details className="framing-raw-details"><summary>전체 분석축과 근거 연결 보기</summary><StructuredComparisonView comparison={comparison} /></details>}
    </div>
  );
}

function LegacyComparisonView({ comparison, articles, openArticles }: { comparison: Comparison; articles: Article[]; openArticles: () => void }) {
  const commonFacts = comparison.commonFacts ?? [];
  const divergenceQuestions = comparison.divergenceQuestions ?? [];
  const sourceVoices = comparison.sourceVoices ?? [];
  const recommendedPair = comparison.recommendedPair ?? null;

  return (
    <div className="legacy-comparison">
      <header>
        <p className="context-label">비교 가능성</p>
        <h3>{comparison.status === "available" ? "근거가 확인된 설명 차이" : "현재는 구조화 비교를 제공하지 않습니다"}</h3>
        <p>{comparison.reason ?? "서로 비교할 수 있는 본문 근거가 충분하지 않습니다."}</p>
      </header>
      <div className="evidence-grid">
        <section>
          <div className="evidence-step"><span className="step-number">01</span><span className="step-status">{commonFacts.length ? "확인됨" : "근거 부족"}</span></div>
          <h4>공통으로 확인된 사실</h4>
          {commonFacts.length ? commonFacts.map((fact) => <article key={fact.id}><strong>{fact.text}</strong><small>{fact.sourceCount}개 매체 · {fact.articleCount}건 근거</small></article>) : <p className="withheld">검증된 공통 사실 추출과 독립 출처 대조가 완료되지 않아 만들지 않았습니다.</p>}
        </section>
        <section>
          <div className="evidence-step"><span className="step-number">02</span><span className="step-status">{divergenceQuestions.length ? "확인됨" : "판단 보류"}</span></div>
          <h4>보도가 갈린 질문</h4>
          {divergenceQuestions.length ? divergenceQuestions.map((question) => <article key={question.id}><strong>{question.question}</strong><small>{question.answerGroups.length}개 설명 그룹</small></article>) : <p className="withheld">제목만으로 원인·책임·해법의 차이를 단정하지 않습니다.</p>}
        </section>
        <section>
          <div className="evidence-step"><span className="step-number">03</span><span className="step-status">{sourceVoices.length ? "확인됨" : "본문 필요"}</span></div>
          <h4>누구의 목소리가 실렸나</h4>
          {sourceVoices.length ? sourceVoices.map((voice) => <article key={`${voice.sourceType}-${voice.supports}`}><strong>{voice.sourceType}</strong><p>{voice.supports}</p></article>) : <p className="withheld">본문 근거가 없거나 취재원 추출이 검토되지 않아 발언 주체와 맥락을 판정하지 않습니다.</p>}
        </section>
        <section>
          <div className="evidence-step"><span className="step-number">04</span><span className="step-status">{recommendedPair ? "추천 가능" : "추천 보류"}</span></div>
          <h4>기사 두 개만 읽는다면</h4>
          {recommendedPair ? <><p>{recommendedPair.reason}</p><div className="pair-links"><a href={recommendedPair.primary.url} target="_blank" rel="noopener noreferrer">첫 번째 기사 열기</a><a href={recommendedPair.complement.url} target="_blank" rel="noopener noreferrer">보완 기사 열기</a></div></> : <><p className="withheld">두 기사의 상호보완성을 근거로 확인할 수 없어 추천하지 않습니다.</p><button className="inline-action" type="button" onClick={openArticles}>관련 제목을 직접 비교하기</button></>}
        </section>
      </div>
      {articles.length > 0 && <section className="headline-evidence" aria-labelledby="headline-evidence-title"><div><p className="context-label">지금 확인 가능한 근거</p><h4 id="headline-evidence-title">매체별 기사 제목</h4></div><div>{articles.slice(0, 5).map((article) => <a key={article.id} href={article.url} target="_blank" rel="noopener noreferrer"><span>{article.source}</span><strong>{article.title}</strong><small>원문 열기 →</small></a>)}</div></section>}
    </div>
  );
}

export default function AgendaDashboard() {
  const [health, setHealth] = useState<Health | null>(null);
  const [sources, setSources] = useState<Source[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [issueTotal, setIssueTotal] = useState(0);
  const [categories, setCategories] = useState<Array<{ category: string; count: number }>>([]);
  const [availableDates, setAvailableDates] = useState<IssueDateOption[]>([]);
  const [issueDate, setIssueDate] = useState("");
  const [category, setCategory] = useState("전체");
  const [selectedIssueId, setSelectedIssueId] = useState("");
  const [detail, setDetail] = useState<IssueDetail | null>(null);
  const [detailRequestNonce, setDetailRequestNonce] = useState(0);
  const [tab, setTab] = useState<AnalysisTab>("compare");
  const [loadingIssues, setLoadingIssues] = useState(true);
  const [issueError, setIssueError] = useState("");
  const [detailError, setDetailError] = useState("");
  const [articles, setArticles] = useState<Article[]>([]);
  const [articleTotal, setArticleTotal] = useState(0);
  const [articleOffset, setArticleOffset] = useState(0);
  const [articleLoading, setArticleLoading] = useState(false);
  const [articleError, setArticleError] = useState("");
  const [filters, setFilters] = useState<ArticleFilters>({ q: "", source: "", section: "", articleDate: "" });
  const [appliedFilters, setAppliedFilters] = useState<ArticleFilters>({ q: "", source: "", section: "", articleDate: "" });
  const [methodOpen, setMethodOpen] = useState(false);
  const [urlReady, setUrlReady] = useState(false);
  const [healthError, setHealthError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMessage, setRefreshMessage] = useState("");
  const methodDialogRef = useRef<HTMLDialogElement>(null);
  const detailTitleRef = useRef<HTMLHeadingElement>(null);
  const pendingDetailFocusRef = useRef(false);
  const archiveRequestedRef = useRef(false);

  const loadHealth = useCallback(async () => {
    try {
      const response = await fetch("/api/health", { cache: "no-store" });
      if (!response.ok) throw new Error("health unavailable");
      setHealth(await response.json());
      setHealthError(false);
    } catch {
      setHealthError(true);
    }
  }, []);

  const loadSources = useCallback(async () => {
    try {
      const response = await fetch("/api/sources", { cache: "force-cache" });
      if (!response.ok) throw new Error("sources unavailable");
      const payload = await response.json();
      setSources(Array.isArray(payload.sources) ? payload.sources.filter((source: Source) => source.active) : []);
    } catch {
      setSources([]);
    }
  }, []);

  const loadIssueDates = useCallback(async (preferredDate = "") => {
    try {
      const response = await fetch(`/api/issues/dates?limit=31&scope=${ISSUE_SCOPE}`, { cache: "no-store" });
      if (!response.ok) throw new Error("issue dates unavailable");
      const payload = await response.json();
      const nextDates = Array.isArray(payload.dates) ? payload.dates : [];
      setAvailableDates(nextDates);
      const resolvedDate = nextDates.some((entry: IssueDateOption) => entry.date === preferredDate)
        ? preferredDate
        : (nextDates[0]?.date ?? preferredDate);
      setIssueDate(resolvedDate);
      return resolvedDate;
    } catch {
      setAvailableDates([]);
      setIssueDate(preferredDate);
      return preferredDate;
    }
  }, []);

  const loadIssues = useCallback(async (nextCategory = category, nextDate = issueDate) => {
    setLoadingIssues(true);
    setIssueError("");
    try {
      const parameters = new URLSearchParams({ limit: "5", scope: ISSUE_SCOPE });
      if (nextCategory !== "전체") parameters.set("category", nextCategory);
      if (nextDate) parameters.set("date", nextDate);
      const response = await fetch(`/api/issues?${parameters}`, { cache: "no-store" });
      if (!response.ok) throw new Error("issues unavailable");
      const payload = await response.json();
      const nextIssues = Array.isArray(payload.issues) ? payload.issues : [];
      setIssues(nextIssues);
      setIssueTotal(Number(payload.total) || 0);
      setCategories(Array.isArray(payload.categories) ? payload.categories : []);
      const requestedIssue = typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("issue") ?? "";
      setSelectedIssueId((current) => nextIssues.some((issue: Issue) => issue.id === current) ? current : (nextIssues.find((issue: Issue) => issue.id === requestedIssue)?.id ?? nextIssues[0]?.id ?? ""));
    } catch {
      setIssueError("이슈를 새로 불러오지 못했습니다. 잠시 뒤 다시 시도해 주세요.");
    } finally {
      setLoadingIssues(false);
    }
  }, [category, issueDate]);

  const loadArticles = useCallback(async ({ append = false, nextFilters = appliedFilters } = {}) => {
    if (articleLoading) return;
    setArticleLoading(true);
    setArticleError("");
    try {
      const offset = append ? articleOffset : 0;
      const parameters = new URLSearchParams({ limit: "12", offset: String(offset) });
      if (nextFilters.q.trim()) parameters.set("q", nextFilters.q.trim());
      if (nextFilters.source.trim()) parameters.set("source", nextFilters.source.trim());
      if (nextFilters.section.trim()) parameters.set("section", nextFilters.section.trim());
      if (nextFilters.articleDate.trim()) parameters.set("date", nextFilters.articleDate.trim());
      const response = await fetch(`/api/articles?${parameters}`, { cache: "no-store" });
      if (!response.ok) throw new Error("articles unavailable");
      const payload = await response.json();
      const next = Array.isArray(payload.articles) ? payload.articles : [];
      setArticles((current) => append ? [...current, ...next] : next);
      setArticleTotal(Number(payload.total) || 0);
      setArticleOffset(offset + next.length);
    } catch {
      setArticleError("기사 목록을 새로 불러오지 못했습니다. 잠시 뒤 다시 시도해 주세요.");
    } finally {
      setArticleLoading(false);
    }
  }, [appliedFilters, articleLoading, articleOffset]);

  useEffect(() => {
    const parameters = typeof window === "undefined" ? new URLSearchParams() : new URLSearchParams(window.location.search);
    const requestedCategory = parameters.get("category") || "전체";
    const initialCategory = ["전체", ...agendaCategoryOrder].includes(requestedCategory) ? requestedCategory : "전체";
    const initialIssueDate = parameters.get("date") ?? "";
    const requestedTab = parameters.get("tab") as AnalysisTab | null;
    const initialTab = analysisTabs.some(([value]) => value === requestedTab) ? requestedTab as AnalysisTab : "compare";
    const initialFilters = { q: parameters.get("q") ?? "", source: parameters.get("source") ?? "", section: parameters.get("section") ?? "", articleDate: parameters.get("article_date") ?? "" };
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCategory(initialCategory);
    setTab(initialTab);
    setFilters(initialFilters);
    setAppliedFilters(initialFilters);
    setUrlReady(true);
    void (async () => {
      const resolvedDate = await loadIssueDates(initialIssueDate);
      await Promise.allSettled([loadHealth(), loadSources(), loadIssues(initialCategory, resolvedDate)]);
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!selectedIssueId) return;
    let cancelled = false;
    fetch(`/api/issues/${encodeURIComponent(selectedIssueId)}?scope=${ISSUE_SCOPE}`, { cache: "no-store" })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("detail unavailable")))
      .then((payload) => { if (!cancelled) setDetail(applyTop5Pilot(payload as IssueDetail)); })
      .catch(() => { if (!cancelled) { setDetail(null); setDetailError("이슈 근거를 불러오지 못했습니다."); } });
    return () => { cancelled = true; };
  }, [detailRequestNonce, selectedIssueId]);

  useEffect(() => {
    if (!pendingDetailFocusRef.current || detail?.issue.id !== selectedIssueId) return;
    pendingDetailFocusRef.current = false;
    requestAnimationFrame(() => detailTitleRef.current?.focus({ preventScroll: true }));
  }, [detail, selectedIssueId]);

  useEffect(() => {
    if (!urlReady || typeof window === "undefined") return;
    const parameters = new URLSearchParams(window.location.search);
    if (selectedIssueId) parameters.set("issue", selectedIssueId); else parameters.delete("issue");
    if (category !== "전체") parameters.set("category", category); else parameters.delete("category");
    if (issueDate) parameters.set("date", issueDate); else parameters.delete("date");
    parameters.set("tab", tab);
    for (const key of ["q", "source", "section"] as const) {
      if (appliedFilters[key]) parameters.set(key, appliedFilters[key]); else parameters.delete(key);
    }
    if (appliedFilters.articleDate) parameters.set("article_date", appliedFilters.articleDate); else parameters.delete("article_date");
    const query = parameters.toString();
    const hash = window.location.hash || "#agenda-workspace";
    window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}${hash}`);
  }, [appliedFilters, category, issueDate, selectedIssueId, tab, urlReady]);

  useEffect(() => {
    const dialog = methodDialogRef.current;
    if (!dialog) return;
    if (methodOpen && !dialog.open) dialog.showModal();
    if (!methodOpen && dialog.open) dialog.close();
  }, [methodOpen]);

  useEffect(() => {
    if (!methodOpen) return;
    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setMethodOpen(false);
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [methodOpen]);

  const handleCategory = (value: string) => {
    setCategory(value);
    setDetail(null);
    setDetailError("");
    setTab("compare");
    loadIssues(value, issueDate);
  };

  const handleIssueDate = (value: string) => {
    setIssueDate(value);
    setCategory("전체");
    setDetail(null);
    setDetailError("");
    setSelectedIssueId("");
    setTab("compare");
    loadIssues("전체", value);
  };

  const selectIssue = (issueId: string) => {
    setDetail(null);
    setDetailError("");
    setSelectedIssueId(issueId);
    setTab("compare");
    pendingDetailFocusRef.current = true;
    if (typeof window !== "undefined") {
      const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
      requestAnimationFrame(() => document.getElementById("issue-analysis-panel")?.scrollIntoView({ behavior, block: "start" }));
    }
  };

  const retryDetail = () => {
    setDetail(null);
    setDetailError("");
    setDetailRequestNonce((current) => current + 1);
  };

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, value: AnalysisTab) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const current = analysisTabs.findIndex(([candidate]) => candidate === value);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? analysisTabs.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + analysisTabs.length) % analysisTabs.length;
    const nextTab = analysisTabs[next][0];
    setTab(nextTab);
    requestAnimationFrame(() => document.getElementById(`analysis-tab-${nextTab}`)?.focus());
  };

  const submitFilters = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAppliedFilters(filters);
    loadArticles({ append: false, nextFilters: filters });
  };

  const resetFilters = () => {
    const empty = { q: "", source: "", section: "", articleDate: "" };
    setFilters(empty);
    setAppliedFilters(empty);
    loadArticles({ append: false, nextFilters: empty });
  };

  const refreshAll = async () => {
    if (refreshing) return;
    setRefreshing(true);
    setRefreshMessage("");
    await Promise.allSettled([loadHealth(), loadIssueDates(issueDate), loadIssues(category, issueDate), archiveRequestedRef.current ? loadArticles({ nextFilters: appliedFilters }) : Promise.resolve()]);
    setRefreshMessage(`${formatDateTime(Date.now())}에 화면 데이터를 확인했습니다.`);
    setRefreshing(false);
  };

  const selectedIssue = useMemo(() => issues.find((issue) => issue.id === selectedIssueId) ?? (detail?.issue.id === selectedIssueId ? detail.issue : null), [detail, issues, selectedIssueId]);
  const categoryOptions = ["전체", ...agendaCategoryOrder.filter((value) => categories.some((entry) => entry.category === value))];
  const freshness = health?.freshness ?? { status: "analysis_pending", label: healthError ? "상태 확인 불가" : "상태 확인 중", staleDays: null };
  const currentSnapshot = freshness.status === "normal";
  const basisDate = issueDate || health?.analysis?.targetDate || null;
  const detectedFrames = detail?.frames.filter((frame) => frame.score > 0 && frame.evidenceText) ?? [];
  const bodyBackedFrameCount = detail?.frames.filter((frame) => frame.evidenceBasis.startsWith("body_") && frame.score > 0).length ?? 0;
  const bodyEvidenceCount = health?.collection.bodyEvidenceCount ?? 0;
  const configuredSourceCount = sources.filter((source) => source.sourceType === "general_daily").length || 10;
  const sourceGroups = useMemo(() => ["general_daily", "business_media", "news_agency"].map((sourceType) => {
    const entries = sources.filter((source) => source.sourceType === sourceType).sort((a, b) => a.sampleOrder - b.sampleOrder);
    return { sourceType, label: entries[0]?.sourceTypeLabel ?? sourceType, entries };
  }).filter((group) => group.entries.length), [sources]);

  return (
    <>
      <a className="skip-link" href="#main-content">본문으로 건너뛰기</a>
      <header className="topbar">
        <a className="brand" href="#top" aria-label="AgendaFrame 홈"><span className="brand-mark" aria-hidden="true">AF</span><span className="brand-copy"><b>AgendaFrame</b><small>보도 근거 비교</small></span></a>
        <nav className="topnav" aria-label="주요 메뉴"><a href="#agenda-workspace">날짜별 의제</a><button type="button" onClick={() => setMethodOpen(true)}>방법론</button></nav>
        <div className="top-actions"><span className={`demo-badge live freshness-${freshness.status}`}><i aria-hidden="true" /> {freshness.label}</span><button className="refresh-button" type="button" onClick={refreshAll} disabled={refreshing} aria-label={refreshing ? "업데이트 확인 중" : "데이터 업데이트 확인"} aria-describedby="refresh-status"><span aria-hidden="true">↻</span><span>{refreshing ? "확인 중" : "업데이트 확인"}</span></button><span className="sr-only" id="refresh-status" role="status" aria-live="polite">{refreshMessage}</span></div>
      </header>

      <div id="top" />
      <main id="main-content" tabIndex={-1}>
        <section className="overview" aria-labelledby="hero-title">
          <div className="overview-copy">
            <p className="context-label">날짜별 보도 비교</p>
            <h1 id="hero-title">같은 사건,<br />매체별 근거로 나란히 봅니다.</h1>
            <p className="overview-description">오늘은 {ISSUE_SCOPE_LABEL}의 온라인 기사만 같은 사건별로 묶어 비교합니다. 근거가 부족한 분석은 제공하지 않고, 비교할 수 있는 부분과 아직 판단할 수 없는 부분을 구분합니다.</p>
            <div className="overview-actions"><a className="primary-action" href="#agenda-workspace">날짜별 의제 비교하기</a><button className="secondary-action" type="button" onClick={() => setMethodOpen(true)}>분석 범위 확인</button></div>
            {!bodyEvidenceCount && <p className="evidence-limit"><strong>현재 본문 근거 없음</strong><span>프레임 탭에는 기사 제목에서 확인된 표현 단서만 표시됩니다.</span></p>}
            {!currentSnapshot && <p className="freshness-warning" role="status"><strong>{freshness.label}</strong>{freshness.staleDays ? ` · 기준일로부터 ${freshness.staleDays}일 지났습니다.` : " · 최신 수집 상태를 확인해 주세요."}</p>}
          </div>
          <dl className="overview-status" aria-label="현재 분석 범위">
            <div><dt>자료 기준</dt><dd>{basisDate?.replaceAll("-", ".") ?? "확인 중"}</dd></div>
            <div><dt>분석 매체</dt><dd>{configuredSourceCount}개 언론사</dd></div>
            <div><dt>전체 수집 기사</dt><dd>{(health?.collection.articleCount ?? 0).toLocaleString("ko-KR")}건</dd></div>
            <div><dt>현재 근거</dt><dd>{bodyEvidenceCount ? `본문 구조화 초안 ${bodyEvidenceCount.toLocaleString("ko-KR")}건` : "제목·배치 메타데이터"}</dd></div>
            <div><dt>사람 검토</dt><dd>진행 전</dd></div>
            <div><dt>최근 분석</dt><dd>{formatDateTime(health?.timestamps?.analyzedAt)}</dd></div>
          </dl>
        </section>

        <section className="workspace" id="agenda-workspace" aria-label="뉴스 이슈 비교">
          <aside className="ranking-panel" aria-labelledby="ranking-title">
              <div className="section-heading agenda-heading">
              <div><p className="context-label">{ISSUE_SCOPE_LABEL} · 보도 확산 상위</p><h2 id="ranking-title">{formatAgendaDate(basisDate)} 주요 의제</h2><p className="section-description">날짜를 고른 뒤 상위 5개 의제 중 하나를 선택하세요.</p></div>
              <label className="issue-date-control" htmlFor="issue-date">
                <span>분석 기준일</span>
                <select id="issue-date" value={issueDate} disabled={!availableDates.length} onChange={(event) => handleIssueDate(event.target.value)}>
                  {!availableDates.length && <option value={issueDate}>{issueDate || "분석일 없음"}</option>}
                  {availableDates.map((entry) => <option key={entry.date} value={entry.date}>{entry.date.replaceAll("-", ".")} · {entry.issueCount}개</option>)}
                </select>
              </label>
            </div>
            <div className="issue-count-row"><span className="issue-count">{issues.length}/{issueTotal}개</span></div>
            <div className="filter-row" aria-label="분야별 이슈 보기">
              {categoryOptions.map((value) => <button key={value} type="button" className={`filter-pill${category === value ? " active" : ""}`} aria-pressed={category === value} onClick={() => handleCategory(value)}>{value}</button>)}
            </div>
            <div className="agenda-list" aria-busy={loadingIssues}>
              {loadingIssues ? <div className="skeleton-stack" role="status" aria-label="선택한 날짜의 의제를 불러오는 중">{[0, 1, 2, 3].map((item) => <i className="skeleton-row" key={item} aria-hidden="true" />)}</div> : issueError ? <div className="empty-state error-state" role="alert"><strong>의제를 불러오지 못했습니다.</strong><span>{issueError}</span><button type="button" onClick={() => loadIssues(category, issueDate)}>의제 다시 불러오기</button></div> : issues.length ? issues.map((issue, index) => (
                <button key={issue.id} type="button" className={`agenda-card${issue.id === selectedIssueId ? " active" : ""}`} aria-pressed={issue.id === selectedIssueId} aria-current={issue.id === selectedIssueId ? "true" : undefined} aria-controls="issue-analysis-panel" onClick={() => selectIssue(issue.id)}>
                  <span className="agenda-rank">{index + 1}</span>
                  <span className="agenda-copy"><span className="agenda-meta"><b className="category-tag">{issue.category}</b>{issue.sourceCount}/{configuredSourceCount}개 매체 · 관련 기사 {issue.articleCount}건</span><strong>{naturalIssueTitle(issue.title)}</strong><small>{issue.scoreStatus === "legacy_reanalysis_required" ? "재분석 대기" : issue.scoreStatus === "scope_observed_components" ? "10대 종합일간지 기준" : "의제 자동 묶음 · 검토 전"}</small></span>
                  <span className="agenda-score"><strong>{issue.agendaScore === null ? "–" : Math.round(issue.agendaScore)}</strong><small>{issue.agendaScore === null ? "보류" : "표본 확산"}</small></span>
                </button>
              )) : <div className="empty-state"><strong>표시할 이슈가 없습니다.</strong><span>선택한 분야에 분석된 기사 제목이 아직 없습니다.</span></div>}
            </div>
            <p className="panel-note"><span aria-hidden="true">ⓘ</span> 상위 5개는 {ISSUE_SCOPE_LABEL} 안의 기사 수·참여 매체를 기준으로 정렬합니다. 사회적 중요도·사실성·여론을 뜻하지 않습니다. 기사 수가 적은 경우에는 서로 다른 사건을 섞지 않도록 묶음을 분리한 결과일 수 있습니다.</p>
          </aside>

          <article className="detail-panel" id="issue-analysis-panel" aria-live="polite">
            {!selectedIssue ? <div className="empty-state detail-empty"><strong>비교할 이슈를 선택해 주세요.</strong><span>이슈를 선택하면 매체별 제목과 현재 확인 가능한 근거가 여기에 나타납니다.</span></div> : detailError ? <div className="empty-state error-state" role="alert"><strong>이슈 근거를 불러오지 못했습니다.</strong><span>{detailError}</span><button type="button" onClick={retryDetail}>근거 다시 불러오기</button></div> : !detail || detail.issue.id !== selectedIssueId ? <div className="skeleton-detail" role="status" aria-label="선택한 이슈의 근거를 불러오는 중"><i className="skeleton-line" aria-hidden="true" /><i className="skeleton-line" aria-hidden="true" /><i className="skeleton-line" aria-hidden="true" /><i className="skeleton-line" aria-hidden="true" /></div> : (
              <>
                <div className="analysis-tabs analysis-tabs-top" role="tablist" aria-label="이슈 분석 보기">
                  {analysisTabs.map(([value, label]) => <button key={value} id={`analysis-tab-${value}`} type="button" role="tab" aria-selected={tab === value} aria-controls={`analysis-panel-${value}`} tabIndex={tab === value ? 0 : -1} className={tab === value ? "active" : ""} onKeyDown={(event) => handleTabKeyDown(event, value)} onClick={() => setTab(value)}>{label}</button>)}
                </div>
                <button className="mobile-back" type="button" onClick={() => {
                  const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
                  document.getElementById("ranking-title")?.scrollIntoView({ behavior, block: "start" });
                }}>← 이슈 목록</button>
                <div className="detail-kicker"><p>{detail.issue.category} · {detail.issue.issueDate} · {ISSUE_SCOPE_LABEL} {detail.issue.sourceCount}곳</p><span className="confidence review">{detail.issue.scoreStatus === "legacy_reanalysis_required" ? "재분석 필요" : detail.issue.scoreStatus === "scope_observed_components" ? "표본 기준 자동 정렬" : "자동 분석 · 검토 전"}</span></div>
                <div className="detail-title-row"><div><h2 ref={detailTitleRef} tabIndex={-1}>{naturalIssueTitle(detail.issue.title)}</h2><p className="detail-summary">{detail.issue.summary}</p></div><div className="big-score"><strong>{detail.issue.agendaScore === null ? "–" : Math.round(detail.issue.agendaScore)}</strong><span>{detail.issue.agendaScore === null ? "산출 보류" : "10대 종합일간지 확산 /100"}</span></div></div>
                <div className="detail-metrics"><span>관련 제목 <b>{detail.issue.articleCount}건</b></span><span>포함 매체 <b>{detail.issue.sourceCount}/{configuredSourceCount}곳</b></span><span>본문 단서 <b>{detail.issue.contentAvailableCount}/{detail.issue.articleCount}건</b></span><span>사람 검토 <b>미완료</b></span></div>
                {(() => {
                  const diagnostic = getClusterDiagnostic(detail);
                  return <aside className={`cluster-diagnostic ${diagnostic.tone}`} aria-label="기사 묶음 진단"><div className="cluster-diagnostic-heading"><strong>기사 묶음 진단</strong><span>{diagnostic.label}</span></div><p>{diagnostic.reason}</p><small>{diagnostic.articleCount}건 · 최저 제목 유사도 {diagnostic.minSimilarity === null ? "확인 불가" : `${diagnostic.minSimilarity}%`} · 중앙값 {diagnostic.medianSimilarity === null ? "확인 불가" : `${diagnostic.medianSimilarity}%`}</small></aside>;
                })()}
                <details className="score-details"><summary>점수 근거와 관측 범위</summary><div className="score-breakdown"><ScorePart label="독립 미디어그룹 커버리지" value={detail.issue.diversityScore} /><ScorePart label="홈페이지 배치" value={detail.issue.placementScore} note={`${detail.issue.placementObservedCount}/${detail.issue.placementTotalCount}건 관측`} /><ScorePart label="기사량" value={detail.issue.volumeScore} /><ScorePart label="후속 보도량" value={detail.issue.followUpVolumeScore} /></div><p>현재 상위 5개 정렬은 국내 10대 종합일간지 안에서 참여 매체 60%와 기사량(최대 10건) 40%를 사용합니다. 홈페이지 배치와 후속 보도는 별도 관측값으로 보여주며, 동일 미디어그룹은 커버리지에서 한 번만 셉니다. 이 점수는 중요도·진실성·여론을 뜻하지 않습니다.</p></details>
                {tab === "compare" && (
                  <div id="analysis-panel-compare" role="tabpanel" aria-labelledby="analysis-tab-compare" className="evidence-first">
                    {hasStructuredComparison(detail.comparison)
                      ? <FramingEditorialView comparison={detail.comparison} articles={detail.articles} />
                      : <LegacyComparisonView comparison={detail.comparison} articles={detail.articles} openArticles={() => setTab("articles")} />}
                  </div>
                )}
                {tab === "outlets" && <div id="analysis-panel-outlets" role="tabpanel" aria-labelledby="analysis-tab-outlets" className="outlet-list"><p className="expert-note"><strong>읽는 법</strong> 기사 수와 홈페이지 배치는 편향·사실성·논조를 판정하는 값이 아닙니다.</p><div className="outlet-head"><span>언론사</span><span>기사</span><span>홈 배치</span><span>대표 제목</span></div>{detail.outlets.map((outlet) => { const article = detail.articles.find((entry) => entry.source === outlet.source); const placement = outletPlacementLabels[outlet.placement] ?? outlet.placement; return <div className="outlet-row" key={outlet.source}><strong>{outlet.source}</strong><b>{outlet.articleCount}건</b><span className={`placement-badge${placement === "관측 없음" ? " unknown" : ""}`}>{placement}</span><p>{article ? <a href={article.url} target="_blank" rel="noopener noreferrer">{article.title}</a> : "대표 제목 미확인"}</p></div>; })}</div>}
                {tab === "frames" && <div id="analysis-panel-frames" role="tabpanel" aria-labelledby="analysis-tab-frames" className="frame-layout">{detail.frames.length ? <><p className="expert-note frame-note"><strong>보조 지표</strong> {bodyBackedFrameCount ? `본문에서 관측한 일반 프레임 태그 ${bodyBackedFrameCount}개와 제목 단서를 구분해 표시합니다.` : "현재는 제목에 포함된 보조 표현 태그만 표시합니다."} 이 탭은 문제 정의·원인·책임·평가·해법 비교를 대체하지 않으며, 합계도 100%가 아닙니다.</p><FrameCompositionByOutlet frames={detail.frames} /><div className="frame-chart">{detail.frames.map((frame) => <div className="frame-row" key={frame.frame}><span>{frameLabels[frame.frame] ?? frame.frame}</span><div aria-hidden="true"><i style={{ width: `${frame.score}%`, background: frameColors[frame.frame] }} /></div><b>{frame.score > 0 ? `${frame.score.toFixed(1)}%` : "검출 없음"}</b></div>)}</div><div className="evidence-panel"><h3>관측된 보조 표현 태그</h3>{detectedFrames.length ? detectedFrames.map((frame) => <article key={frame.frame}><span style={{ color: frameColors[frame.frame] }}>{frameLabels[frame.frame]}</span><p>{frame.evidenceText}</p><small><b>{frame.evidenceBasis === "headline" ? "제목 단서" : frame.evidenceBasis === "body_transient" ? "임시 본문 분석 · 전문 미저장" : frame.evidenceBasis === "body_public" ? "이용 허가 본문" : "비공개 본문·문장 검토 전"}</b>{frame.sourceUrl ? <> · <a href={frame.sourceUrl} target="_blank" rel="noopener noreferrer">{frame.source ?? "원문"}에서 확인 →</a></> : ` · ${frame.source ?? "출처 미확인"}`}</small></article>) : <p className="withheld">현재 근거 범위에서는 사전에 정의된 보조 표현 태그를 검출하지 못했습니다.</p>}</div></> : <p className="withheld">기존 분석은 근거 오류 가능성이 있어 숨겼습니다. 재분석 뒤 실제로 검출된 보조 태그만 표시합니다.</p>}</div>}
                {tab === "articles" && <div id="analysis-panel-articles" role="tabpanel" aria-labelledby="analysis-tab-articles" className="article-table"><div className="article-tools"><div><strong>관련 원문 {detail.articles.length}건</strong><p>제목 유사도는 같은 사건을 묶기 위한 참고값이며 기사 신뢰도 점수가 아닙니다.</p></div></div><div>{detail.articles.map((article) => <article className="article-item" key={article.id}><span className="article-outlet">{article.source}</span><div><strong>{article.title}</strong><small>{formatDateTime(article.publishedAt)} · 대표 제목과 단어 유사도 {Math.round((article.similarity ?? 0) * 100)}% · {article.contentAvailable ? "본문 구조화 초안 있음" : "제목 근거만 있음"}</small></div><a className="article-link" href={article.url} target="_blank" rel="noopener noreferrer">원문 열기</a></article>)}</div></div>}
                {tab === "chat" && <div id="analysis-panel-chat" role="tabpanel" aria-labelledby="analysis-tab-chat" className="analysis-tool-panel"><EvidenceChat issueId={detail.issue.id} /></div>}
                {tab === "selfcheck" && <div id="analysis-panel-selfcheck" role="tabpanel" aria-labelledby="analysis-tab-selfcheck" className="analysis-tool-panel"><SelfCheck /></div>}
                {tab === "community" && <div id="analysis-panel-community" role="tabpanel" aria-labelledby="analysis-tab-community" className="analysis-tool-panel"><CommunityPanel issueId={detail.issue.id} /></div>}
              </>
            )}
          </article>
        </section>

        <section className="live-feed archive-section" id="live-feed" aria-labelledby="live-feed-title">
          <details className="archive-disclosure" onToggle={(event) => {
            if (!event.currentTarget.open || archiveRequestedRef.current) return;
            archiveRequestedRef.current = true;
            loadArticles({ nextFilters: appliedFilters });
          }}>
            <summary><span><b id="live-feed-title">기사 자료 아카이브</b><small>의제 상세의 관련 기사만으로 부족할 때 제목·매체·게시일로 찾아봅니다.</small></span><span className="archive-action">기사 찾기</span></summary>
            <div className="archive-body">
              <div className="section-heading live-heading"><div><p className="context-label">보조 자료</p><h2>전체 기사 검색</h2><p className="section-description">수집된 기사 메타데이터를 원문 링크와 함께 확인하고, 필요하면 네 개 의제 분야로 좁혀 보세요.</p></div><p>{articles.length.toLocaleString("ko-KR")}/{articleTotal.toLocaleString("ko-KR")}건 표시</p></div>
              <form className="live-filter-form" role="search" onSubmit={submitFilters}>
                <label><span>기사 제목</span><input type="search" maxLength={100} value={filters.q} onChange={(event) => setFilters({ ...filters, q: event.target.value })} placeholder="예: 보완수사권" /></label>
                <label><span>언론사</span><select value={filters.source} onChange={(event) => setFilters({ ...filters, source: event.target.value })}><option value="">전체</option>{sourceGroups.map((group) => <optgroup key={group.sourceType} label={group.label}>{group.entries.map((source) => <option key={source.id} value={source.name}>{source.name}</option>)}</optgroup>)}</select></label>
                <label><span>분야</span><select value={filters.section} onChange={(event) => setFilters({ ...filters, section: event.target.value })}><option value="">전체</option>{["정치","경제","사회","국제"].map((section) => <option key={section}>{section}</option>)}</select></label>
                <label><span>게시일</span><input type="date" value={filters.articleDate} onChange={(event) => setFilters({ ...filters, articleDate: event.target.value })} /></label>
                <div className="live-filter-actions"><button type="submit" disabled={articleLoading}>{articleLoading ? "검색 중…" : "검색"}</button><button type="button" onClick={resetFilters}>초기화</button></div>
              </form>
              {articleError ? <p className="live-empty error-state" role="alert"><strong>기사 목록을 갱신하지 못했습니다.</strong><span>{articleError}</span><button type="button" onClick={() => loadArticles()}>기사 다시 불러오기</button></p> : articleLoading && !articles.length ? <p className="live-empty" role="status">조건에 맞는 기사를 찾고 있습니다…</p> : !articles.length ? <p className="live-empty"><strong>조건에 맞는 기사가 없습니다.</strong><span>검색어를 줄이거나 날짜·분야 필터를 지워 보세요.</span></p> : <div className="live-article-grid" aria-busy={articleLoading}>{articles.map((article) => <article className="live-article" key={article.id}><div className="live-article-meta"><span className="live-source">{article.source}</span><span>{article.section ?? "분야 미분류"}</span>{article.contentAvailable ? <span className="content-evidence-badge">승인 본문</span> : null}</div><h3><a href={article.url} target="_blank" rel="noopener noreferrer">{article.title}</a></h3><p className="live-article-detail">게시 {formatDateTime(article.publishedAt)}<br />홈페이지 {article.homepagePlacement ? placementLabels[article.homepagePlacement] : "배치 관측 없음"}{article.homepageRank ? ` · ${article.homepageRank}위` : ""}{article.placementObservationCount ? ` · ${article.placementObservationCount}회 관측` : ""}</p><a className="live-original" href={article.url} target="_blank" rel="noopener noreferrer">원문 열기 <span aria-hidden="true">→</span></a></article>)}</div>}
              <div className="live-pagination">{articleOffset < articleTotal && <button type="button" disabled={articleLoading} onClick={() => loadArticles({ append: true })}>{articleLoading ? "기사 불러오는 중…" : "기사 12건 더 보기"}</button>}</div>
              <p className="panel-note"><span aria-hidden="true">ⓘ</span> 기사 전문은 명시적인 이용 근거가 확인된 자료만 비공개 분석 저장소에 보관합니다. 공개 화면에는 전문을 제공하지 않습니다.</p>
            </div>
          </details>
        </section>

        <section className="method-preview" id="comparison" aria-labelledby="method-title"><div><p className="context-label">서비스 원칙</p><h2 id="method-title">이 서비스가 판단하지 않는 것</h2><p>AgendaFrame은 언론사의 옳고 그름을 채점하지 않습니다. 사용자가 원문을 비교할 때 필요한 관측값과 근거의 빈칸을 함께 보여줍니다.</p></div><div className="principles"><article><span>근거</span><h3>근거가 없으면 보류</h3><p>본문에 없는 사실·원인·취재원을 추정하지 않고, 확인할 수 없는 이유를 표시합니다.</p></article><article><span>구분</span><h3>사건과 설명을 분리</h3><p>같은 주제 안의 다른 사건은 분리하고, 설명 차이는 인용 가능한 근거가 있을 때만 묶습니다.</p></article><article><span>범위</span><h3>점수의 의미를 제한</h3><p>보도 집중도는 표본의 노출량입니다. 중요도·신뢰도·여론처럼 읽히지 않도록 범위를 붙입니다.</p></article></div></section>
      </main>

      <footer><div className="brand footer-brand"><span className="brand-mark" aria-hidden="true">AF</span><span className="brand-copy"><b>AgendaFrame</b><small>보도 근거 비교</small></span></div><p>전체 수집 22개 종합일간지·경제매체·뉴스통신사 온라인 표본 · 현재 비교 국내 10대 종합일간지 · 방송 제외 · 자동 분석 검토 전</p><button type="button" onClick={() => setMethodOpen(true)}>방법론과 한계</button></footer>

      <dialog ref={methodDialogRef} className="modal" aria-labelledby="method-dialog-title" aria-describedby="method-dialog-description" onCancel={() => setMethodOpen(false)} onClose={() => setMethodOpen(false)}><form method="dialog"><button className="modal-close" aria-label="방법론 닫기">×</button></form><p className="context-label">국내 10대 종합일간지 표본</p><h2 id="method-dialog-title">집중도는 중요도 점수가 아닙니다</h2><p className="modal-lead" id="method-dialog-description">전체 수집 표본은 22개 주요 종합일간지·경제매체·뉴스통신사이며, 현재 비교 화면은 그중 국내 10대 종합일간지 온라인 기사만 사용합니다. 상위 5개는 이 표본 안에서 사건이 얼마나 넓게 반복 노출됐는지 보여주는 0–100 지표입니다. 사회적 중요도·진실성·기사 품질·여론을 평가하지 않습니다.</p><div className="formula" aria-label="국내 10대 종합일간지 표본 확산 가중치"><span>참여 매체 비율 <b>60%</b></span><i>+</i><span>기사량(최대 10건) <b>40%</b></span></div><p className="modal-detail">동일 미디어그룹의 여러 매체는 커버리지에서 한 번만 셉니다. 홈페이지 배치와 후속 보도는 별도 관측값으로 보여주며, TV 편성·영상 리포트와 온라인 기사 배열을 같은 기준으로 비교할 수 없어 방송사는 표본에서 제외했습니다.</p><p className="method-caution"><strong>현재 제공 범위</strong> 이슈 묶음과 표본 확산은 제목·배치 메타데이터를 사용합니다. 이용 권한이 확인된 본문은 비공개로 분석하고, 공개 기사 본문은 메모리에서 임시 분석한 뒤 폐기합니다. 문제·원인·책임·평가·해법과 취재원 구성은 근거 위치에 연결한 자동 구조화 초안으로 제공하며, 사람 검토 전 결과이므로 사실성·편향·의도 판정이 아닙니다.</p></dialog>
    </>
  );
}
