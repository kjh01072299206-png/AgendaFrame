import { getInitialFiveIssueBundle } from "../../../../../lib/initial-five/artifacts";
import { DIM_LABEL, familyLabel, particle, safeDecode } from "../../../../../lib/initial-five/derive";
import { LiveIssueView } from "../live-issue";
import { loadIssue } from "../load";

export default async function ReportPage({ params }: { params: Promise<{ issueId: string }> }) {
  const { issueId } = await params;
  const decoded = safeDecode(issueId);
  if (!getInitialFiveIssueBundle(decoded)) return <LiveIssueView issueId={decoded} view="report" />;
  const issue = await loadIssue(Promise.resolve({ issueId }));
  /* 문장은 전부 이 분석(claude 판정본)에서 계산한다. 공개 JSON 의 comparison.data 는
     다른 세대(rules_local)라 같은 화면에 실으면 서로를 부정한다 — 그래서 쓰지 않는다. */
  const splitRows = issue.dimensionBasis.filter((row) => row.narratedKinds >= 2);
  const flatRows = issue.dimensionBasis.filter((row) => row.narratedKinds === 1);
  const voicelessRows = issue.dimensionBasis.filter((row) => row.narratedItems === 0 && row.attributedItems > 0);
  const sharedRows = flatRows
    .map((row) => ({
      row,
      family: issue.outlets.map((outlet) => outlet.leadNarrated[row.dimension]?.family).find(Boolean),
    }))
    .filter((entry) => entry.family);
  const narratedItems = issue.dimensionBasis.reduce((sum, row) => sum + row.narratedItems, 0);
  const attributedItems = issue.dimensionBasis.reduce((sum, row) => sum + row.attributedItems, 0);
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
            {issue.evidenceTotal}건이며, 설명을 나누는 다섯 층위 가운데 매체 자체 서술 기준으로 {issue.splitDimensions}곳에서 대표 계열이
            갈렸다.
          </p>
        </div>
      </section>

      <section className="afs-card">
        <h2>공통으로 확인된 사실</h2>
        <div className="afs-in">
          <p className="afs-prose">
            {sharedRows.length
              ? `매체가 직접 쓴 서술로 보면 ${sharedRows
                  .map((entry) => `‘${DIM_LABEL[entry.row.dimension]}’는 참여 매체가 모두 ${familyLabel(entry.family)} 계열로 설명했다`)
                  .join(", ")}.`
              : "매체가 직접 쓴 서술만으로는 모든 매체가 같게 설명한 층위가 없다."}
            {voicelessRows.length
              ? ` ${voicelessRows.map((row) => `‘${DIM_LABEL[row.dimension]}’`).join(" · ")}의 설명은 전부 취재원의 말로 실려, 매체 서술로는 공통점을 셀 수 없다.`
              : ""}
          </p>
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
          {splitRows.length ? (
            <p>
              매체 자체 서술이 갈린 층위는 {splitRows.map((row) => DIM_LABEL[row.dimension]).join(" · ")}이다.
              {flatRows.length
                ? ` ${flatRows.map((row) => DIM_LABEL[row.dimension]).join(" · ")}에서는 매체 사이에 차이가 관측되지 않았다.`
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
          <p>
            다섯 층위에서 확인된 설명 {narratedItems + attributedItems}건 가운데 매체가 직접 쓴 것은 {narratedItems}건,
            취재원의 말로 실린 것은 {attributedItems}건이다.
          </p>
          {topVoice ? (
            <p>
              설명을 발화 방식으로 나누면 <b>{topVoice.label}</b>이 {topVoice.count}건으로 가장 많다.
              {leadRole ? ` 가장 많이 등장한 취재원 역할은 ${leadRole[0]}(인용·전언 ${leadRole[1]}회)이다.` : ""}
            </p>
          ) : null}
          <p>인용 횟수는 목소리의 가시성을 나타내는 관측치이며, 취재원의 신뢰도나 매체의 지지 여부를 뜻하지 않는다.</p>
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
            {flatRows.length ? (
              <li>
                {DIM_LABEL[flatRows[0].dimension]} 층위에서는 매체 차이가 관측되지 않았습니다. 모두 같게 설명한 부분이 있다면,
                그것이 정말 합의된 사실인지 아니면 아무도 묻지 않은 질문인지 생각해 보세요.
              </li>
            ) : voicelessRows.length ? (
              <li>
                {DIM_LABEL[voicelessRows[0].dimension]} 층위의 설명은 전부 취재원의 말로 실렸습니다. 매체가 그 판단을 직접
                쓰지 않았다는 사실 자체를 하나의 편집 선택으로 읽어 보세요.
              </li>
            ) : null}
          </ol>
        </div>
      </section>

      {/* 방법과 한계는 방법론 화면에 있다. 여기서는 이 사안에서만 성립하는 사실 하나만 남긴다. */}
      {issue.layers.some((layer) => layer.notObserved > 0) ? (
        <section className="afs-card">
          <h2>관측되지 않은 것</h2>
          <div className="afs-in afs-prose">
            <p>
              {issue.layers
                .filter((layer) => layer.notObserved > 0)
                .map((layer) => `${layer.label}${particle(layer.label, "은", "는")} 기사 ${layer.notObserved}건에서 관측되지 않았다.`)
                .join(" ")}
            </p>
          </div>
        </section>
      ) : null}
    </article>
  );
}
