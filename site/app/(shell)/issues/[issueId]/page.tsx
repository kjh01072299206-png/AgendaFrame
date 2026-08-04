import { Donut, HBars } from "../../../charts";
import { DIM_LABEL, familyLabel } from "../../../../lib/initial-five/derive";
import { loadIssue } from "./load";

export default async function IssueOverviewPage({ params }: { params: Promise<{ issueId: string }> }) {
  const issue = await loadIssue(params);
  /* 문장은 이 분석(claude 판정본)에서만 만든다. comparison.data 는 다른 세대라 함께 실으면 모순이 생긴다. */
  const splitNarrated = issue.dimensionBasis.filter((row) => row.narratedKinds >= 2);
  const voicelessRows = issue.dimensionBasis.filter((row) => row.narratedItems === 0 && row.attributedItems > 0);
  const narratedItems = issue.dimensionBasis.reduce((sum, row) => sum + row.narratedItems, 0);
  const attributedItems = issue.dimensionBasis.reduce((sum, row) => sum + row.attributedItems, 0);
  const sharedNarrated = issue.dimensionBasis
    .filter((row) => row.narratedKinds === 1)
    .map((row) => ({
      dimension: row.dimension,
      family: issue.outlets.map((outlet) => outlet.leadNarrated[row.dimension]?.family).find(Boolean),
    }))
    .filter((entry): entry is { dimension: string; family: string } => Boolean(entry.family));
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
            <p>
              {sharedNarrated.length ? (
                <>
                  매체가 직접 쓴 서술로 보면{" "}
                  <b>
                    {sharedNarrated
                      .map((entry) => `${DIM_LABEL[entry.dimension]}(${familyLabel(entry.family)})`)
                      .join(" · ")}
                  </b>
                  는 참여 매체가 모두 같은 계열로 설명했습니다.
                </>
              ) : (
                <>매체가 직접 쓴 서술만으로는 모든 매체가 같게 설명한 층위가 없습니다.</>
              )}
            </p>
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
            <p>
              {splitNarrated.length ? (
                <>
                  매체 자체 서술 기준으로{" "}
                  <b>{splitNarrated.map((row) => DIM_LABEL[row.dimension]).join(" · ")}</b>에서 대표 계열이 갈렸습니다.
                </>
              ) : (
                <>매체가 직접 쓴 서술만으로는 다섯 층위 어디에서도 대표 계열이 갈리지 않았습니다.</>
              )}
            </p>
            <p>
              <b>근거의 성질</b> 이 사안에서 확인된 설명 {narratedItems + attributedItems}건 가운데 매체가 직접 쓴 것은{" "}
              {narratedItems}건, 취재원의 말로 실린 것은 {attributedItems}건입니다.
              {voicelessRows.length
                ? ` ${voicelessRows.map((row) => `‘${DIM_LABEL[row.dimension]}’`).join(" · ")}의 설명은 전부 취재원 발언이므로, 그 층위는 매체 서술로 비교할 수 없습니다.`
                : ""}
            </p>
          </div>
          <p className="afs-foot">
            다섯 층위 가운데 매체 자체 서술 기준으로 {issue.splitDimensions}곳에서 대표값이 갈렸습니다. 어느 층위인지는 프레이밍 분석 화면에서
            층위별로 볼 수 있습니다.
          </p>
        </section>
      </div>

      {issue.clusters.length ? (
        <section className="afs-card">
          <h2>
            기사들이 연결한 서사
            <span className="afs-chip">AI 요약 · 참고</span>
            <small>묶음 {issue.clusters.length}개</small>
          </h2>
          <div className="afs-in">
            <p className="afs-note">
              아래는 클러스터링 모델이 붙인 이야기 줄기 이름이며, 다섯 층위 코딩과는 별도 산출물입니다. 코딩 결과 자체에서
              나온 프레임 군집은{" "}
              <a className="afs-link" href={`/issues/${encodeURIComponent(issue.issueId)}/framing`}>
                프레이밍 분석의 ‘요소 조합으로 묶은 프레임’
              </a>
              에 있습니다 — 이 사안에서는 {issue.frameClusters.length}종입니다.
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
              sub="층위 슬롯"
              caption="기사 × 다섯 층위 슬롯의 관측 상태 — 미관측도 한 칸으로 센다"
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
              {issue.policySaturated ? (
                <p className="afs-note">
                  이 표본에서는 정책 프레임 계열이 <b>기사 전수에 모두 부여</b>됐습니다 — 분류기가 포화된 상태이므로 매체를
                  변별하지 못합니다. 아래 막대는 기술적 표기이며 비교 근거가 아닙니다.
                </p>
              ) : null}
              <HBars
                caption="정책 프레임이 나타난 기사 수"
                rows={issue.policyFrames.map((f) => ({ label: f.label, value: f.count }))}
              />
            </div>
          </section>
        ) : null}
      </div>

      <section className="afs-card">
        <h3>
          이 표본은 어떤 기사들인가
          <small>시야 · 맥락 · 장르</small>
        </h3>
        <div className="afs-in">
          <div className="afs-cards">
            {issue.sample.scope.length ? (
              <article className="afs-mini">
                <h3>시야 (Iyengar)</h3>
                <p>
                  {issue.sample.scope.map((s) => `${s.label} ${s.count}`).join(" · ")}건. 일화적 보도는 사건을 개별 사례로,
                  주제적 보도는 구조 안에 놓습니다.
                </p>
              </article>
            ) : null}
            {issue.sample.contextDepth.length ? (
              <article className="afs-mini">
                <h3>맥락 깊이</h3>
                <p>{issue.sample.contextDepth.map((s) => `${s.label} ${s.count}`).join(" · ")}건.</p>
              </article>
            ) : null}
            {issue.sample.genres.length ? (
              <article className="afs-mini">
                <h3>장르</h3>
                <p>
                  {issue.sample.genres.map((s) => `${s.label} ${s.count}`).join(" · ")}건. 사설·칼럼이 섞이면 비교 기준이
                  달라지므로 장르를 함께 밝힙니다.
                </p>
              </article>
            ) : null}
            {issue.sample.independentGroupCount !== null ? (
              <article className="afs-mini">
                <h3>독립 매체군</h3>
                <p>
                  매체 {issue.outletCount}곳이 {issue.sample.independentGroupCount}개 독립 그룹입니다. 같은 그룹의 매체는 서로
                  독립된 관측으로 보기 어렵습니다.
                </p>
              </article>
            ) : null}
          </div>
        </div>
      </section>

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
        <p className="afs-foot">본문 전문은 저장하지 않습니다. 근거는 문장 위치와 비복원 지문으로만 남습니다.</p>
      </section>
    </>
  );
}
