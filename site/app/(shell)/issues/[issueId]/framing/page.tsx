import { Donut, HBars } from "../../../../charts";
import { DIM_LABEL, DIM_QUESTION, familyLabel } from "../../../../../lib/initial-five/derive";
import { loadIssue } from "../load";

export default async function FramingPage({ params }: { params: Promise<{ issueId: string }> }) {
  const issue = await loadIssue(params);
  const splitOf = (dimension: string) =>
    new Set(issue.outlets.map((outlet) => outlet.families[dimension]?.[0]).filter(Boolean)).size;

  return (
    <>
      <section className="afs-card">
        <h2>다섯 층위를 하나씩 봅니다</h2>
        <div className="afs-in afs-prose">
          <p>
            프레이밍은 찬반이 아닙니다. 같은 사건을 두고 <b>무엇을 문제로 볼 것인가</b>부터 갈리고, 그 다음에 원인·책임·평가·해법이
            따라옵니다. 아래는 그 다섯 단계를 본문 근거로 나눠 놓은 것입니다.
          </p>
          <p>
            각 층위마다 매체별 대표 계열이 몇 종류인지 함께 적었습니다. 한 종류면 매체들이 같은 방식으로 설명한 것이고, 두
            종류 이상이면 그 층위가 이 사건에서 매체를 가른 지점입니다.
          </p>
        </div>
      </section>

      {issue.axes.map((axis) => {
        const kinds = splitOf(axis.dimension);
        return (
          <section className="afs-card" key={axis.dimension} id={axis.dimension}>
            <h2>
              {axis.label}
              <small>
                관측 {axis.observed}건 · 미관측 {axis.notObserved}건
              </small>
            </h2>
            <div className="afs-in">
              <p className="afs-note">
                {DIM_QUESTION[axis.dimension] ?? axis.question}
                {" — "}
                {kinds >= 2 ? (
                  <b style={{ color: "var(--afs-brand)" }}>매체별 대표 계열 {kinds}종, 이 층위에서 갈렸습니다.</b>
                ) : (
                  <span>매체별 대표 계열 1종, 이 층위에서는 갈리지 않았습니다.</span>
                )}
              </p>
              {axis.patterns.length ? (
                <ol className="afs-patterns">
                  {axis.patterns.map((pattern, index) => (
                    <li key={pattern.label}>
                      <span className="afs-patterns-no afs-num">{index + 1}</span>
                      <div>
                        <p>{pattern.label}</p>
                        <p className="afs-patterns-meta">
                          <span className="afs-chip afs-num">기사 {pattern.articleCount}건</span>
                          {pattern.outlets.map((outlet) => (
                            <span className="afs-chip" key={outlet}>
                              {outlet}
                            </span>
                          ))}
                          {pattern.voiceScope ? <span className="afs-chip">{pattern.voiceScope}</span> : null}
                        </p>
                      </div>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="afs-note">이 층위에서는 본문 근거로 확인된 설명이 없습니다.</p>
              )}
            </div>
          </section>
        );
      })}

      <div className="afs-grid">
        <section className="afs-card">
          <h3>
            프레임 계열 분포
            <small>다섯 층위 합계</small>
          </h3>
          <div className="afs-in">
            <HBars
              caption="계열별 관측 건수"
              rows={issue.families.map((family) => ({ label: family.label, value: family.count }))}
            />
          </div>
        </section>

        {issue.genericFrames.length ? (
          <section className="afs-card">
            <h3>
              일반 프레임
              <small>Semetko·Valkenburg 5종</small>
            </h3>
            <div className="afs-in">
              <p className="afs-note">사안의 내용과 무관하게 뉴스가 반복적으로 쓰는 틀입니다.</p>
              <HBars
                caption="일반 프레임별 기사 수"
                rows={issue.genericFrames.map((frame) => ({ label: frame.label, value: frame.count }))}
              />
            </div>
          </section>
        ) : null}

        {issue.policyFrames.length ? (
          <section className="afs-card">
            <h3>
              정책 프레임
              <small>Boydstun 계열</small>
            </h3>
            <div className="afs-in">
              <Donut
                items={issue.policyFrames.map((frame) => ({ label: frame.label, count: frame.count }))}
                center={issue.policyFrames.length}
                sub="종"
                caption="정책 프레임 구성"
              />
            </div>
          </section>
        ) : null}
      </div>

      <section className="afs-card">
        <h2>
          기사별 층위 코딩
          <small>{issue.articles.length}건</small>
        </h2>
        <div className="afs-scroll">
          <table className="afs-table">
            <thead>
              <tr>
                <th scope="col">매체</th>
                {Object.keys(DIM_LABEL).map((dim) => (
                  <th scope="col" key={dim}>
                    {DIM_LABEL[dim]}
                  </th>
                ))}
                <th scope="col">근거</th>
              </tr>
            </thead>
            <tbody>
              {issue.articles.map((article) => (
                <tr key={article.articleId}>
                  <th scope="row">{article.outlet}</th>
                  {Object.keys(DIM_LABEL).map((dim) => (
                    <td key={dim}>{article.families[dim] ? familyLabel(article.families[dim]) : "미관측"}</td>
                  ))}
                  <td className="afs-num">{article.evidenceCount}건</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
