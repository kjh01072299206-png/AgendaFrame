import Link from "next/link";
import { SavedIssueList, SaveIssueButton } from "./saved-issues";
import { deriveDay } from "../../lib/initial-five/derive";
import { comparisonSummary } from "../../lib/initial-five/analysis-summary";
import { stripEvidenceTokens } from "../../lib/initial-five/public-text.mjs";
import type { ActiveSnapshotSource } from "../../lib/active-snapshot";

/** Prototype composition, populated exclusively from the active snapshot. */
export function ActiveSnapshotHome({ active }: { active: ActiveSnapshotSource }) {
  const day = deriveDay(active);
  const issues = active.manifest.issues.slice().sort((a, b) => a.rank - b.rank);
  const top = issues[0];
  const topBundle = top ? active.getIssueBundle(top.issueId) : null;
  const summary = topBundle ? comparisonSummary(topBundle) : null;
  const groups = summary?.status === "difference_confirmed" ? summary.groups.slice(0, 2) : [];
  const total = day.categories.reduce((sum, row) => sum + row.count, 0);
  return (
    <div className="afp-home">
      <header className="afp-home-head">
        <div><h1>홈 <span>오늘의 의제</span></h1><p>오늘의 의제 순위와 갈림 한 장면입니다.</p></div>
        {top ? <Link className="afp-home-report" href={`/issues/${encodeURIComponent(top.issueId)}/report`}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h5" /></svg>리포트로 보기</Link> : null}
      </header>
      <div className="afp-home-bar">
        <span>{day.basisDate} · 기사 {day.articleCount}건 · 매체 {day.outletCount}곳</span>
        <div className="afp-home-periods" role="group" aria-label="집계 기간">
          <button type="button" aria-pressed="true">오늘</button>
          <button type="button" disabled title="주간 집계가 아직 없습니다">이번 주</button>
          <button type="button" disabled title="월간 집계가 아직 없습니다">최근 1개월</button>
        </div>
      </div>
      <SavedIssueList />
      {active.publicationStatus !== "published" ? <p className="afp-home-note" role="status">기사 표본의 비교·프레이밍 분석 검증 중입니다.</p> : null}
      <section className="afp-home-panel">
        <h2>그날 언론이 가장 많이 다룬 분야</h2>
        <div className="afp-home-in">
          <p className="afp-home-note">현재 공개 의제의 기사 표본을 놓고 보는 분포입니다.</p>
          <div className="afp-home-categories" role="group" aria-label="공개 의제 분야별 기사 수 분포">
            {day.categories.map((row) => <div className="afp-home-category" key={row.key}>
              <span>{row.label}</span><div aria-hidden="true"><i style={{ width: `${total ? row.count / total * 100 : 0}%` }} /></div><b>{row.count}건</b>
            </div>)}
          </div>
          <p className="afp-home-note">{day.outletCount}개 언론사 · {day.basisDate} 기준 · {total}건. 하루 전체 수집분이 아닌 공개된 상위 {issues.length}개 의제의 분포입니다.</p>
        </div>
      </section>
      <section className="afp-home-panel">
        <h2>오늘의 의제 순위</h2>
        <div className="afp-home-in">
          <p className="afp-home-note">카드를 누르면 그 의제의 언론사 비교로 이동합니다.</p>
          <div className="afp-home-issues">
            {issues.map((issue) => {
              const bundle = active.getIssueBundle(issue.issueId);
              const text = bundle?.clusterAi.summary ?? "검증된 공개 요약이 아직 없습니다.";
              return <article className="afp-home-issue" key={issue.issueId}>
                <Link className="afp-home-issue-link" href={`/issues/${encodeURIComponent(issue.issueId)}/outlets`}>
                  <span className="afp-home-rank afs-num">{issue.rank}</span>
                  <h3>{issue.title}</h3><p>{stripEvidenceTokens(text)}</p>
                  <dl><div><dt>기사</dt><dd>{issue.articleCount}</dd></div><div><dt>매체</dt><dd>{issue.outletCount}</dd></div></dl>
                  <span className="afp-home-open">이 의제 보기 ›</span>
                </Link>
                <SaveIssueButton issueId={issue.issueId} title={issue.title} compact />
                <Link className="afp-home-framing" href={`/issues/${encodeURIComponent(issue.issueId)}/framing`}>프레이밍 분석 ›</Link>
              </article>;
            })}
          </div>
        </div>
      </section>
      <section className="afp-home-panel">
        <h2>오늘의 갈림 한 장면</h2>
        <div className="afp-home-in">
          <p className="afp-home-note">오늘 가장 많이 보도된 의제에서, 확인된 설명 차이를 살펴봅니다.</p>
          {top ? <div className="afp-home-hero">
            <h3>{top.title}</h3>
            {groups.length >= 2 ? <div className="afp-home-segments">{groups.map((group, index) => <section key={group.key}>
              <h4><small>갈래 {index + 1}</small>{group.title}</h4>
              <p>{stripEvidenceTokens(group.emphasis)}</p>
              <div>{group.outlets.map((outlet) => <span className="afs-chip" key={outlet}>{outlet}</span>)}</div>
            </section>)}</div> : <p className="afs-hold">현재 의제에서 매체가 갈린 지점이 확인되지 않았습니다.</p>}
            <Link href={`/issues/${encodeURIComponent(top.issueId)}/outlets`}>언론사 비교로 보기 ›</Link>
          </div> : <p className="afs-hold">공개된 의제가 없습니다.</p>}
        </div>
      </section>
    </div>
  );
}
