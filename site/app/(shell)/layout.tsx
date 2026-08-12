import { getActiveSnapshot } from "../../lib/active-snapshot";
import { deriveDay } from "../../lib/initial-five/derive";
import { ScrollTop } from "./scroll-top";
import { ShellSide, ShellTop, type ShellIssue } from "./shell-chrome";

export const dynamic = "force-dynamic";

export default async function ShellLayout({ children }: { children: React.ReactNode }) {
  const active = await getActiveSnapshot();
  const day = deriveDay(active);
  const issues: ShellIssue[] = active.manifest.issues
    .slice()
    .sort((a, b) => a.rank - b.rank)
    .map((issue) => ({ issueId: issue.issueId, rank: issue.rank, title: issue.title, category: issue.category }));

  return (
    <div className="afs-shell">
      <ScrollTop />
      <a className="afs-skip" href="#afs-main">
        본문으로 건너뛰기
      </a>
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
        <main id="afs-main" className="afs-body">
          {children}
        </main>
      </div>
    </div>
  );
}
