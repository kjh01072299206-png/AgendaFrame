"use client";

import Link from "next/link";
import { useState, type CSSProperties, type ReactNode } from "react";
import type { EditorialIssue, EditorialArticle } from "../../lib/editorial-review";
import { editorialReviewIsPublishable } from "../../lib/editorial-review-validation";
import "./editorial-analysis.css";

const colors = ["var(--n1)", "var(--n2)", "var(--n3)", "#7c3aed", "#a16207"];
const questions = [
  ["무엇이 문제인가", "어떤 현상을 핵심 문제로 규정하는가"],
  ["왜 이렇게 됐나", "문제의 원인을 무엇에 돌리는가"],
  ["누구 책임인가", "해결의 책임이 누구에게 있다고 보는가"],
  ["어떻게 평가하나", "도덕적·정치적 평가를 어떻게 붙이는가"],
  ["어떻게 하자는가", "어떤 해결책이나 대안을 제시하는가"],
  ["누구 말을 실었나", "어떤 취재원을 중심으로 구성되는가"],
];
const cc = (i: number): CSSProperties => ({ "--cc": colors[i % colors.length] } as CSSProperties);

function Card({ title, cite, n, children }: { title: string; cite?: string; n?: string; children: ReactNode }) {
  return <section className="card"><h2>{n && <span className="lay-n">{n}</span>}{title}{cite && <span className="cite">{cite}</span>}</h2><div className="in">{children}</div></section>;
}

function Head({ issue, mode }: { issue: EditorialIssue; mode: "outlets" | "framing" }) {
  return <header className="head"><div><h1>{mode === "outlets" ? "언론사 비교" : "프레이밍 분석"} <span className="tag">{mode === "outlets" ? "논조 군집" : "방법론 9층위"}</span></h1><p>{issue.rank}위 · {issue.title}</p></div><div className="acts"><Link className="go" href={`/issues/${issue.issueId}/report`}>리포트로 보기</Link></div></header>;
}

function Articles({ articles }: { articles: EditorialArticle[] }) {
  return <div className="rec">{articles.map((a) => <a key={a.articleId} href={a.url} target="_blank" rel="noopener noreferrer"><b>{a.outlet}</b><span>{a.title}{a.genre !== "보도" ? ` · ${a.genre}` : ""}</span></a>)}</div>;
}

function ReviewMethod() {
  return <details className="review-method"><summary>분석 기준</summary><p>2026년 10월 5일 수집 기사 본문을 Codex가 읽고 보도 초점을 분류했습니다. 한 매체의 기사도 서로 다른 갈래에 포함됩니다. 발언을 인용한 기사와 기자·사설의 직접 평가를 기사별 설명에서 구분했습니다.</p><p>형태소: Kiwi 0.22.2 · 품사와 빈도는 본문에서 계산했습니다. 차별어는 같은 의제의 다른 매체와 비교한 로그 빈도비, 연결선은 같은 문장에 나온 단어 쌍의 횟수입니다.</p><p>분석 버전 2026-10-07.1 · 본문 SHA-256과 근거 위치는 아래 기사에서 확인할 수 있습니다.</p></details>;
}

