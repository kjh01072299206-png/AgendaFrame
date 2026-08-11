"use client";

import { useEffect, useState } from "react";
import { IssueSubject } from "../../issue-subject";
import {
  fetchLiveIssueDetail,
  fetchLiveIssueList,
  type LiveComparisonAxis,
  type LiveIssueDetail,
} from "../../live-data";

type LiveView = "overview" | "outlets" | "framing" | "report";

const FRAME_FUNCTIONS = [
  { dimension: "problem_definition", label: "무엇이 문제인가", english: "Problem definition" },
  { dimension: "causal_attribution", label: "왜 이렇게 됐나", english: "Causal attribution" },
  { dimension: "evaluation", label: "어떻게 평가하나", english: "Moral evaluation" },
  { dimension: "treatment_recommendation", label: "어떻게 하자는가", english: "Treatment recommendation" },
] as const;

function frameAxis(axes: LiveComparisonAxis[], dimension: string) {
  if (dimension === "evaluation") {
    return axes.find((axis) => axis.dimension === "evaluation" || axis.dimension === "moral_evaluation");
  }
  return axes.find((axis) => axis.dimension === dimension);
}

function articleFrameSummary(axis: LiveComparisonAxis | undefined, articleId: string) {
  if (!axis) return null;
  const summaries = axis.variants
    .filter((variant) => variant.outlets.some((outlet) => outlet.articleId === articleId))
    .map((variant) => variant.summary.trim())
    .filter(Boolean);
  return [...new Set(summaries)].join(" / ") || null;
}

const formatDateTime = (value: number) => new Intl.DateTimeFormat("ko-KR", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Seoul",
}).format(new Date(value));

function ArticleRows({ detail }: { detail: LiveIssueDetail }) {
  return (
    <ol className="afs-articles">
      {detail.articles.map((article) => (
        <li key={article.id}>
          <b>{article.source}</b>
          <a href={article.url} target="_blank" rel="noreferrer">{article.title}</a>
          <small className="afs-num">{formatDateTime(article.publishedAt)} · 본문 {article.contentAvailable ? "확인" : "미확인"}</small>
        </li>
      ))}
    </ol>
  );
}

function Overview({ detail }: { detail: LiveIssueDetail }) {
  return (
    <>
      <section className="afs-card afs-card-lead">
        <h2>무슨 일이었나</h2>
        <div className="afs-in afs-prose"><p>{detail.issue.summary}</p></div>
      </section>
      <section className="afs-card">
        <h2>관련 기사<small>{detail.articles.length}건</small></h2>
        <div className="afs-in"><ArticleRows detail={detail} /></div>
      </section>
      <section className="afs-card">
        <h2>공통으로 확인된 사실</h2>
        <div className="afs-in afs-prose">
          {detail.comparison.commonFacts.length
            ? <ul className="afs-facts afs-facts-inline">{detail.comparison.commonFacts.map((fact) => <li key={fact}><span>{fact}</span></li>)}</ul>
            : <p className="afs-hold">{detail.comparison.reason}</p>}
        </div>
      </section>
    </>
  );
}

function Outlets({ detail }: { detail: LiveIssueDetail }) {
  return (
    <>
      <section className="afs-card afs-card-lead">
        <h2>언론사 비교<small>매체 {detail.issue.sourceCount}곳 · 기사 {detail.issue.articleCount}건</small></h2>
        <div className="afs-in">
          <div className="afs-table-wrap">
            <table className="afs-table"><thead><tr><th>매체</th><th>기사 수</th><th>홈 배치</th></tr></thead><tbody>
              {detail.outlets.map((outlet) => <tr key={outlet.source}><th>{outlet.source}</th><td>{outlet.articleCount}건</td><td>{outlet.placement}</td></tr>)}
            </tbody></table>
          </div>
        </div>
      </section>
      <section className="afs-card"><h2>기사 원문</h2><div className="afs-in"><ArticleRows detail={detail} /></div></section>
    </>
  );
}

