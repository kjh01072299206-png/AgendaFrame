import manifestJson from "../../public/initial-five/manifest.json";
import issueOneJson from "../../public/initial-five/issues/live-2026-08-15-top-1.json";
import issueTwoJson from "../../public/initial-five/issues/live-2026-08-15-top-2.json";
import issueThreeJson from "../../public/initial-five/issues/live-2026-08-15-top-3.json";
import issueFourJson from "../../public/initial-five/issues/live-2026-08-15-top-4.json";
import issueFiveJson from "../../public/initial-five/issues/live-2026-08-15-top-5.json";
import type { InitialFiveManifest, IssueAnalysisBundle } from "./types";

export const initialFiveManifest = manifestJson as unknown as InitialFiveManifest;

const issueBundles = new Map<string, IssueAnalysisBundle>([
  [issueOneJson.issue.issueId, issueOneJson as unknown as IssueAnalysisBundle],
  [issueTwoJson.issue.issueId, issueTwoJson as unknown as IssueAnalysisBundle],
  [issueThreeJson.issue.issueId, issueThreeJson as unknown as IssueAnalysisBundle],
  [issueFourJson.issue.issueId, issueFourJson as unknown as IssueAnalysisBundle],
  [issueFiveJson.issue.issueId, issueFiveJson as unknown as IssueAnalysisBundle],
]);

export function getInitialFiveIssueBundle(issueId: string) {
  return issueBundles.get(issueId) ?? null;
}

export function getInitialFiveIssueBundleByRank(rank: number) {
  const issue = initialFiveManifest.issues.find((candidate) => candidate.rank === rank);
  return issue ? getInitialFiveIssueBundle(issue.issueId) : null;
}