export function EditorialOutletsPage({ issue }: { issue: EditorialIssue }) {
  const [selected, setSelected] = useState<string | null>(null);
  const publishable = editorialReviewIsPublishable(issue);
  return <div className="af-bodyreview" data-analysis-source="codex_body_reading" data-analysis-version="2026-10-07.1" data-comparison-status={publishable ? "difference_confirmed" : "analysis_failed"} data-comparison-publishable={publishable ? "true" : "false"} data-reviewed-article-count={issue.articleCount}><Head issue={issue} mode="outlets" />
    <div className="cmp-meta"><span><b>{issue.outletCount}</b>개 매체</span><span><b>{issue.articleCount}</b>건 기사</span><span><b>{issue.groups.length}</b>개 논조 군집</span><span><b>{issue.sourceCount}</b>개 취재원·기관</span></div>
    <div className="grid" style={{ marginBottom: 12 }}><Card title={issue.title}><p className="what">{issue.summary}</p><details className="issue-more"><summary>사건 경위와 갈린 지점 더 보기</summary><div><p className="what">{issue.insight}</p></div></details></Card></div>
    <div className="grid" style={{ marginBottom: 12 }}><Card title="논조 갈래 축">
      <div className="debate-question"><span>같은 사건, 다른 초점</span><h3>{issue.question}</h3><p>{issue.insight}</p></div>
      <div className="debate-common"><b>공통으로 본 것</b><p>{issue.common}</p></div>
      <div className="debate-boxes">{issue.groups.map((g, i) => <button key={g.id} type="button" className="debate-box" style={cc(i)} aria-expanded={selected === g.id} aria-controls={`proof-${issue.issueId}-${g.id}`} onClick={() => setSelected(selected === g.id ? null : g.id)}>
        <span className="debate-box-head"><span className="debate-no">보도 갈래 {String.fromCharCode(65 + i)}</span><strong>{g.title}</strong><span className="debate-outlets">{g.outlets.join(" · ")}</span><small>매체 {g.outlets.length}곳 · 기사 {g.articleCount}건</small></span>
        <span className="debate-summary">{g.focus}</span><span className="debate-box-foot"><b>결정적 차이</b><span>{g.difference}</span><i>기사 근거 보기 →</i></span>
      </button>)}</div>
      <div className="debate-proof-area">{issue.groups.map((g, i) => <section key={g.id} className="debate-proof-panel" id={`proof-${issue.issueId}-${g.id}`} hidden={selected !== g.id} style={cc(i)}>
        <header><span className="proof-no">갈래 {i + 1}</span><div><b>{g.title}</b><p>{g.outlets.join(" · ")} · 기사 {g.articleCount}건</p></div></header>
        <div className="proof-reason"><b>왜 이 갈래로 묶였나</b><p>{g.focus}</p></div><div className="proof-list">{issue.articles.filter((a) => a.groupId === g.id).map((a) => <article key={a.articleId}><h4><b>{a.outlet}</b>{a.title}</h4><p><span>이 기사의 초점</span>{a.reading}</p><p><span>취재원</span>{a.sources.join(" · ")}</p><a href={a.url} target="_blank" rel="noopener noreferrer">원문 보기 →</a></article>)}</div>
      </section>)}</div>
    </Card></div><div className="grid"><Card title="기사 목록"><Articles articles={issue.articles} /></Card></div><ReviewMethod />
  </div>;
}

function ScopeMix({ issue }: { issue: EditorialIssue }) {
  return <div className="grid" style={{ gap: 5, marginTop: 6 }}>{issue.scopeMix.map((s) => <div key={s.label} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12.5 }}><span style={{ minWidth: "5.5em" }}>{s.label}</span><span className="bar" style={{ flex: 1 }}><span style={{ flex: s.count, background: colors[0] }} /><span style={{ flex: issue.articleCount - s.count, background: "none" }} /></span><b className="num">{s.count}</b></div>)}</div>;
}

function FunctionTable({ issue }: { issue: EditorialIssue }) {
  const keys = ["문제 정의", "원인 해석", "규범적 평가", "해법·처방"];
  return <div className="scroll"><table style={{ minWidth: 860, tableLayout: "fixed" }}><colgroup><col style={{ width: 92 }} /><col span={4} /></colgroup><thead><tr><th>언론사</th>{keys.map((k) => <th key={k}>{k}</th>)}</tr></thead><tbody>{issue.articles.map((a) => <tr key={a.articleId}><th scope="row"><a href={a.url} title={a.title} target="_blank" rel="noopener noreferrer"><b>{a.outlet}</b></a></th>{keys.map((k) => <td key={k} title={a.fourFunctions[k as keyof typeof a.fourFunctions]}><span className="frame-cell">{a.fourFunctions[k as keyof typeof a.fourFunctions]}</span></td>)}</tr>)}</tbody></table></div>;
}