function Framing({ detail }: { detail: LiveIssueDetail }) {
  const summary = detail.comparison.summary;
  const summaryLine = [summary?.commonGround, summary?.mainDifference].filter(Boolean).join(" ") || detail.comparison.reason;
  const axes = detail.comparison.axes ?? [];

  return (
    <>
      <section className="afs-card afs-card-lead">
        <h2>프레이밍 분석 요약</h2>
        <div className="afs-in">
          <p className="afs-frame-what">{summaryLine}</p>
          {summary?.whyItMatters ? <p className="afs-frame-note">{summary.whyItMatters}</p> : null}
        </div>
      </section>
      <section className="afs-card">
        <h2>프레임 4기능 비교<small>Entman (1993) · 기사 본문 구조화</small></h2>
        <div className="afs-in">
          <p className="afs-frame-note afs-frame-note-intro">각 기사가 무엇을 문제로 규정하고, 원인을 어디에 귀인하며, 누구를 어떻게 평가하고, 어떤 해결책을 암시하는지 언론사 간 관점 차이를 문장 수준에서 비교합니다.</p>
          <div className="afs-scroll">
            <table className="afs-frame-table">
              <colgroup><col className="afs-frame-outlet-col" /><col span={4} /></colgroup>
              <thead><tr><th>언론사</th>{FRAME_FUNCTIONS.map((item) => (
                <th key={item.dimension}><b>{item.label}</b><span>{item.english}</span></th>
              ))}</tr></thead>
              <tbody>{detail.articles.map((article) => (
                <tr key={article.id}>
                  <th scope="row" title={article.title}><b>{article.source}</b></th>
                  {FRAME_FUNCTIONS.map((item) => {
                    const text = articleFrameSummary(frameAxis(axes, item.dimension), article.id);
                    return text
                      ? <td key={item.dimension} title={text}><span className="afs-frame-cell">{text}</span></td>
                      : <td key={item.dimension} className="afs-frame-empty">명시 없음</td>;
                  })}
                </tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      </section>
    </>
  );
}

function Report({ detail }: { detail: LiveIssueDetail }) {
  return (
    <article className="afs-report">
      <section className="afs-card afs-card-lead"><h2>리드</h2><div className="afs-in afs-prose"><p>{detail.report.summary}</p></div></section>
      <section className="afs-card"><h2>관측 범위</h2><div className="afs-in afs-prose"><p>{detail.report.missingPerspective}</p><p>{detail.report.caution}</p></div></section>
      <section className="afs-card"><h2>어떻게 읽어 볼까</h2><div className="afs-in"><ol className="afs-questions"><li>각 매체 제목이 사건의 어떤 행위자와 조치를 앞세웠는지 비교해 보세요.</li><li>본문 미확인 기사는 제목만으로 원인·책임·해법을 단정하지 마세요.</li><li>관련 기사 원문을 열어 제목과 본문의 설명 범위가 같은지 확인해 보세요.</li></ol></div></section>
    </article>
  );
}

export function LiveIssueView({ issueId, view }: { issueId: string; view: LiveView }) {
  const [detail, setDetail] = useState<LiveIssueDetail | null>(null);
  const [rank, setRank] = useState(1);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchLiveIssueDetail(issueId), fetchLiveIssueList(100)])
      .then(([nextDetail, list]) => {
        if (cancelled) return;
        setDetail(nextDetail);
        const index = list.issues.findIndex((issue) => issue.id === issueId);
        if (index >= 0) setRank(index + 1);
      })
      .catch(() => { if (!cancelled) setError("이 의제의 기사와 분석을 불러오지 못했습니다."); });
    return () => { cancelled = true; };
  }, [issueId]);

  if (error) return <p className="afs-hold" role="alert">{error}</p>;
  if (!detail) return <p className="afs-hold" role="status">실제 기사와 분석 결과를 불러오는 중입니다.</p>;

  return (
    <>
      <IssueSubject
        issueId={detail.issue.id}
        rank={rank}
        title={detail.issue.title}
        lead={detail.issue.summary}
        category={detail.issue.category}
        articleCount={detail.issue.articleCount}
        outletCount={detail.issue.sourceCount}
        splitDimensions={detail.comparison.status === "ready" ? detail.comparison.divergenceQuestions.length : 0}
        analysisPending={detail.comparison.status !== "ready"}
      />
      <p className="afs-prov"><b>자동 분석 초안 · 사람 검토 전</b><span>본문 근거 {detail.issue.contentAvailableCount}/{detail.issue.articleCount}건</span></p>
      {view === "overview" ? <Overview detail={detail} /> : null}
      {view === "outlets" ? <Outlets detail={detail} /> : null}
      {view === "framing" ? <Framing detail={detail} /> : null}
      {view === "report" ? <Report detail={detail} /> : null}
    </>
  );
}
