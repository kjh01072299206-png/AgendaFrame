import Link from "next/link";
import { RankList } from "../charts";
import { SavedIssueList, SaveIssueButton } from "./saved-issues";
import type { ActiveSnapshotSource } from "../../lib/active-snapshot";
import { getEditorialReview } from "../../lib/editorial-review";

export function ActiveSnapshotHome({ active }: { active: ActiveSnapshotSource }) {
  const issues = active.manifest.issues.slice().sort((left, right) => left.rank - right.rank).map(issue => {
    const reading = getEditorialReview(issue.issueId, active.manifest.basisDate);
    return reading ? { ...issue, articleCount: reading.articleCount, outletCount: reading.outletCount } : issue;
  });
  return (
    <>
      <SavedIssueList />

      <section className="afs-card" data-publication-status={active.publicationStatus}>
        <h2>오늘의 의제</h2>
        <div className="afs-in">
          <RankList rows={issues.map((issue) => ({
            rank: issue.rank,
            title: issue.title,
            href: `/issues/${encodeURIComponent(issue.issueId)}`,
            category: issue.category,
            articleCount: issue.articleCount,
            outletCount: issue.outletCount,
            score: Number.isFinite(Number(issue.agendaScore)) ? Number(issue.agendaScore) : null,
          }))} />
        </div>
      </section>

      <section className="afs-card">
        <h2>의제별 미리보기</h2>
        <div className="afs-in">
          <div className="afs-cards">
            {issues.map((issue) => {
              const bundle = active.getIssueBundle(issue.issueId);
              const summary = getEditorialReview(issue.issueId,active.manifest.basisDate)?.insight
                ?? bundle?.comparison.data.summary_30_seconds?.main_difference
                ?? bundle?.clusterAi.summary
                ?? "검증된 공개 요약이 아직 없습니다.";
              return (
                <article className="afs-explore" key={issue.issueId}>
                  <p className="afs-explore-rank afs-num">{String(issue.rank).padStart(2, "0")}</p>
                  <h3><Link href={`/issues/${encodeURIComponent(issue.issueId)}`}>{issue.title}</Link></h3>
                  <p className="afs-explore-meta">
                    기사 {issue.articleCount}건 · 매체 {issue.outletCount}곳
                    <SaveIssueButton issueId={issue.issueId} title={issue.title} compact />
                  </p>
                  <p className="afs-explore-hot">{summary}</p>
                  <div className="afs-explore-links" style={{ display: "flex", gap: "8px", marginTop: "12px" }}>
                    <Link className="afs-pill afs-pill-go" href={`/issues/${encodeURIComponent(issue.issueId)}/outlets`}>
                      언론사 비교
                    </Link>
                    <Link className="afs-pill" href={`/issues/${encodeURIComponent(issue.issueId)}/framing`}>
                      프레이밍 분석 →
                    </Link>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </section>
    </>
  );
}
