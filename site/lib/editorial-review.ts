import archive from "../data/editorial-2026-10-05.json";

export type EditorialIssue = (typeof archive.issues)[number];
export type EditorialArticle = EditorialIssue["articles"][number];

/** This frozen body-reading artifact belongs only to the requested October 5 day. */
export function getEditorialReview(issueId: string, basisDate: string): EditorialIssue | null {
  if (basisDate !== archive.basisDate) return null;
  return archive.issues.find((issue) => issue.issueId === issueId) ?? null;
}

export function getEditorialCoverage(issueIds: string[], basisDate: string) {
  const issues = issueIds.map(id => getEditorialReview(id, basisDate));
  if (!issues.length || issues.some(issue => !issue)) return null;
  const articles = issues.flatMap(issue => issue!.articles);
  return { articleCount: new Set(articles.map(a => a.articleId)).size,
    outletCount: new Set(articles.map(a => a.outlet)).size };
}

export const editorialMethod = {
  source: archive.analysisSource,
  version: archive.analysisVersion,
  linguistic: archive.linguisticMethod,
};
