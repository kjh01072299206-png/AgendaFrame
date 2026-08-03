import { initialFiveManifest } from "../../lib/initial-five/artifacts";
import { deriveDay } from "../../lib/initial-five/derive";
import { ShellSide, ShellTop, type ShellIssue } from "./shell-chrome";

export default function ShellLayout({ children }: { children: React.ReactNode }) {
  const day = deriveDay();
  const issues: ShellIssue[] = initialFiveManifest.issues
    .slice()
    .sort((a, b) => a.rank - b.rank)
    .map((issue) => ({ issueId: issue.issueId, rank: issue.rank, title: issue.title, category: issue.category }));

  return (
    <div className="afs-shell">
      <ShellSide
        issues={issues}
        meta={{
          basisDate: day.basisDate,
          articleCount: day.articleCount,
          outletCount: day.outletCount,
          issueCount: day.issueCount,
        }}
      />
      <div className="afs-main">
        <ShellTop issues={issues} />
        <div className="afs-body">{children}</div>
      </div>
    </div>
  );
}
