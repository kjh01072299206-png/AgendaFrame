import { DIM_LABEL, particle } from "../../../../../lib/initial-five/derive";
import { loadIssue } from "../load";

export default async function ReportPage({ params }: { params: Promise<{ issueId: string }> }) {
  const issue = await loadIssue(params);
  const splitAxes = issue.axes.filter(
    (axis) => new Set(issue.outlets.map((o) => o.families[axis.dimension]?.[0]).filter(Boolean)).size >= 2,
  );
  const flatAxes = issue.axes.filter((axis) => !splitAxes.includes(axis));
  const topVoice = issue.voices[0];
  const topRole = issue.outlets
    .flatMap((outlet) => outlet.roles)
    .reduce<Record<string, number>>((acc, role) => ({ ...acc, [role.label]: (acc[role.label] ?? 0) + role.count }), {});
  const leadRole = Object.entries(topRole).sort((a, b) => b[1] - a[1])[0];

  return (
    <article className="afs-report">
      <section className="afs-card afs-card-lead">
        <h2>리드</h2>
        <div className="afs-in afs-prose">
          {issue.lead ? <p>{issue.lead}</p> : null}
          <p>
            이 사건을 다룬 기사는 {issue.articleCount}건, 매체는 {issue.outletCount}곳이다. 본문에서 고정된 근거는{" "}
            {issue.evidenceTotal}건이며, 설명을 나누는 다섯 층위 가운데 {issue.splitDimensions}곳에서 매체별 대표 계열이
            갈렸다.
          </p>
        </div>
      </section>

      <section className="afs-card">
        <h2>공통으로 확인된 사실</h2>
        <div className="afs-in">
          {issue.commonGround ? <p className="afs-prose">{issue.commonGround}</p> : null}
          {issue.commonSubjects.length ? (
            <ul className="afs-facts afs-facts-inline" style={{ marginTop: 10 }}>
              {issue.commonSubjects.map((subject) => (
                <li key={subject}>
                  <span>{subject}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </section>

      <section className="afs-card">
        <h2>쟁점 구도</h2>
        <div className="afs-in afs-prose">
          {issue.mainDifference ? <p>{issue.mainDifference}</p> : null}
          {issue.mostSplit ? (
            <p>
              매체가 가장 많이 갈린 층위는 <b>{DIM_LABEL[issue.mostSplit.dimension]}</b>
              {particle(DIM_LABEL[issue.mostSplit.dimension], "이", "가")} 매체별 최빈 계열 {issue.mostSplit.kinds}종으로
              나뉘었다.
            </p>
          ) : (
            <p>매체별 최빈 계열로 보면 다섯 층위 어디에서도 매체가 갈리지 않았다.</p>
          )}
          {issue.spectrum ? (
            <p>
              대표 축으로 세운 <b>{DIM_LABEL[issue.spectrum.dimension]}</b>에서 한쪽은 “{issue.spectrum.left.label}”로
              설명했고({issue.spectrum.left.articleCount}건), 다른 쪽은 “{issue.spectrum.right.label}”로 설명했다(
              {issue.spectrum.right.articleCount}건).
              {issue.spectrum.nested ? " 다만 한쪽 극이 모든 매체를 포함하므로 이 축은 대립이 아니라 포함 관계다." : ""}
            </p>
          ) : null}
          {splitAxes.length ? (
            <p>
              매체가 갈린 층위는 {splitAxes.map((axis) => axis.label).join(" · ")}이다.
              {flatAxes.length
                ? ` ${flatAxes.map((axis) => axis.label).join(" · ")}에서는 매체 사이에 차이가 관측되지 않았다.`
                : ""}
            </p>
          ) : null}
        </div>
      </section>

      {issue.clusters.length ? (
        <section className="afs-card">
          <h2>서사 비교</h2>
          <div className="afs-in afs-prose">
            {issue.clusters.map((cluster) => (
              <p key={cluster.label}>
                <b>{cluster.label}</b> — {cluster.description} 기사 {cluster.articleCount}건이 이 줄기에 속하며, 매체는{" "}
                {cluster.outlets.join(" · ")}이다.
              </p>
            ))}
          </div>
        </section>
      ) : null}

      <section className="afs-card">
        <h2>누구의 목소리로 설명했나</h2>
        <div className="afs-in afs-prose">
          {issue.sourceContext ? <p>{issue.sourceContext}</p> : null}
          {topVoice ? (
            <p>
              본문 근거를 발화 방식으로 나누면 <b>{topVoice.label}</b>이 {topVoice.count}건으로 가장 많다.
              {leadRole ? ` 가장 많이 등장한 취재원 역할은 ${leadRole[0]}(인용·전언 ${leadRole[1]}회)이다.` : ""}
            </p>
          ) : null}
          {issue.sourceCaution ? <p>{issue.sourceCaution}</p> : null}
        </div>
      </section>

      <section className="afs-card">
        <h2>이렇게 읽어 보세요</h2>
        <div className="afs-in">
          <ol className="afs-questions">
            {issue.spectrum ? (
              <li>
                이 사건을 “{issue.spectrum.left.label}”로 보는 기사와 “{issue.spectrum.right.label}”로 보는 기사를 나란히 읽고,
                두 설명이 각각 어떤 근거를 들었는지 비교해 보세요.
              </li>
            ) : null}
            <li>
              기사에 실린 말이 취재원의 발언인지 기자의 서술인지 나눠 읽어 보세요. 이 의제에서는 {topVoice?.label ?? "직접 인용"}이
              가장 많았습니다.
            </li>
            {flatAxes.length ? (
              <li>
                {flatAxes[0].label} 층위에서는 매체 차이가 관측되지 않았습니다. 모두 같게 설명한 부분이 있다면, 그것이 정말
                합의된 사실인지 아니면 아무도 묻지 않은 질문인지 생각해 보세요.
              </li>
            ) : null}
          </ol>
        </div>
      </section>

      <section className="afs-card">
        <h2>이 분석의 범위</h2>
        <div className="afs-in afs-prose">
          {issue.comparisonEngine.limitNote ? <p>{issue.comparisonEngine.limitNote}</p> : null}
          <p>
            이 리포트는 {issue.articleCount}건의 기사 본문에서 자동으로 뽑은 설명 요소를 정리한 것이다. 층위별 코딩은 AI 이중
            코딩 뒤 판정을 거쳤고, 의제 단위 비교(쟁점 축·패턴)는{" "}
            {issue.comparisonEngine.semanticAi ? "AI" : "규칙 기반"} 집계다. 매체의 의도나 이념을 판정하지 않는다.
          </p>
          <p>
            ‘미관측’은 분석 가능한 본문에서 해당 설명을 찾지 못했다는 뜻이다. 취재원의 발언은 그 매체의 입장이 아니다. 본문
            전문은 저장하지 않고, 근거는 문단·문장 위치와 비복원 지문으로만 남는다.
          </p>
          {issue.layers.some((layer) => layer.notObserved > 0) ? (
            <p>
              <b>이 의제에서 관측되지 않은 것</b>{" "}
              {issue.layers
                .filter((layer) => layer.notObserved > 0)
                .map((layer) => `${layer.label}${particle(layer.label, "은", "는")} 기사 ${layer.notObserved}건에서 관측되지 않았다.`)
                .join(" ")}
            </p>
          ) : null}
        </div>
      </section>
    </article>
  );
}
