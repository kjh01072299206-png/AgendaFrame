export const LIVE_SCOPE = "academic_panel_12";

export interface LiveIssueSummary {
  id: string;
  issueDate: string;
  title: string;
  summary: string;
  category: string;
  articleCount: number;
  sourceCount: number;
  agendaScore: number | null;
  contentAvailableCount: number;
  structuredProfileCount: number;
  scoreStatus: string;
  evidenceBasis: string;
}

export interface LiveArticle {
  id: string;
  source: string;
  title: string;
  url: string;
  section: string;
  publishedAt: number;
  homepagePlacement: string | null;
  similarity: number | null;
  representative: number;
  contentAvailable: number;
}

export interface LiveFrameEvidence {
  frame: string;
  score: number;
  evidenceBasis: string;
  evidenceText: string;
  source: string;
  articleId: string;
  sourceUrl: string;
}

export interface LiveComparisonEvidence {
  claimId: string;
  articleId: string;
  source: string;
  sourceUrl: string;
  evidenceLocator: string | null;
  evidenceHash: string | null;
  voiceKind: string | null;
}

export interface LiveComparisonVariant {
  groupId: string;
  frameFamily: string | null;
  claimIds: string[];
  summary: string;
  outlets: Array<LiveComparisonEvidence & { status?: string }>;
}

export interface LiveComparisonAxis {
  dimension: string;
  label: string;
  variants: LiveComparisonVariant[];
}

export interface LiveComparisonNarrativeClause {
  dimension: string;
  label: string;
  groupId: string;
  summary: string;
  supportingArticleCount: number;
  observedArticleCount: number;
  supportShare: number;
  claimIds: string[];
  evidence: LiveComparisonEvidence[];
}

export interface LiveComparisonNarrative {
  narrativeId: string;
  status: string;
  summary: string;
  articleCount: number;
  outletCount: number;
  independentMediaGroups: number;
  completeness: number;
  supportingArticleIds: string[];
  supportingOutlets: string[];
  claimIds: string[];
  evidence: LiveComparisonEvidence[];
  problem: LiveComparisonNarrativeClause;
  cause: LiveComparisonNarrativeClause | null;
  responsibility: LiveComparisonNarrativeClause | null;
  evaluation: LiveComparisonNarrativeClause | null;
  remedy: LiveComparisonNarrativeClause | null;
}

export interface LiveFrameCompositionModule {
  status: string;
  methodVersion: string;
  taxonomyVersion: string;
  unit: string;
  multiLabel: boolean;
  byOutlet: Array<{
    source: string;
    analyzedArticles: number;
    assignmentCount: number;
    labels: Array<{
      code: string;
      label: string;
      articleCount: number;
      articleShare: number;
      sentenceCount: number;
      compositionShare: number;
      evidenceRefs: LiveComparisonEvidence[];
    }>;
  }>;
  caution?: string | null;
}

export interface LiveGenericFramesModule {
  status: string;
  methodVersion: string;
  taxonomyVersion: string;
  unit: string;
  byOutlet: Array<{
    source: string;
    analyzedArticles: number;
    frames: Array<{
      code: string;
      label: string;
      articleCount: number;
      present: boolean;
      sentenceCount: number;
      evidenceRefs: LiveComparisonEvidence[];
    }>;
  }>;
  caution?: string | null;
}

export interface LiveCompositionClustersModule {
  status: string;
  methodVersion: string;
  basis: string;
  clusters: Array<{
    clusterId: string;
    signature: string;
    title: string;
    summary: string;
    articleCount: number;
    outletCount: number;
    articleIds: string[];
    outlets: string[];
    observedDimensions: string[];
    evidenceRefs: LiveComparisonEvidence[];
  }>;
  caution?: string | null;
}

export interface LiveSemanticNetworksModule {
  status: string;
  methodVersion: string;
  basis: string;
  groups: Array<{
    clusterId: string;
    title: string;
    outlets: string[];
    articleCount: number;
    nodes: Array<{ code: string; label: string; count: number; shared: boolean }>;
    edges: Array<{ source: string; target: string; sentenceCount: number }>;
  }>;
  limitations: string[];
}

