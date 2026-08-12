"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { RankList } from "../charts";
import { SavedIssueList, SaveIssueButton } from "./saved-issues";
import { fetchLiveIssueList, type LiveIssueList } from "./live-data";

const formatDate = (iso: string) => {
  const [year, month, day] = iso.split("-");
  return `${year}년 ${Number(month)}월 ${Number(day)}일`;
};

export function LiveHome() {
  const [data, setData] = useState<LiveIssueList | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetchLiveIssueList(5)
      .then((payload) => { if (!cancelled) setData(payload); })
      .catch(() => { if (!cancelled) setError("최신 기사 데이터를 불러오지 못했습니다. 잠시 뒤 다시 확인해 주세요."); });
    return () => { cancelled = true; };
  }, []);

  return (
    <>
      <header className="afs-head">
        <span className="afs-eyebrow">{data ? formatDate(data.date) : "최신 기사 확인 중"}</span>
        <h1>같은 사건을 신문마다 어떻게 다르게 설명했나</h1>
        <p>
          {data
            ? `학술연구 12개 매체에서 이날 분석된 의제 ${data.issueCount}개 중 보도 확산 상위 5개입니다.`
            : "학술연구 12개 매체의 최신 기사와 분석 결과를 불러오고 있습니다."}
        </p>
      </header>

      <SavedIssueList />

      {error ? <p className="afs-hold" role="alert">{error}</p> : null}
      {!data && !error ? <p className="afs-hold" role="status">최신 기사·의제 분석을 불러오는 중입니다.</p> : null}

      {data ? (
        <>
          <section className="afs-card">
            <h2>오늘의 의제<small>보도 확산 순</small></h2>
            <div className="afs-in">
              <RankList rows={data.issues.map((issue, index) => ({
                rank: index + 1,
                title: issue.title,
                href: `/issues/${encodeURIComponent(issue.id)}`,
                category: issue.category,
                articleCount: issue.articleCount,
                outletCount: issue.sourceCount,
                score: issue.agendaScore,
              }))} />
            </div>
          </section>

          <section className="afs-card">
            <h2>의제별 미리보기<small>실제 기사 묶음</small></h2>
            <div className="afs-in">
              <div className="afs-cards">
                {data.issues.map((issue, index) => (
                  <article className="afs-explore" key={issue.id}>
                    <p className="afs-explore-rank afs-num">{String(index + 1).padStart(2, "0")}</p>
                    <h3><Link href={`/issues/${encodeURIComponent(issue.id)}`}>{issue.title}</Link></h3>
                    <p className="afs-explore-meta">
                      기사 {issue.articleCount}건 · 매체 {issue.sourceCount}곳
                      <SaveIssueButton issueId={issue.id} title={issue.title} compact />
                    </p>
                    <p className="afs-explore-hot">{issue.summary}</p>
                    <p className="afs-explore-hot">
                      {issue.contentAvailableCount > 0
                        ? `본문 근거 ${issue.contentAvailableCount}/${issue.articleCount}건을 확인했습니다.`
                        : "현재 제목·게시정보 기준이며, 본문 근거가 없어 설명 차이는 판단하지 않았습니다."}
                    </p>
                    <p className="afs-explore-links">
                      <Link className="afs-link" href={`/issues/${encodeURIComponent(issue.id)}`}>무슨 일이었나</Link>
                      <Link className="afs-link" href={`/issues/${encodeURIComponent(issue.id)}/framing`}>프레이밍 분석 →</Link>
                    </p>
                  </article>
                ))}
              </div>
            </div>
          </section>
        </>
      ) : null}
    </>
  );
}
