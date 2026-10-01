import fs from "node:fs";
import path from "node:path";
import { isPublishableEventSynthesis } from "../lib/initial-five/publication-contract";
import type { IssueAnalysisBundle } from "../lib/initial-five/types";
import { comparisonReleaseFailures } from "./comparison-release-gate.mjs";

const root = path.resolve(process.argv[2]);
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
const rows = manifest.issues.map((issue: { issueId: string }) => {
  const bundle = JSON.parse(fs.readFileSync(path.join(root, "issues", `${issue.issueId}.json`), "utf8")) as IssueAnalysisBundle;
  return {
    route: `/issues/${issue.issueId}/outlets`,
    status: bundle.comparison?.data?.synthesis?.comparison_result?.status,
    publishable: isPublishableEventSynthesis(bundle),
  };
});
const failures = comparisonReleaseFailures(rows);
console.log(JSON.stringify({ rows, failures }, null, 2));
if (failures.length) process.exitCode = 1;