export interface LiveDevicesModule {
  status: string;
  methodVersion: string;
  byOutlet: Array<{
    source: string;
    analyzedArticles: number;
    headlineAlignment: string | null;
    devices: Array<{
      code: string;
      label: string;
      articleCount: number;
      count: number;
      leadArticleCount: number;
      evidenceRefs: LiveComparisonEvidence[];
    }>;
  }>;
  caution?: string | null;
}

export interface LiveReportingStyleModule {
  status: string;
  methodVersion: string;
  byOutlet: Array<{
    source: string;
    analyzedArticles: number;
    evaluation: {
      status: string;
      index: number | null;
      observedArticles: number;
      criticalArticles: number;
      supportiveArticles: number;
      attributedOnlyArticles: number;
      evidenceRefs: LiveComparisonEvidence[];
    };
    scope: {
      status: string;
      index: number | null;
      observedArticles: number;
      episodicSentenceCount: number;
      thematicSentenceCount: number;
      evidenceRefs: LiveComparisonEvidence[];
    };
  }>;
  caution?: string | null;
}

export interface LiveMorphologyModule {
  status: string;
  analyzer: { name: string; mode: string; version: string; dictionaryVersion: string; posTagset: string };
  minimumDocumentFrequency: number;
  minimumMediaGroupFrequency: number;
  byOutlet: Array<{
    source: string;
    analyzedArticles: number;
    tokenCount: number;
    contentTokenCount: number;
    negationCount: number;
    posCounts: Record<string, number>;
    terms: Array<{
      term: string;
      pos: string;
      count: number;
      documentCount: number;
      perThousand: number;
      evidenceRefs: LiveComparisonEvidence[];
    }>;
  }>;
  limitations: string[];
}

export interface LiveIssueDetail {
  issue: LiveIssueSummary;
  articles: LiveArticle[];
  frames: LiveFrameEvidence[];
  outlets: Array<{ source: string; articleCount: number; placementWeight: number; placement: string }>;
  report: {
    summary: string;
    missingPerspective: string;
    caution: string;
    generatedAt: number;
  };
  comparison: {
    status: string;
    evidenceBasis: string;
    reason: string;
    frameElements: Array<{ element: string; status: string; evidence: unknown[] }>;
    commonFacts: string[];
    divergenceQuestions: string[];
    sourceVoices: string[];
    articleCount: number;
    sourceCount: number;
    summary?: {
      commonGround: string | null;
      mainDifference: string | null;
      whyItMatters: string | null;
      sourceContext: string | null;
    };
    axes?: LiveComparisonAxis[];
    narratives?: LiveComparisonNarrative[];
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
    analysisModules?: {
      frameComposition: LiveFrameCompositionModule;
      genericFrames?: LiveGenericFramesModule;
      compositionClusters?: LiveCompositionClustersModule;
      semanticNetworks?: LiveSemanticNetworksModule;
      devices?: LiveDevicesModule;
      reportingStyle: LiveReportingStyleModule;
      morphology: LiveMorphologyModule;
    };
  };
}

export interface LiveIssueList {
  date: string;
  articleCount: number;
  issueCount: number;
  configuredSources: number;
  issues: LiveIssueSummary[];
}

async function readJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`live data unavailable (${response.status})`);
  return response.json() as Promise<T>;
}

const issueListCache = new Map<number, Promise<LiveIssueList>>();

export function fetchLiveIssueList(limit = 5): Promise<LiveIssueList> {
  const cached = issueListCache.get(limit);
  if (cached) return cached;
  const request = readJson<{
    run: { targetDate: string; articleCount: number; issueCount: number };
    scope: { configuredSources: number };
    issues: LiveIssueSummary[];
    total: number;
  }>(`/api/issues?limit=${limit}&scope=${LIVE_SCOPE}`).then((payload) => ({
    date: payload.run.targetDate,
    articleCount: payload.run.articleCount,
    issueCount: payload.total || payload.run.issueCount,
    configuredSources: payload.scope.configuredSources || 12,
    issues: payload.issues,
  }));
  issueListCache.set(limit, request);
  void request.catch(() => issueListCache.delete(limit));
  return request;
}

export async function fetchLiveIssueDetail(issueId: string): Promise<LiveIssueDetail> {
  return readJson<LiveIssueDetail>(`/api/issues/${encodeURIComponent(issueId)}?scope=${LIVE_SCOPE}`);
}
