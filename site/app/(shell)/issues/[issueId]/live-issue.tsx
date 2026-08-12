"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { IssueSubject } from "../../issue-subject";
import {
  fetchLiveIssueDetail,
  fetchLiveIssueList,
  LIVE_SCOPE_LABEL,
  type LiveComparisonAxis,
  type LiveComparisonNarrative,
  type LiveIssueDetail,
  type LiveSemanticNetworksModule,
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

const PERSPECTIVE_GLOSSARY = [
  ["경제", "비용·혜택·재정에 미치는 영향"],
  ["자원·행정 역량", "시간·예산·인력·시설이 충분한지"],
  ["도덕·윤리", "옳고 그름, 책임과 의무를 어떻게 보는지"],
  ["공정성·평등", "권리·처벌·자원이 공평하게 적용되는지"],
  ["법·헌법·권한", "법의 내용, 헌법, 기관별 권한의 문제"],
  ["범죄·처벌", "법 위반, 수사·체포·처벌을 어떻게 다루는지"],
  ["안보·방어", "위협을 미리 막고 방어하는 문제"],
  ["건강·안전", "사람의 생명·신체·안전에 미치는 결과"],
  ["삶의 질", "일상생활과 전반적인 생활 여건의 변화"],
  ["문화적 정체성", "집단의 가치·규범·정체성과 연결하는 방식"],
  ["여론·대중 반응", "여론조사·시위·대중의 반응을 다루는 방식"],
  ["정치적 이해관계·정쟁", "정당·표 계산·협상·정치적 충돌을 앞세우는 방식"],
  ["정책 내용·대안·효과", "정책이 무엇이며 무엇을 해야 하고 효과가 있는지"],
  ["외부 규제·대외 평판", "지역·국가·집단 사이의 영향과 평판"],
  ["기타", "앞선 기준으로 설명하기 어려운 관점"],
] as const;

const PERSPECTIVE_LABELS: Record<string, string> = {
  economic: "경제",
  capacity_resources: "자원·행정 역량",
  morality: "도덕·윤리",
  fairness_equality: "공정성·평등",
  legality_constitutionality: "법·헌법·권한",
  crime_punishment: "범죄·처벌",
  security_defense: "안보·방어",
  health_safety: "건강·안전",
  quality_of_life: "삶의 질",
  cultural_identity: "문화적 정체성",
  public_opinion: "여론·대중 반응",
  political: "정치적 이해관계·정쟁",
  policy_prescription: "정책 내용·대안·효과",
  external_regulation: "외부 규제·대외 평판",
  other: "기타",
};

function FrameCard({ number, title, cite, note, children, lead = false }: {
  number?: string;
  title: string;
  cite?: string;
  note?: string;
  children: ReactNode;
  lead?: boolean;
}) {
  return (
    <section className={`afs-card afs-frame-card${lead ? " afs-card-lead" : ""}`}>
      <h2>{number ? <span className="afs-layer-number">{number}</span> : null}{title}{cite ? <small>{cite}</small> : null}</h2>
      <div className="afs-in">{note ? <p className="afs-frame-note afs-frame-note-intro">{note}</p> : null}{children}</div>
    </section>
  );
}

function CodingHold({ children = "코딩 진행 중" }: { children?: ReactNode }) {
  return <div className="afs-coding-hold">{children}</div>;
}

function narrativeMemberText(narrative: LiveComparisonNarrative, detail: LiveIssueDetail) {
  const counts = new Map<string, number>();
  for (const articleId of narrative.supportingArticleIds) {
    const article = detail.articles.find((item) => item.id === articleId);
    if (article) counts.set(article.source, (counts.get(article.source) ?? 0) + 1);
  }
  if (!counts.size) narrative.supportingOutlets.forEach((source) => counts.set(source, 1));
  return [...counts.entries()].map(([source, count]) => `${source} ${count}건`).join(" · ");
}

function NarrativeClusters({ detail }: { detail: LiveIssueDetail }) {
  const narratives = detail.comparison.narratives ?? [];
  const composition = detail.comparison.analysisModules?.compositionClusters?.clusters ?? [];
  if (!narratives.length) return <>{composition.map((cluster, index) => (
    <div className="afs-cluster" style={{ "--afs-cluster-color": `var(--n${(index % 3) + 1})` } as CSSProperties} key={cluster.clusterId}>
      <h4><span className="afs-cluster-index">군집 {index + 1}</span><span className="afs-cluster-name">{cluster.title}</span><span className="afs-cluster-meta">기사 {cluster.articleCount}건 · 매체 {cluster.outletCount}곳</span></h4>
      <p className="afs-cluster-copy">{cluster.summary}</p>
      <p className="afs-cluster-members"><b>이 군집의 기사</b> {cluster.outlets.map((source) => { const count = cluster.articleIds.filter((id) => detail.articles.find((article) => article.id === id)?.source === source).length; return `${source} ${count}건`; }).join(" · ")}</p>
      {cluster.articleCount === 1 ? <p className="afs-frame-note">기사 1건만 포함되어 반복되는 패턴보다 개별 기사 특성으로 읽는 편이 안전합니다.</p> : null}
    </div>
  ))}</>;
  return <>{narratives.map((narrative, index) => (
    <div className="afs-cluster" style={{ "--afs-cluster-color": `var(--n${(index % 3) + 1})` } as CSSProperties} key={narrative.narrativeId}>
      <h4><span className="afs-cluster-index">군집 {index + 1}</span><span className="afs-cluster-name">비슷한 관점으로 사건을 구성한 기사들</span><span className="afs-cluster-meta">기사 {narrative.articleCount}건 · 매체 {narrative.outletCount}곳</span></h4>
      <p className="afs-cluster-copy">{narrative.summary}</p>
      <p className="afs-cluster-members"><b>이 군집의 기사</b> {narrativeMemberText(narrative, detail)}</p>
      {narrative.articleCount === 1 ? <p className="afs-frame-note">기사 1건만 포함되어 반복되는 패턴보다 개별 기사 특성으로 읽는 편이 안전합니다.</p> : null}
    </div>
  ))}</>;
}

function PerspectivePanel({ detail }: { detail: LiveIssueDetail }) {
  const rows = detail.comparison.analysisModules?.frameComposition.byOutlet ?? [];
  if (!rows.length) return <p className="afs-observation-empty">분석 가능한 본문이 없어 정책 관점을 비교하지 못했습니다.</p>;
  const total = rows.reduce((sum, row) => sum + row.analyzedArticles, 0);
  const dominantCounts = new Map<string, number>();
  const presentCounts = new Map<string, number>();
  const companionCounts = new Map<string, number>();
  const normalized = rows.map((row) => {
    const labels = [...row.labels].sort((a, b) => b.sentenceCount - a.sentenceCount || b.articleCount - a.articleCount || a.code.localeCompare(b.code));
    const dominant = labels[0] ?? null;
    if (dominant) dominantCounts.set(dominant.code, (dominantCounts.get(dominant.code) ?? 0) + row.analyzedArticles);
    labels.forEach((label) => {
      presentCounts.set(label.code, (presentCounts.get(label.code) ?? 0) + label.articleCount);
      if (label.code !== dominant.code) companionCounts.set(label.code, (companionCounts.get(label.code) ?? 0) + label.articleCount);
    });
    return { ...row, labels, dominant };
  });
  const dominantDistribution = [...dominantCounts.entries()].sort((a, b) => b[1] - a[1]);
  const top = dominantDistribution[0];
  const labelFor = (code: string, fallback?: string) => PERSPECTIVE_LABELS[code] ?? fallback ?? code;
  const commonCompanions = [...companionCounts.entries()].filter(([, count]) => count === total).sort((a, b) => b[1] - a[1]);
  const variedCompanions = [...companionCounts.entries()].filter(([, count]) => count < total).sort((a, b) => b[1] - a[1]);
  const chips = (items: Array<[string, number]>, active = false) => items.map(([code, count]) => <span className={`afs-chip${active ? " afs-chip-on" : ""}`} key={code}>{labelFor(code)} <b>{count}/{total}</b></span>);
  const resultLine = top
    ? dominantDistribution.length === 1 ? <>관측 기준을 충족한 기사에서는 <b>{labelFor(top[0])}</b>이 대표 관점입니다.</> : <>가장 많이 관측된 대표 관점은 <b>{labelFor(top[0])}</b>({top[1]}/{total}건)입니다.</>
    : <>15개 정책 관점 중 명시적 기준을 충족한 항목이 없습니다.</>;
  return <>
    <div className="afs-perspective-summary">
      <div className="afs-perspective-stat"><span className="afs-kicker">이번 결과</span><strong>{resultLine}</strong><span className="afs-meta">기사 {total}건 · 매체 {rows.length}곳 · 15개 기준 중 {presentCounts.size}개 관점 확인</span></div>
      <div className="afs-perspective-signal"><h4>대표 관점 분포</h4><div className="afs-chips">{dominantDistribution.length ? chips(dominantDistribution, true) : <span className="afs-dim">관측 기준 충족 없음</span>}</div></div>
      <div className="afs-perspective-signal"><h4>모든 기사에서 공통으로 함께 나타난 관점</h4><div className="afs-chips">{commonCompanions.length ? chips(commonCompanions) : <span className="afs-dim">공통으로 확인된 관점 없음</span>}</div></div>
      <div className="afs-perspective-signal"><h4>기사마다 달라진 관점</h4><div className="afs-chips">{variedCompanions.length ? chips(variedCompanions) : <span className="afs-dim">기사별 차이 없음</span>}</div></div>
    </div>
    <div className="afs-scroll"><table className="afs-prototype-table afs-perspective-table"><thead><tr><th>매체 · 기사</th><th>가장 중심인 관점</th><th>함께 나타난 관점</th></tr></thead><tbody>{normalized.map((row) => <tr key={row.source}><td className="afs-perspective-article"><b>{row.source}</b><span>분석 기사 {row.analyzedArticles}건</span></td><td>{row.dominant ? <><span className="afs-chip afs-chip-on">{labelFor(row.dominant.code, row.dominant.label)}</span><details className="afs-evidence"><summary>근거 {row.dominant.evidenceRefs.length}개 보기</summary><div>{row.dominant.evidenceRefs.length ? row.dominant.evidenceRefs.map((evidence, index) => <p key={`${evidence.articleId}-${index}`}><b>{labelFor(row.dominant!.code, row.dominant!.label)}</b><span>{evidence.evidenceLocator ? `근거 위치: ${evidence.evidenceLocator}` : "근거 위치 미확인"}</span></p>) : <p>근거 위치 미확인</p>}</div></details></> : <span className="afs-dim">관측 기준 충족 없음</span>}</td><td>{row.labels.slice(1).length ? row.labels.slice(1).map((label) => <span className="afs-chip" key={label.code}>{labelFor(label.code, label.label)}</span>) : <span className="afs-dim">함께 나타난 관점 없음</span>}</td></tr>)}</tbody></table></div>
    <details className="afs-gloss"><summary><b>15개 관점은 어떻게 나누나요?</b><span>분석 기준 보기</span></summary><div className="afs-gloss-body"><div className="afs-gloss-grid">{PERSPECTIVE_GLOSSARY.map(([name, description]) => <div key={name}><b>{name}</b><span>{description}</span></div>)}</div><p className="afs-frame-note">이 기준은 매체의 고정 성향이나 기사의 찬반을 판정하는 기준이 아닙니다. 한 기사에 여러 관점이 함께 나타날 수 있습니다.</p></div></details>
  </>;
}

const GENERIC_FRAME_GUIDE = [
  ["conflict", "갈등", "당사자 사이의 충돌·공방·대립을 앞세웁니다."],
  ["human_interest", "인간적 관심", "개인의 사연·감정·일상 경험을 중심에 둡니다."],
  ["economic_consequences", "경제적 결과", "비용·예산·소득·시장에 미치는 결과를 강조합니다."],
  ["morality", "도덕성", "옳고 그름·정의·윤리의 기준으로 사안을 설명합니다."],
  ["responsibility", "책임", "정부나 기관이 문제를 해결하거나 막아야 할 책임을 강조합니다."],
] as const;

function GenericFramePanel({ detail }: { detail: LiveIssueDetail }) {
  const rows = detail.comparison.analysisModules?.genericFrames?.byOutlet ?? [];
  if (!rows.length) return <p className="afs-observation-empty">분석 가능한 본문이 없어 보편 프레임을 비교하지 못했습니다.</p>;
  const totals = new Map<string, number>();
  rows.forEach((row) => row.frames.forEach((frame) => totals.set(frame.code, (totals.get(frame.code) ?? 0) + frame.articleCount)));
  const ranked = [...totals.entries()].filter(([, count]) => count > 0).sort((left, right) => right[1] - left[1]);
  const guide: Record<string, string> = Object.fromEntries(GENERIC_FRAME_GUIDE.map(([code, label]) => [code, label]));
  const top = ranked[0];
  return <>
    <div className="afs-perspective-summary">
      <div className="afs-perspective-stat"><span className="afs-kicker">이번 결과</span><strong>{top ? <><b>{guide[top[0]] ?? top[0]}</b> 프레임이 {top[1]}건에서 가장 많이 관측됐습니다.</> : <>다섯 프레임의 명시적 표지가 관측되지 않았습니다.</>}</strong><span className="afs-meta">기사별 존재 여부를 기준으로 집계하며, 관측되지 않음은 실제 부재를 뜻하지 않습니다.</span></div>
      <div className="afs-perspective-signal"><h4>관측된 프레임 분포</h4><div className="afs-chips">{ranked.length ? ranked.map(([code, count]) => <span className="afs-chip afs-chip-on" key={code}>{guide[code] ?? code} <b>{count}건</b></span>) : <span className="afs-dim">관측 기준 충족 없음</span>}</div></div>
    </div>
    <div className="afs-scroll"><table className="afs-prototype-table afs-generic-table"><thead><tr><th>매체</th>{GENERIC_FRAME_GUIDE.map(([, label]) => <th key={label}>{label}</th>)}</tr></thead><tbody>{rows.map((row) => { const byCode = new Map(row.frames.map((frame) => [frame.code, frame])); return <tr key={row.source}><th scope="row"><b>{row.source}</b><span className="afs-table-sub">분석 기사 {row.analyzedArticles}건</span></th>{GENERIC_FRAME_GUIDE.map(([code]) => { const frame = byCode.get(code); return <td key={code}>{frame?.present ? <span className="afs-chip afs-chip-on">있음 <b>{frame.articleCount}건</b></span> : <span className="afs-unobs">·</span>}</td>; })}</tr>; })}</tbody></table></div>
    <details className="afs-gloss"><summary><b>다섯 프레임은 무엇을 뜻하나요?</b><span>분석 기준 보기</span></summary><div className="afs-gloss-body"><div className="afs-gloss-grid">{GENERIC_FRAME_GUIDE.map(([code, label, description]) => <div key={code}><b>{label}</b><span>{description}</span></div>)}</div><p className="afs-frame-note">각 프레임의 이진 문항에 해당하는 명시 표지를 자동 관측했습니다. 이 결과는 기사 품질이나 매체 성향 판정이 아닙니다.</p></div></details>
  </>;
}

function ScopePanel({ detail }: { detail: LiveIssueDetail }) {
  const rows = detail.comparison.analysisModules?.reportingStyle.byOutlet.filter((entry) => entry.scope.status === "observed") ?? [];
  if (!rows.length) return <CodingHold />;
  const scopeFor = (index: number | null) => index === null ? { plain: "판정 없음", formal: "", cls: "mix" } : index <= -0.34 ? { plain: "사건 중심", formal: "일화적", cls: "episodic" } : index >= 0.34 ? { plain: "구조 중심", formal: "주제적", cls: "thematic" } : { plain: "사건+구조", formal: "혼합 · 적용 범주", cls: "mix" };
  const counts = new Map<string, number>();
  rows.forEach((row) => counts.set(scopeFor(row.scope.index).plain, (counts.get(scopeFor(row.scope.index).plain) ?? 0) + row.analyzedArticles));
  const total = rows.reduce((sum, row) => sum + row.analyzedArticles, 0);
  const distribution = ["사건 중심", "사건+구조", "구조 중심"].filter((label) => counts.has(label)).map((label) => `${label} ${counts.get(label)}건`);
  const headline = distribution.length === 1 ? `기사 ${total}건 모두 ${distribution[0].replace(/ \d+건$/, "")}입니다.` : distribution.join(" · ");
  return <>
    <div className="afs-perspective-summary"><div className="afs-perspective-stat"><span className="afs-kicker">이번 이슈의 보도 시야</span><strong>{headline}</strong><span className="afs-meta">기사 {total}건 · 판정은 기사에 실제로 제시된 사건 설명과 구조적 맥락을 기준으로 합니다.</span></div>
      <dl className="afs-scope-guide"><div><dt>사건 중심 <span>(일화적)</span></dt><dd>특정 인물·발언·하루의 사건을 중심으로 전합니다.</dd></div><div><dt>사건+구조 <span>(적용 범주)</span></dt><dd>개별 사건과 제도·정책의 배경을 함께 설명합니다.</dd></div><div><dt>구조 중심 <span>(주제적)</span></dt><dd>지속적인 제도·통계·사회 구조를 중심으로 설명합니다.</dd></div></dl>
    </div>
    <div className="afs-scroll"><table className="afs-prototype-table afs-detail-table"><thead><tr><th>매체 · 기사</th><th>어디까지 다뤘나</th><th>이렇게 판단한 이유</th></tr></thead><tbody>{rows.map((row) => { const scope = scopeFor(row.scope.index); return <tr key={row.source}><td className="afs-perspective-article"><b>{row.source}</b><span>분석 기사 {row.analyzedArticles}건</span></td><td data-label="어디까지 다뤘나"><span className={`afs-scope-tag ${scope.cls}`}>{scope.plain}</span>{scope.formal ? <span className="afs-scope-formal">{scope.formal}</span> : null}</td><td className="afs-scope-reason" data-label="이렇게 판단한 이유">사건 설명 {row.scope.episodicSentenceCount}문장 · 구조적 맥락 {row.scope.thematicSentenceCount}문장</td></tr>; })}</tbody></table></div>
  </>;
}

function SourcePanel({ detail }: { detail: LiveIssueDetail }) {
  const rows = detail.comparison.sourceLens?.byOutlet.filter((entry) => entry.roleCounts.length) ?? [];
  if (!rows.length) return <span className="afs-dim">추출된 인용원 없음</span>;
  const totals = new Map<string, number>();
  rows.forEach((row) => row.roleCounts.forEach((role) => totals.set(role.roleLabel, (totals.get(role.roleLabel) ?? 0) + role.articleCount)));
  const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ko"));
  const top = ranked[0];
  return <>
    <div className="afs-perspective-summary"><div className="afs-perspective-stat"><span className="afs-kicker">가장 많이 반복된 취재원</span><strong>{top[0]} · {top[1]}건</strong><span className="afs-meta">확인된 취재원 {totals.size}명·집단</span>{ranked.length > 1 ? <div className="afs-source-summary"><span>그 밖의 반복 등장</span><span>{ranked.slice(1, 6).map(([label, count]) => `${label} ${count}건`).join(" · ")}</span></div> : null}</div></div>
    <div className="afs-scroll"><table className="afs-prototype-table afs-detail-table afs-source-table"><thead><tr><th>매체 · 기사</th><th>등장한 사람</th><th>전달 방식</th></tr></thead><tbody>{rows.map((row) => <tr key={row.source}><td className="afs-perspective-article"><b>{row.source}</b><span>분석 기사 {row.articleCount}건</span></td><td data-label="등장한 사람"><div className="afs-source-list">{row.roleCounts.map((role) => <div className="afs-source-person" key={role.role}><b>{role.roleLabel}</b><span>{role.mentionCount}회</span></div>)}</div></td><td data-label="전달 방식"><div className="afs-source-list">{row.roleCounts.map((role) => <span className="afs-source-voice" key={role.role}>{role.directQuoteArticleCount ? `직접 인용 ${role.directQuoteArticleCount}건` : role.indirectAttributionArticleCount ? `간접 인용 ${role.indirectAttributionArticleCount}건` : "전달 방식 미확인"}</span>)}</div></td></tr>)}</tbody></table></div>
    <p className="afs-source-boundary">재인용은 다른 사람의 논평 안에서 다시 전해진 발언입니다. 같은 인물이 여러 기사에 나오면 위 요약에서는 한 명으로 셉니다. 취재원 구성은 곧 언론사의 입장이나 보도의 균형을 뜻하지 않습니다.</p>
  </>;
}

function MorphologyPanel({ detail }: { detail: LiveIssueDetail }) {
  const rows = detail.comparison.analysisModules?.morphology.byOutlet ?? [];
  if (!rows.length) return <CodingHold />;
  const posLabel: Record<string, string> = { NNG: "일반명사", NNP: "고유명사", VV: "동사", VA: "형용사", MAG: "부사", SN: "숫자", UNKNOWN: "기타" };
  return <div className="afs-scroll"><table className="afs-prototype-table afs-morphology-table"><thead><tr><th>매체</th><th>내용어</th><th>품사 분포</th><th>이 매체가 유독 많이 쓴 말</th></tr></thead><tbody>{rows.map((row) => { const total = Object.values(row.posCounts).reduce((sum, count) => sum + count, 0) || 1; return <tr key={row.source}><td><b>{row.source}</b></td><td className="afs-num">{row.contentTokenCount}</td><td>{Object.entries(row.posCounts).filter(([, count]) => count > 0).map(([pos, count]) => <span className="afs-chip" key={pos}>{posLabel[pos] ?? pos} {Math.round(count / total * 100)}%</span>)}</td><td>{row.terms.length ? row.terms.map((term) => <span className="afs-chip" title={`${term.count}회`} key={`${term.term}-${term.pos}`}>{term.term}</span>) : <span className="afs-dim">·</span>}</td></tr>; })}</tbody></table></div>;
}

type SemanticNetworkGroup = LiveSemanticNetworksModule["groups"][number];

function SemanticNetwork({ group, index }: { group: SemanticNetworkGroup; index: number }) {
  if (!group.nodes.length) return <p className="afs-observation-empty">이 갈래에서는 같은 문장 안의 통제 개념 연결이 관측되지 않았습니다.</p>;
  const hub = group.nodes[0];
  const spokes = group.nodes.slice(1, 8);
  const edgeWeight = (code: string) => group.edges.find((edge) => (edge.source === hub.code && edge.target === code) || (edge.target === hub.code && edge.source === code))?.sentenceCount ?? 0;
  const maxCount = Math.max(...group.nodes.map((node) => node.count), 1);
  const radius = (count: number) => 5 + count / maxCount * 8;
  const placed = spokes.map((node, at) => { const angle = (-90 + 360 / Math.max(1, spokes.length) * at) * Math.PI / 180; return { node, x: 125 + 62 * Math.cos(angle), y: 84 + 54 * Math.sin(angle) }; });
  return <svg className="afs-live-network" viewBox="0 0 250 168" role="img" aria-label={`${group.title}. 중심 개념 ${hub.label}.`} style={{ "--cc": `var(--n${index % 3 + 1})` } as CSSProperties}>
    <g>{placed.filter(({ node }) => edgeWeight(node.code) > 0).map(({ node, x, y }) => <line key={node.code} x1="125" y1="84" x2={x} y2={y} strokeWidth={0.7 + edgeWeight(node.code) * 0.8} />)}</g>
    <g>{placed.map(({ node, x, y }) => <circle className="afs-net-node" key={node.code} cx={x} cy={y} r={radius(node.count)}><title>{node.label} · 연결 문장 {node.count}회</title></circle>)}</g>
    <circle className="afs-net-hub" cx="125" cy="84" r={radius(hub.count) + 3}><title>{hub.label} · 연결 문장 {hub.count}회</title></circle>
    <text className="afs-net-hub-label" x="125" y="84">{hub.label}</text>
    <g>{placed.map(({ node, x, y }) => <text className={`afs-net-label${node.shared ? " shared" : ""}`} key={node.code} x={x} y={y < 84 ? y - radius(node.count) - 5 : y + radius(node.count) + 9} textAnchor="middle">{node.label}</text>)}</g>
  </svg>;
}

function SemanticNetworksPanel({ detail }: { detail: LiveIssueDetail }) {
  const networkData = detail.comparison.analysisModules?.semanticNetworks;
  if (!networkData?.groups.length) return <p className="afs-observation-empty">분석 가능한 의미 연결망이 없습니다.</p>;
  return <>
    <ul className="afs-network-legend"><li>원 크기 = 같은 문장 연결에 참여한 누적 횟수</li><li>선 굵기 = 같은 문장 동시 출현</li><li>옅은 글씨 = 모든 갈래에 공통인 말</li></ul>
    <div className="afs-live-networks">{networkData.groups.map((group, index) => <section key={group.clusterId} style={{ "--cc": `var(--n${index % 3 + 1})` } as CSSProperties}><h3>갈래 {index + 1}<small>{group.outlets.join(" · ") || "매체 미확인"}</small></h3><SemanticNetwork group={group} index={index} /></section>)}</div>
    <p className="afs-source-boundary">{networkData.limitations.join(" ")}</p>
  </>;
}

function DevicePanel({ detail }: { detail: LiveIssueDetail }) {
  const rows = detail.comparison.analysisModules?.devices?.byOutlet ?? [];
  const morphology = new Map((detail.comparison.analysisModules?.morphology.byOutlet ?? []).map((row) => [row.source, row.terms]));
  if (!rows.length) return <p className="afs-observation-empty">분석 가능한 근거 장치가 없습니다.</p>;
  return <><div className="afs-scroll"><table className="afs-prototype-table afs-device-table"><thead><tr><th>매체</th><th>제목-본문 정렬</th><th>핵심 지칭어</th><th>리드문<span className="afs-badge">실측</span></th><th>통계·표현 선택<span className="afs-badge">실측</span></th></tr></thead><tbody>{rows.map((row) => { const terms = morphology.get(row.source) ?? []; const lead = row.devices.filter((device) => device.leadArticleCount > 0); return <tr key={row.source}><td><b>{row.source}</b><span className="afs-table-sub">분석 기사 {row.analyzedArticles}건</span></td><td>{row.headlineAlignment ?? <span className="afs-dim">·</span>}</td><td>{terms.length ? terms.slice(0, 4).map((term) => <span className="afs-chip" key={`${term.term}-${term.pos}`}>{term.term}</span>) : <span className="afs-dim">·</span>}</td><td>{lead.length ? lead.map((device) => <span className="afs-chip afs-chip-on" key={device.code}>{device.label} <b>{device.leadArticleCount}건</b></span>) : <span className="afs-dim">관측 없음</span>}</td><td>{row.devices.length ? row.devices.map((device) => <span className="afs-chip" key={device.code}>{device.label} <b>{device.count}회</b></span>) : <span className="afs-dim">관측 없음</span>}</td></tr>; })}</tbody></table></div><p className="afs-source-boundary">제목-본문 정렬은 별도 코딩 전이라 표시하지 않았습니다. ‘관측 없음’은 해당 장치가 실제로 없다는 단정이 아니라 자동 규칙에서 명시 표지를 찾지 못했다는 뜻입니다.</p></>;
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
      <FrameCard title="프레이밍 분석 요약" lead>
        <>
          <p className="afs-frame-what">{summaryLine}</p>
          {summary?.whyItMatters ? <p className="afs-frame-note">{summary.whyItMatters}</p> : null}
        </>
      </FrameCard>
      <FrameCard title="프레임 4기능 비교" cite="Entman (1993) · 기사 본문 구조화" note="각 기사가 무엇을 문제로 규정하고, 원인을 어디에 귀인하며, 누구를 어떻게 평가하고, 어떤 해결책을 암시하는지 언론사 간 관점 차이를 문장 수준에서 비교합니다.">
        <>
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
        </>
      </FrameCard>
      <FrameCard number="02" title="비슷한 방식으로 보도한 기사 묶음" cite="Matthes & Kohring 2008" note="매체별 성향을 나누는 표가 아닙니다. 사건을 문제·원인·평가·대응으로 구성한 방식이 비슷한 기사들을 하나의 군집으로 묶었습니다. 각 카드의 군집 번호와 제목이 그 군집이 공유하는 핵심을 보여줍니다.">
        <NarrativeClusters detail={detail} />
      </FrameCard>
      <FrameCard number="03" title="기사가 이 사안을 바라본 관점" cite="Boydstun et al. 2014 · Codebook 2020" note="한 기사에 여러 관점이 함께 나타날 수 있습니다. 여기서는 기사 전체를 가장 강하게 이끄는 하나를 대표 관점으로, 나머지를 함께 나타난 관점으로 표시합니다.">
        <PerspectivePanel detail={detail} />
      </FrameCard>
      <FrameCard number="04" title="기사들은 무엇을 강조했나" cite="Semetko & Valkenburg 2000" note="같은 사건을 다루면서 당사자 간 충돌, 사람의 사연, 비용, 도덕적 판단, 정부 책임 중 무엇을 강조했는지 비교합니다.">
        <GenericFramePanel detail={detail} />
      </FrameCard>
      <FrameCard number="05" title="사건 하나로 봤나, 구조 문제로 봤나" cite="Iyengar 1991" note="기사가 특정 사건·인물에 머무는지, 제도와 구조의 맥락까지 설명하는지 비교합니다. ‘사건+구조’는 두 특징이 함께 나타난 기사를 구분하기 위해 이 화면에서 추가한 적용 범주입니다.">
        <ScopePanel detail={detail} />
      </FrameCard>
      <FrameCard number="06" title="누구의 말을 중심에 뒀나" cite="Gans 1979 · 취재원 분석" note="공인은 소속·직책·이름으로, 일반인은 사건과 관련된 특징·관계·이름으로 표시하고 발언 전달 방식을 비교합니다.">
        <SourcePanel detail={detail} />
      </FrameCard>
      <FrameCard number="07" title="갈래별 의미 연결망" cite="semantic network analysis" note="02의 갈래를 기준으로 그렸습니다. 02가 아직 재코딩 전이라 시야 변수 중심의 구분입니다.">
        <SemanticNetworksPanel detail={detail} />
      </FrameCard>
      <FrameCard number="08" title="형태소 분석" cite="키네스 분석(Kilgarriff 2001)" note="표본 전체 대비 그 매체가 유독 많이 쓴 말(로그 비율 상위). 이 층위는 보도 초점(아젠다) 차이를 보여주며, 프레이밍 차이와는 다릅니다.">
        <MorphologyPanel detail={detail} />
      </FrameCard>
      <FrameCard number="09" title="근거 장치" cite="Gamson & Modigliani 1989" note="원 논문의 장치는 은유·모범 사례·캐치프레이즈·묘사·시각 이미지 다섯 가지입니다. 텍스트 장치(제목 정렬·지칭어)는 05에서 옮겼고, 시각 이미지 코딩은 차기 예정입니다.">
        <DevicePanel detail={detail} />
      </FrameCard>
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
      <p className="afs-scope-context"><b>{LIVE_SCOPE_LABEL}</b> 기준으로 집계한 의제입니다. 점수는 이 범위 안의 매체 확산·기사량을 반영하며, 사회적 중요도나 사실성 점수가 아닙니다.</p>
      <p className="afs-prov"><b>자동 분석 초안 · 사람 검토 전</b><span>본문 근거 {detail.issue.contentAvailableCount}/{detail.issue.articleCount}건</span></p>
      {view === "overview" ? <Overview detail={detail} /> : null}
      {view === "outlets" ? <Outlets detail={detail} /> : null}
      {view === "framing" ? <Framing detail={detail} /> : null}
      {view === "report" ? <Report detail={detail} /> : null}
    </>
  );
}
