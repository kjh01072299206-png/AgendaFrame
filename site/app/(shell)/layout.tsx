import { getActiveSnapshot } from "../../lib/active-snapshot";
import { deriveDay } from "../../lib/initial-five/derive";
import { getEditorialCoverage } from "../../lib/editorial-review";
import { ShellChrome, type ShellIssue } from "./shell-chrome";

export const dynamic = "force-dynamic";

export default async function ShellLayout({ children }: { children: React.ReactNode }) {
  const active = await getActiveSnapshot();
  const day = deriveDay(active);
  const coverage = getEditorialCoverage(active.manifest.issues.map(issue => issue.issueId), day.basisDate);
  const issues: ShellIssue[] = active.manifest.issues
    .slice()
    .sort((a, b) => a.rank - b.rank)
    .map((issue) => ({ issueId: issue.issueId, rank: issue.rank, title: issue.title, category: issue.category }));

  return <ShellChrome fallbackIssues={issues} fallbackMeta={{
    basisDate: day.basisDate,
    articleCount: coverage?.articleCount ?? day.articleCount,
    outletCount: coverage?.outletCount ?? day.outletCount,
    issueCount: day.issueCount,
  }}>{children}</ShellChrome>;
}