function Networks({ issue }: { issue: EditorialIssue }) {
  return <><div className="cgrid">{issue.groups.map((g, gi) => {
    const maxCount=Math.max(...g.network.nodes.map(n=>n.count));
    const occupied: Array<{x:number;y:number;w:number;h:number}>=[];
    const nodes = g.network.nodes.map((n) => {
      const fs=Math.round(13+Math.sqrt(n.count/maxCount)*15), w=n.term.length*fs+8, h=fs+7;
      let x=200,y=128;
      for(let t=0;t<2400;t++) {
        const angle=t*2.39996323,radius=Math.sqrt(t)*4.3;
        x=Math.round((200+Math.cos(angle)*radius)*100)/100;
        y=Math.round((128+Math.sin(angle)*radius*.66)*100)/100;
        if(x-w/2<8||x+w/2>392||y-h/2<8||y+h/2>248) continue;
        if(!occupied.some(p=>Math.abs(x-p.x)<(w+p.w)/2+3&&Math.abs(y-p.y)<(h+p.h)/2+2)) break;
      }
      occupied.push({x,y,w,h});
      return {...n,x,y,fs,w,h};
    });
    const positions = new Map(nodes.map((n) => [n.term, n]));
    return <section className="cbox" key={g.id} style={cc(gi)}><div className="cbox-h"><span className="cn">갈래 {gi + 1}</span><b>{g.title}</b><span className="cs">기사 {g.articleCount}건 · {g.outlets.join(" · ")}</span></div><svg className="wnet" viewBox="0 0 400 256" role="img" aria-label={`${g.title}의 본문 단어 연결망`}><g>{g.network.edges.map((e) => {
      const a = positions.get(e.source)!, b = positions.get(e.target)!;
      return <line key={`${e.source}-${e.target}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} strokeWidth={0.4 + Math.min(e.sentences, 10) * 0.12} strokeOpacity={0.15 + Math.min(e.sentences, 10) * 0.02}></line>;
    })}</g><g>{nodes.map((n) => <g key={n.term}><rect x={n.x - n.w/2} y={n.y - n.h/2} width={n.w} height={n.h} rx={1} fill="var(--card)" /><text x={n.x} y={n.y} fontSize={n.fs} className="own" aria-label={`${n.term} · ${n.count}회`}>{n.term}</text></g>)}</g></svg><p className="cbox-f">가장 많이 함께 나온 말: {g.network.edges.slice(0, 3).map((e) => `${e.source}–${e.target} ${e.sentences}`).join(" · ")}</p></section>;
  })}</div><div className="legend"><span>글씨 크기 = 본문 빈도</span><span>선 굵기 = 같은 문장의 공기 횟수</span></div></>;
}

export function EditorialFramingPage({ issue }: { issue: EditorialIssue }) {
  const outlets = [...new Set(issue.articles.map((a) => a.outlet))];
  const sourceFrequency = new Map<string, number>();
  issue.articles.forEach((a) => new Set(a.sources).forEach((s) => sourceFrequency.set(s, (sourceFrequency.get(s) ?? 0) + 1)));
  const sources = [...sourceFrequency].sort((a, b) => b[1] - a[1]);
  const generic = ["갈등", "인간적 흥미", "경제적 결과", "도덕성", "책임"];
  return <div className="af-bodyreview"><Head issue={issue} mode="framing" />
    <div className="grid g-main" style={{ marginBottom: 12 }}><Card title="프레이밍 분석 요약"><p className="what" style={{ fontSize: 14.5 }}>{issue.common} {issue.summary}</p><p className="note" style={{ margin: "10px 0 0" }}>{issue.insight}</p></Card><Card title="시야 분포" cite="Iyengar 1991"><ScopeMix issue={issue} /></Card></div>
    <div className="grid" style={{ marginBottom: 12 }}><Card title="여섯 항목" cite="Entman 1993"><div className="grid dimension-grid">{questions.map(([a, b], i) => <div key={a} style={{ borderTop: "1px solid var(--rule)", paddingTop: 7 }}><span className="num" style={{ fontSize: 10.5, fontWeight: 800, color: "var(--ink-3)" }}>{String(i + 1).padStart(2, "0")}</span><b style={{ display: "block", fontSize: 13, fontWeight: 800 }}>{a}</b><span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{b}</span></div>)}</div></Card></div>
    <div className="grid" style={{ marginBottom: 12 }}><Card title="프레임 4기능 비교" cite="Entman 1993 · 본문 구조화"><FunctionTable issue={issue} /></Card></div>
    <div className="grid">
      <Card title="비슷한 방식으로 보도한 기사 묶음" n="02" cite="Matthes & Kohring 2008"><div className="cgrid">{issue.groups.map((g, i) => <section key={g.id} className="cbox" style={cc(i)}><div className="cbox-h"><span className="cn">군집 {i + 1}</span><b>{g.title}</b><span className="cs">{g.outlets.join(" · ")} · {g.articleCount}건</span></div><div className="cluster-functions">{Object.entries(g.sixFunctions).map(([k, v]) => <p key={k}><b>{k}</b><span>{v}</span></p>)}</div><p className="cbox-f">{g.difference}</p></section>)}</div></Card>
      <Card title="기사가 이 사안을 바라본 관점" n="03" cite="Boydstun et al. 2014 · 적용 분류"><div className="scroll"><table className="pf-table" style={{ minWidth: 680 }}><thead><tr><th>매체 · 기사</th><th>대표 관점</th><th>이 기사의 초점</th></tr></thead><tbody>{issue.articles.map((a) => <tr key={a.articleId}><td className="pf-article"><b>{a.outlet}</b><span>{a.title}</span></td><td>{issue.groups.find((g) => g.id === a.groupId)?.policy}</td><td>{a.reading}</td></tr>)}</tbody></table></div></Card>
      <Card title="기사들은 무엇을 강조했나" n="04" cite="Semetko & Valkenburg 2000"><div className="scroll"><table style={{ minWidth: 650 }}><thead><tr><th>매체</th>{generic.map((k) => <th key={k}>{k}</th>)}</tr></thead><tbody>{outlets.map((o) => <tr key={o}><th scope="row">{o}</th>{generic.map((k) => <td className="num" key={k}>{issue.articles.filter((a) => a.outlet === o && a.genericFrames.includes(k)).length}</td>)}</tr>)}</tbody></table></div><div className="legend"><span>해당 강조가 나타난 기사 수 · 한 기사에 여러 강조가 함께 나타납니다</span></div></Card>
      <Card title="사건 하나로 봤나, 구조 문제로 봤나" n="05" cite="Iyengar 1991"><div className="scroll"><table style={{ minWidth: 630 }}><thead><tr><th>매체 · 기사</th><th>시야</th><th>판정 이유</th></tr></thead><tbody>{issue.articles.map((a) => <tr key={a.articleId}><td className="pf-article"><b>{a.outlet}</b><span>{a.title}</span></td><td><span className="chip">{a.scope}</span></td><td>{a.reading}</td></tr>)}</tbody></table></div></Card>
      <Card title="누구의 말을 중심에 뒀나" n="06" cite="Gans 1979 · 취재원 분석"><div className="pf-summary"><div className="pf-stat"><span className="kicker">가장 많이 반복된 취재원</span><strong>{sources.slice(0, 3).map(([s, n]) => `${s} · ${n}건`).join(" / ")}</strong><span className="meta">확인된 취재원·기관 {sources.length}개</span></div></div><div className="scroll"><table className="pf-table" style={{ minWidth: 650 }}><thead><tr><th>매체 · 기사</th><th>발언·설명의 주체</th><th>보도에서 앞세운 내용</th></tr></thead><tbody>{issue.articles.map((a) => <tr key={a.articleId}><td className="pf-article"><b>{a.outlet}</b><span>{a.title}</span></td><td>{a.sources.join(" · ")}</td><td>{a.reading}</td></tr>)}</tbody></table></div></Card>
      <Card title="갈래별 의미 연결망" n="07" cite="semantic network analysis"><Networks issue={issue} /></Card>
      <Card title="형태소 분석" n="08" cite="키네스 분석 · Kilgarriff 2001"><div className="scroll"><table style={{ minWidth: 700 }}><thead><tr><th>매체</th><th>내용어</th><th>품사 분포</th><th>이 매체가 유독 많이 쓴 말</th></tr></thead><tbody>{issue.morphology.map((m) => <tr key={m.outlet}><th scope="row">{m.outlet}</th><td className="num">{m.tokens.toLocaleString()}</td><td>{m.pos.map((p) => <span key={p.tag} className="chip">{p.tag} {Math.round(p.count / m.tokens * 100)}%</span>)}</td><td>{m.distinctive.map((d) => <span key={d.term} className="chip" title={`${d.count}회 · 로그 빈도비 ${d.log2Ratio}`}>{d.term}</span>)}</td></tr>)}</tbody></table></div></Card>
      <Card title="근거 장치" n="09" cite="Gamson & Modigliani 1989"><div className="scroll"><table style={{ minWidth: 780 }}><thead><tr><th>매체 · 기사</th><th>제목·본문이 앞세운 초점</th><th>핵심 지칭어</th><th>역사적 사례</th></tr></thead><tbody>{issue.articles.map((a) => <tr key={a.articleId}><td className="pf-article"><b>{a.outlet}</b><span>{a.title}</span></td><td>{a.devices.headline}</td><td>{a.devices.terms.map((t) => <span className="chip" key={t}>{t}</span>)}</td><td>{a.devices.historicalExample ?? "—"}</td></tr>)}</tbody></table></div></Card>
    </div><ReviewMethod /><details className="review-method"><summary>분석 기사와 근거 위치</summary>{issue.articles.map((a) => <div className="review-source" key={a.articleId}><a href={a.url} target="_blank" rel="noopener noreferrer">{a.outlet} · {a.title}</a><small>{a.publishedAt} · 본문 {a.bodySha256} · 근거 문자 {a.evidence[0].start}–{a.evidence[0].end}</small></div>)}</details>
  </div>;
}
