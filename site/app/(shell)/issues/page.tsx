import Link from "next/link";
import { HeatTable } from "../../charts";
import { DIM_LABEL, DIM_ORDER, deriveDay, type IssueView } from "../../../lib/initial-five/derive";

export const metadata = { title: "이슈 탐색 | AgendaFrame" };

/* 매체가 직접 쓴 서술 기준. 취재원 발언까지 합치면 인용을 매체 입장으로 귀속시키게 된다. */
const kindsOf = (issue: IssueView, dimension: string) =>
  new Set(issue.outlets.map((outlet) => outlet.leadNarrated[dimension]?.family).filter(Boolean)).size;
const basisOf = (issue: IssueView, dimension: string) =>
  issue.dimensionBasis.find((row) => row.dimension === dimension) ?? null;

export default function IssueExplorerPage() {
  const day = deriveDay();
  const outletColumns = day.outlets.map((outlet) => outlet.outlet);

  return (
    <>
      <header className="afs-head">
        <span className="afs-eyebrow">이슈 탐색</span>
        <h1>{day.issueCount}개 의제를 같은 자로 견줍니다</h1>
        <p>
          어느 사안을 파고들지 고르는 화면입니다. 순위나 제목이 아니라 <b>어느 층위에서 매체가 갈렸는지</b>로 견주면, 비교할
          것이 많은 사안이 먼저 보입니다.
        </p>
      </header>

      <section className="afs-card">
        <h2>
          어느 의제가 어느 층위에서 갈렸나
          <small>칸의 숫자 = 매체 서술 기준 최빈 계열 종류</small>
        </h2>
        <div className="afs-in">
          <p className="afs-note">
            1이면 매체들이 같은 방식으로 설명했고, 2 이상이면 그 층위가 매체를 가른 지점입니다. <b>빈 칸은 매체 자체 서술이
            관측되지 않은 층위</b>입니다 — 그 층위의 설명이 전부 취재원의 말로 실렸다는 뜻이며, 본문에 아무 설명이 없다는 뜻은
            아닙니다.
          </p>
          <HeatTable
            rowHead="의제"
            colorFrom={2}
            columns={DIM_ORDER.map((dim) => DIM_LABEL[dim])}
            caption="의제 × 층위 갈림 정도(매체 서술 기준) — 2 이상만 칠합니다(1은 매체가 모두 같게 설명한 층위)"
            rows={day.issues.map((issue) => ({
              label: `${issue.rank}위 ${issue.title}`,
              cells: DIM_ORDER.map((dim) => ({ value: kindsOf(issue, dim) })),
            }))}
          />
        </div>
        <p className="afs-foot">
          {(() => {
            const top = Math.max(...day.issues.map((i) => i.splitDimensions));
            const tied = day.issues.filter((i) => i.splitDimensions === top);
            const attributedOnly = day.issues
              .flatMap((issue) => DIM_ORDER.map((dim) => ({ issue, dim, basis: basisOf(issue, dim) })))
              .filter((row) => row.basis && row.basis.narratedItems === 0 && row.basis.attributedItems > 0).length;
            const tail = attributedOnly
              ? ` 빈 칸 ${attributedOnly}개는 그 층위의 설명이 전부 취재원 발언으로 실린 경우입니다.`
              : "";
            if (top === 0) return `이날은 어느 사안에서도 매체 자체 서술이 층위별로 갈리지 않았습니다.${tail}`;
            return tied.length > 1
              ? `갈린 층위 수가 가장 많은 사안은 ${top}곳으로 ${tied.length}건 동률입니다 — ${tied.map((i) => `${i.rank}위`).join(" · ")}. 이 표만으로는 우열을 정할 수 없습니다.${tail}`
              : `갈린 층위가 가장 많은 사안은 ${tied[0].rank}위(${top}곳)입니다.${tail}`;
          })()}
        </p>
      </section>

      <section className="afs-card">
        <h2>
          어느 매체가 어느 의제를 썼나
          <small>칸의 숫자 = 기사 수</small>
        </h2>
        <div className="afs-in">
          <HeatTable
            rowHead="의제"
            columns={outletColumns}
            colorFrom={1}
            caption="의제 × 매체 보도 건수"
            rows={day.issues.map((issue) => ({
              label: `${issue.rank}위`,
              cells: outletColumns.map((outlet) => ({
                value: issue.articles.filter((article) => article.outlet === outlet).length,
              })),
            }))}
          />
        </div>
        <p className="afs-foot">
          빈 칸은 그 매체가 이 의제를 쓰지 않았다는 뜻입니다. 어떤 사안을 다루지 않는 것도 편집 선택입니다.
        </p>
      </section>

      <section className="afs-card">
        <h2>의제별로 보기</h2>
        <div className="afs-in">
          <div className="afs-cards">
            {day.issues.map((issue) => {
              const hottest = DIM_ORDER.map((dim) => ({ dim, kinds: kindsOf(issue, dim) })).sort(
                (a, b) => b.kinds - a.kinds,
              )[0];
              return (
                <article className="afs-explore" key={issue.issueId}>
                  <p className="afs-explore-rank afs-num">{String(issue.rank).padStart(2, "0")}</p>
                  <h3>
                    <Link href={`/issues/${encodeURIComponent(issue.issueId)}`}>{issue.title}</Link>
                  </h3>
                  <p className="afs-explore-meta">
                    {issue.category ? <span className="afs-chip afs-chip-brand">{issue.category}</span> : null}
                    <span className="afs-chip afs-num">기사 {issue.articleCount}</span>
                    <span className="afs-chip afs-num">매체 {issue.outletCount}</span>
                  </p>
                  {hottest && hottest.kinds >= 2 ? (
                    <p className="afs-explore-hot">
                      가장 갈린 층위 <b>{DIM_LABEL[hottest.dim]}</b> — 최빈 계열 {hottest.kinds}종
                    </p>
                  ) : (
                    <p className="afs-explore-hot">이 사안에서는 층위별 대표 계열이 갈리지 않았습니다.</p>
                  )}
                  {issue.spectrum ? (
                    <p className="afs-explore-poles" data-axis={DIM_LABEL[issue.spectrum.dimension]}>
                      <b>{DIM_LABEL[issue.spectrum.dimension]} 축</b>
                      <span>{issue.spectrum.left.label}</span>
                      <span>{issue.spectrum.right.label}</span>
                    </p>
                  ) : null}
                  <p className="afs-explore-links">
                    <Link className="afs-link" href={`/issues/${encodeURIComponent(issue.issueId)}/outlets`}>
                      언론사 비교
                    </Link>
                    <Link className="afs-link" href={`/issues/${encodeURIComponent(issue.issueId)}/framing`}>
                      프레이밍 분석
                    </Link>
                    <Link className="afs-link" href={`/issues/${encodeURIComponent(issue.issueId)}/report`}>
                      리포트
                    </Link>
                  </p>
                </article>
              );
            })}
          </div>
        </div>
      </section>
    </>
  );
}
