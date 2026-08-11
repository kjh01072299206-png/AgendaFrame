"use client";

import { useEffect, useState } from "react";
import { IssueSubject } from "../../issue-subject";
import { fetchLiveIssueDetail, fetchLiveIssueList, type LiveIssueDetail } from "../../live-data";

type LiveView = "overview" | "outlets" | "framing" | "report";

const FRAME_LABEL: Record<string, string> = {
  law: "법·제도",
  conflict: "갈등",
  responsibility: "책임",
  economy: "경제",
  safety: "안전",
  human_interest: "인간적 관심",
};

const ELEMENT_LABEL: Record<string, string> = {
  problem_definition: "문제 정의",
  causal_attribution: "원인 설명",
  evaluation: "평가",
  treatment_recommendation: "해법 제시",
};

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
  return (
    <>
      <section className="afs-card afs-card-lead">
        <h2>이 사안의 프레이밍</h2>
        <div className="afs-in afs-prose"><p>{detail.report.summary}</p><p className="afs-hold">{detail.comparison.reason}</p></div>
      </section>
      <section className="afs-card">
        <h2>현재 관측된 표현 근거<small>{detail.frames.length}건</small></h2>
        <div className="afs-in">
          {detail.frames.length ? <ul className="afs-facts">{detail.frames.map((frame) => (
            <li key={`${frame.articleId}-${frame.frame}`}>
              <b>{FRAME_LABEL[frame.frame] ?? frame.frame} · {frame.source}</b>
              <span>{frame.evidenceText}</span>
            </li>
          ))}</ul> : <p className="afs-hold">확인된 본문 프레임 근거가 없습니다.</p>}
        </div>
      </section>
      <section className="afs-card">
        <h2>프레임 요소별 판단</h2>
        <div className="afs-in"><div className="afs-table-wrap"><table className="afs-table"><thead><tr><th>분석 요소</th><th>상태</th></tr></thead><tbody>
          {detail.comparison.frameElements.map((row) => <tr key={row.element}><th>{ELEMENT_LABEL[row.element] ?? row.element}</th><td>{row.status === "not_assessed" ? "근거 부족으로 판단 보류" : row.status}</td></tr>)}
        </tbody></table></div></div>
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
