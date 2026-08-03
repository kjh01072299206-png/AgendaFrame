import { Donut, HBars } from "../../../charts";
import { loadIssue } from "./load";

export default async function IssueOverviewPage({ params }: { params: Promise<{ issueId: string }> }) {
  const issue = await loadIssue(params);
  const timeSpan = issue.articles
    .map((article) => article.publishedAt)
    .filter(Boolean)
    .sort() as string[];
  const hour = (iso?: string) => (iso ? iso.slice(11, 16) : "");

  return (
    <>
      <div className="afs-grid-2">
        <section className="afs-card afs-card-lead">
          <h2>무슨 일이 있었나</h2>
          <div className="afs-in afs-prose">
            {issue.commonGround ? <p>{issue.commonGround}</p> : null}
            {issue.commonSubjects.length ? (
              <>
                <h3 style={{ margin: "14px 0 8px", fontSize: 13, fontWeight: 750 }}>
                  모든 기사에 공통으로 나타난 표현
                </h3>
                <p className="afs-note">
                  인물·기관·날짜 같은 사실 항목과 평가 어휘가 함께 들어 있습니다. 평가 어휘가 공통이라는 것은 사실이 합의됐다는
                  뜻이 아니라, 같은 표현이 반복 인용됐다는 뜻입니다.
                </p>
                <ul className="afs-facts afs-facts-inline">
                  {issue.commonSubjects.map((subject) => (
                    <li key={subject}>
                      <span>{subject}</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </div>
          <p className="afs-foot">
            {timeSpan.length
              ? `보도 시각 ${hour(timeSpan[0])} ~ ${hour(timeSpan[timeSpan.length - 1])} · 기사 ${issue.articleCount}건`
              : `기사 ${issue.articleCount}건`}
          </p>
        </section>

        <section className="afs-card">
          <h2>어디에서 갈라졌나</h2>
          <div className="afs-in afs-prose">
            {issue.mainDifference ? <p>{issue.mainDifference}</p> : null}
            {issue.sourceContext ? (
              <p>
                <b>취재원 구성</b> {issue.sourceContext}
              </p>
            ) : null}
          </div>
          <p className="afs-foot">
            다섯 층위 가운데 {issue.splitDimensions}곳에서 매체별 대표값이 갈렸습니다. 어느 층위인지는 프레이밍 분석 화면에서
            층위별로 볼 수 있습니다.
          </p>
        </section>
      </div>

      {issue.clusters.length ? (
        <section className="afs-card">
          <h2>
            기사들이 연결한 서사
            <small>묶음 {issue.clusters.length}개</small>
          </h2>
          <div className="afs-in">
            <p className="afs-note">
              같은 사건을 다룬 기사들이 실제로 어떤 이야기 줄기로 갈라졌는지, 본문 요소 조합으로 묶은 것입니다.
            </p>
            <div className="afs-cards">
              {issue.clusters.map((cluster) => (
                <article className="afs-mini" key={cluster.label}>
                  <h3>{cluster.label}</h3>
                  <p>{cluster.description}</p>
                  <p style={{ marginTop: 8 }}>
                    <span className="afs-chip afs-num">기사 {cluster.articleCount}건</span>{" "}
                    {cluster.outlets.map((outlet) => (
                      <span className="afs-chip" key={outlet}>
                        {outlet}
                      </span>
                    ))}
                  </p>
                </article>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      <div className="afs-grid">
        <section className="afs-card">
          <h3>
            설명은 누구의 것으로 실렸나
            <small>관측 상태</small>
          </h3>
          <div className="afs-in">
            <p className="afs-note">
              ‘취재원 발언’은 인용된 말이고 ‘매체 서술’은 기자가 직접 쓴 문장입니다. 취재원 발언 비중이 높으면 이 표본에서는
              매체 자체 서술을 근거로 프레임을 비교하기 어렵습니다 — 어느 말을 어디에 배치했는지는 비교할 수 있지만, 그것을
              매체의 동의로 읽어서는 안 됩니다.
            </p>
            <Donut
              items={issue.statuses.map((s) => ({ label: s.label, count: s.count }))}
              center={issue.statuses.reduce((sum, s) => sum + s.count, 0)}
              sub="관측"
              caption="관측 상태 구성"
            />
          </div>
        </section>

        <section className="afs-card">
          <h3>
            어떤 프레임 계열이 쓰였나
            <small>관측 건수 · 상위 {Math.min(6, issue.families.length)}종</small>
          </h3>
          <div className="afs-in">
            <HBars
              caption="계열별 관측 건수"
              rows={issue.families.slice(0, 6).map((f) => ({ label: f.label, value: f.count }))}
            />
          </div>
        </section>

        {issue.policyFrames.length ? (
          <section className="afs-card">
            <h3>
              정책 프레임
              <small>기사 수</small>
            </h3>
            <div className="afs-in">
              <HBars
                caption="정책 프레임이 나타난 기사 수"
                rows={issue.policyFrames.map((f) => ({ label: f.label, value: f.count }))}
              />
            </div>
          </section>
        ) : null}
      </div>

      <section className="afs-card">
        <h2>
          이 의제의 기사
          <small>{issue.articles.length}건</small>
        </h2>
        <div className="afs-scroll">
          <table className="afs-table">
            <thead>
              <tr>
                <th scope="col">매체</th>
                <th scope="col">제목</th>
                <th scope="col">보도 시각</th>
                <th scope="col">근거</th>
                <th scope="col">원문</th>
              </tr>
            </thead>
            <tbody>
              {issue.articles.map((article) => (
                <tr key={article.articleId}>
                  <th scope="row">{article.outlet}</th>
                  <td>{article.title}</td>
                  <td className="afs-num">{hour(article.publishedAt ?? undefined)}</td>
                  <td className="afs-num">{article.evidenceCount}건</td>
                  <td>
                    {article.url ? (
                      <a className="afs-link" href={article.url} target="_blank" rel="noopener noreferrer">
                        보기 ↗
                      </a>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="afs-foot">본문 전문은 저장하지 않습니다. 근거는 문단·문장 위치와 비복원 지문으로만 남습니다.</p>
      </section>
    </>
  );
}
