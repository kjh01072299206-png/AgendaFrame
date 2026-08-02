import manifestJson from "../../public/initial-five/manifest.json";
import issueOneJson from "../../public/initial-five/issues/bigkinds-2026-07-26-top-1.json";
import issueTwoJson from "../../public/initial-five/issues/bigkinds-2026-07-26-top-2.json";
import issueThreeJson from "../../public/initial-five/issues/bigkinds-2026-07-26-top-3.json";
import issueFourJson from "../../public/initial-five/issues/bigkinds-2026-07-26-top-4.json";
import issueFiveJson from "../../public/initial-five/issues/bigkinds-2026-07-26-top-5.json";
import type { InitialFiveManifest, IssueAnalysisBundle } from "./types";

export const initialFiveManifest = manifestJson as InitialFiveManifest;

const issueBundles = new Map<string, IssueAnalysisBundle>([
  [issueOneJson.issue.issueId, issueOneJson as IssueAnalysisBundle],
  [issueTwoJson.issue.issueId, issueTwoJson as IssueAnalysisBundle],
  [issueThreeJson.issue.issueId, issueThreeJson as IssueAnalysisBundle],
  [issueFourJson.issue.issueId, issueFourJson as IssueAnalysisBundle],
  [issueFiveJson.issue.issueId, issueFiveJson as IssueAnalysisBundle],
]);

export function getInitialFiveIssueBundle(issueId: string) {
  return issueBundles.get(issueId) ?? null;
}

export function getInitialFiveIssueBundleByRank(rank: number) {
  const issue = initialFiveManifest.issues.find((candidate) => candidate.rank === rank);
  return issue ? getInitialFiveIssueBundle(issue.issueId) : null;
}
