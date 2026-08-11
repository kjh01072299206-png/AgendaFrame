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
