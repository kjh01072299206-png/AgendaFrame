import { getActiveSnapshot } from "../../lib/active-snapshot";
import { deriveDay } from "../../lib/initial-five/derive";
import { ShellChrome, type ShellIssue } from "./shell-chrome";

export const dynamic = "force-dynamic";

export default async function ShellLayout({ children }: { children: React.ReactNode }) {
  const active = await getActiveSnapshot();
  const day = deriveDay(active);
  const issues: ShellIssue[] = active.manifest.issues
    .slice()
    .sort((a, b) => a.rank - b.rank)
    .map((issue) => ({ issueId: issue.issueId, rank: issue.rank, title: issue.title, category: issue.category }));

  return <ShellChrome fallbackIssues={issues} fallbackMeta={{
    basisDate: day.basisDate,
    articleCount: day.articleCount,
    outletCount: day.outletCount,
    issueCount: day.issueCount,
  }}>{children}</ShellChrome>;
}
