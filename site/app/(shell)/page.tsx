import Link from "next/link";
import { RankList } from "../charts";
import { deriveDay, DIM_LABEL } from "../../lib/initial-five/derive";
import { SavedIssueList, SaveIssueButton } from "./saved-issues";

const formatDate = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return `${y}년 ${Number(m)}월 ${Number(d)}일`;
};

/* 첫 화면은 하나만 한다 — 이날 어떤 의제가 있었고, 그 안에서 신문이 어디에서 갈렸는지 미리 보여
   준다. 이전에는 KPI 4칸·분야 구성·매체 참여·인용 방식·시야·방법론 산문까지 한 화면에 있었다.
   전부 사이드바나 각 의제 화면에 이미 있는 값이라 여기서는 지운다. */
export default function HomePage() {
  const day = deriveDay();

  return (
    <>
      <header className="afs-head">
        <span className="afs-eyebrow">{formatDate(day.basisDate)}</span>
        <h1>같은 사건을 신문마다 어떻게 다르게 설명했나</h1>
        <p>
          이날 보도량이 가장 많았던 의제 {day.issueCount}개입니다. 하나를 고르면 그 사건에서 신문 사이의 설명이 어디에서
          갈라졌는지부터 봅니다.
        </p>
      </header>

      <SavedIssueList />

      <section className="afs-card">
        <h2>
          오늘의 의제
          <small>보도량 순</small>
        </h2>
        <div className="afs-in">
          <RankList
            rows={day.issues.map((issue) => ({
              rank: issue.rank,
              title: issue.title,
              href: `/issues/${encodeURIComponent(issue.issueId)}`,
              category: issue.category,
              articleCount: issue.articleCount,
              outletCount: issue.outletCount,
            }))}
          />
        </div>
        <p className="afs-foot">막대 길이는 기사 수입니다. 보도량 순위이며 사안의 중요도 순위가 아닙니다.</p>
      </section>

      <section className="afs-card">
        <h2>
          의제별 미리보기
          <small>어디에서 갈렸나</small>
        </h2>
        <div className="afs-in">
          <div className="afs-cards">
            {day.issues.map((issue) => {
              const axis = issue.spectrum;
              const split = issue.dimensionBasis?.filter((row) => row.narratedKinds >= 2) ?? [];
              return (
                <article className="afs-explore" key={issue.issueId}>
                  <p className="afs-explore-rank afs-num">{String(issue.rank).padStart(2, "0")}</p>
                  <h3>
                    <Link href={`/issues/${encodeURIComponent(issue.issueId)}/framing`}>{issue.title}</Link>
                  </h3>
                  <p className="afs-explore-meta">
                    기사 {issue.articleCount}건 · 매체 {issue.outletCount}곳
                    <SaveIssueButton issueId={issue.issueId} title={issue.title} compact />
                  </p>
                  {axis ? (
                    <p className="afs-explore-poles" data-axis={DIM_LABEL[axis.dimension]}>
                      <span>{axis.left.label}</span>
                      <i aria-hidden="true">↔</i>
                      <span>{axis.right.label}</span>
                    </p>
                  ) : (
                    <p className="afs-explore-hot">이 사안에서는 신문 사이의 설명이 갈리지 않았습니다.</p>
                  )}
                  <p className="afs-explore-hot">
                    {split.length
                      ? `${split.map((row) => DIM_LABEL[row.dimension]).join(" · ")}에서 갈렸습니다.`
                      : "매체 서술 기준으로는 갈린 층위가 없습니다."}
                  </p>
                  <p className="afs-explore-links">
                    <Link className="afs-link" href={`/issues/${encodeURIComponent(issue.issueId)}`}>
                      사안 개요
                    </Link>
                    <Link className="afs-link" href={`/issues/${encodeURIComponent(issue.issueId)}/framing`}>
                      프레이밍 분석 →
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
