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

export async function fetchLiveIssueList(limit = 5): Promise<LiveIssueList> {
  const dates = await readJson<{
    dates: Array<{ date: string; articleCount: number; issueCount: number }>;
    scope: { configuredSources: number };
  }>(`/api/issues/dates?limit=31&scope=${LIVE_SCOPE}`);
  const latest = dates.dates[0];
  if (!latest) throw new Error("분석된 최신 의제가 없습니다.");
  const payload = await readJson<{ issues: LiveIssueSummary[]; total: number }>(
    `/api/issues?limit=${limit}&scope=${LIVE_SCOPE}&date=${encodeURIComponent(latest.date)}`,
  );
  return {
    date: latest.date,
    articleCount: latest.articleCount,
    issueCount: payload.total || latest.issueCount,
    configuredSources: dates.scope.configuredSources || 12,
    issues: payload.issues,
  };
}

export async function fetchLiveIssueDetail(issueId: string): Promise<LiveIssueDetail> {
  return readJson<LiveIssueDetail>(`/api/issues/${encodeURIComponent(issueId)}?scope=${LIVE_SCOPE}`);
}
