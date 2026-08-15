import Link from "next/link";
import { RankList } from "../charts";
import { SavedIssueList, SaveIssueButton } from "./saved-issues";
import { deriveDay } from "../../lib/initial-five/derive";
import type { ActiveSnapshotSource } from "../../lib/active-snapshot";

function formatDate(iso: string) {
  const [year, month, day] = iso.split("-");
  return `${year}년 ${Number(month)}월 ${Number(day)}일`;
}

export function ActiveSnapshotHome({ active }: { active: ActiveSnapshotSource }) {
  const day = deriveDay(active);
  const issues = active.manifest.issues.slice().sort((left, right) => left.rank - right.rank);
  return (
    <>
      <header className="afs-head">
        <span className="afs-eyebrow">{formatDate(day.basisDate)}</span>
        <h1>같은 사건을 언론사마다 어떻게 다르게 설명하나</h1>
        <p>
          GCP active snapshot에서 검증을 통과한 상위 {issues.length}개 의제를 표시합니다.
          본문은 공개하지 않고, 기사 메타데이터와 검증된 근거 위치만 제공합니다.
        </p>
      </header>

      <SavedIssueList />

      <section className="afs-card">
        <h2>오늘의 의제 <small>GCP 상위 5개 snapshot</small></h2>
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
        <h2>의제별 미리보기 <small>동일 snapshot의 비교·프레이밍 분석</small></h2>
        <div className="afs-in">
          <div className="afs-cards">
            {issues.map((issue) => {
              const bundle = active.getIssueBundle(issue.issueId);
              const summary = bundle?.comparison.data.summary_30_seconds?.main_difference
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
