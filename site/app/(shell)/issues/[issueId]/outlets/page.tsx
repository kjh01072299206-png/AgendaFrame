import { HBars, HeatTable, Spectrum, StackBars } from "../../../../charts";
import { DIM_LABEL, DIM_ORDER, familyLabel, VOICE_LABEL } from "../../../../../lib/initial-five/derive";
import { loadIssue } from "../load";

export default async function OutletsPage({ params }: { params: Promise<{ issueId: string }> }) {
  const issue = await loadIssue(params);
  const roleColumns = [...new Set(issue.outlets.flatMap((outlet) => outlet.roles.map((role) => role.label)))];
  // 네 번째 범주(불확실 인용)를 빼면 막대에 인쇄되는 합계가 실제보다 작아진다
  const voiceKeys = ["direct_quote", "journalist_narration", "indirect_source", "uncertain_quote"].map((key) => ({
    key,
    label: VOICE_LABEL[key],
  }));
  const rest = issue.spectra.filter((axis) => axis.dimension !== issue.spectrum?.dimension);

  return (
    <>
      {issue.spectrum ? (
        <section className="afs-card">
          <h2>
            매체는 어디에서 갈라지는가
            <small>{DIM_LABEL[issue.spectrum.dimension]} 축</small>
          </h2>
          <div className="afs-in">
            <Spectrum
              question={issue.spectrum.question}
              left={issue.spectrum.left}
              right={issue.spectrum.right}
              marks={issue.spectrum.marks}
              unobserved={issue.spectrum.unobserved}
            />
          </div>
          <p className="afs-foot">
            축의 양 끝은 이 층위에서 가장 많이 관측된 두 <b>계열</b>이고, 기사마다 지배 계열이 하나이므로 두 극은 겹치지
            않습니다(양 극 기사 수의 합 = 이 축에서 관측된 기사 수). 매체 위치는 그 매체 기사가 두 계열에 어떻게 배분됐는지의
            비율이며, 매체의 정치 성향이 아니라 이 사건에서의 서술입니다.
            {issue.spectrum.marks.length
              ? ` 이 축에서 매체 자체 서술이 확인된 매체는 ${issue.spectrum.narratedOutlets}/${issue.spectrum.marks.length}곳입니다.`
              : ""}
          </p>
        </section>
      ) : null}

      {rest.length ? (
        <section className="afs-card">
          <h2>
            다른 층위의 축
            <small>{rest.length}개</small>
          </h2>
          <div className="afs-in afs-axis-stack">
            {rest.map((axis) => (
              <div className="afs-axis-item" key={axis.dimension}>
                <h3>{DIM_LABEL[axis.dimension]}</h3>
                <Spectrum
                  question={axis.question}
                  left={axis.left}
                  right={axis.right}
                  marks={axis.marks}
                  unobserved={axis.unobserved}
                />
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <div className="afs-grid-2">
        <section className="afs-card">
          <h2>
            누구를 인용했나
            <small>매체 × 취재원 역할</small>
          </h2>
          <div className="afs-in">
            <p className="afs-note">
              칸의 숫자는 그 역할의 취재원이 <b>인용·전언된 횟수</b>입니다 — 사람 수가 아닙니다. 같은 인물이 여러 번 인용되면 여러 번
              셉니다. 취재원 구성은 매체가 누구의 말을 통해 사건을 설명하기로 했는지를 보여줍니다.
            </p>
            <HeatTable
              columns={roleColumns}
              rowHead="매체"
              caption="매체별 취재원 역할 구성 (인용·전언 횟수)"
              rows={issue.outlets.map((outlet) => ({
                label: outlet.outlet,
                cells: roleColumns.map((column) => ({
                  value: outlet.roles.find((role) => role.label === column)?.count ?? 0,
                })),
              }))}
            />
          </div>
          <p className="afs-foot">취재원의 발언은 그 매체의 입장이 아닙니다. 인용은 선택이지만 동의는 아닙니다.</p>
        </section>

        <section className="afs-card">
          <h3>
            취재원의 말을 몇 번 실었나
            <small>인용·전언 횟수</small>
          </h3>
          <div className="afs-in">
            <HBars
              caption="매체별 인용·전언 횟수"
              unit="회"
              rows={issue.outlets.map((outlet) => ({
                label: outlet.outlet,
                value: outlet.sourceCount,
                sub: `기사 ${outlet.articleCount}건 · 기사당 ${(outlet.sourceCount / Math.max(1, outlet.articleCount)).toFixed(1)}회 · 직접 ${outlet.directQuotes} / 간접 ${outlet.indirectQuotes}`,
              }))}
            />
          </div>
          <p className="afs-foot">막대는 총 횟수입니다. 기사 수가 다르므로 기사당 횟수를 함께 적었습니다.</p>
        </section>
      </div>

      <div className="afs-grid-2">
        <section className="afs-card">
          <h2>
            설명을 어떤 방식으로 실었나
            <small>주장 수 기준 · 위 카드와 분모가 다릅니다</small>
          </h2>
          <div className="afs-in">
            <p className="afs-note">
              직접 인용이 많으면 취재원의 말로 사건을 옮긴 것이고, 기자 서술이 많으면 매체가 직접 설명한 것입니다.{" "}
              <b>여기 숫자는 다섯 층위에서 코딩된 주장 수</b>이고, 위 ‘취재원의 말을 몇 번 실었나’는 취재원별 인용·전언
              횟수입니다 — 분모가 달라 두 숫자는 일치하지 않습니다.
            </p>
            <StackBars
              keys={voiceKeys}
              caption="매체별 인용 방식 — 분모는 프레임 항목(주장) 수이며 본문 근거 문장 수와 다르다"
              rows={issue.outlets.map((outlet) => ({
                label: outlet.outlet,
                parts: Object.fromEntries(outlet.voices.map((voice) => [voice.key, voice.count])),
              }))}
            />
          </div>
        </section>

        <section className="afs-card">
          <h3>
            직접 인용 대 간접 전언
            <small>취재원 인용 횟수 기준</small>
          </h3>
          <div className="afs-in">
            <StackBars
              keys={[
                { key: "direct", label: "직접 인용" },
                { key: "indirect", label: "간접 전언" },
              ]}
              caption="따옴표로 옮긴 말과 전해 들은 말의 비율"
              rows={issue.outlets.map((outlet) => ({
                label: outlet.outlet,
                parts: { direct: outlet.directQuotes, indirect: outlet.indirectQuotes },
              }))}
            />
          </div>
          <p className="afs-foot">
            간접 전언은 따옴표 없이 발화자를 밝혀 전달한 문장입니다. 발화자를 밝히지 않은 익명 서술은 이 값과 별개이며 따로
            측정하지 않습니다.
          </p>
        </section>
      </div>

      <section className="afs-card">
        <h2>
          매체 × 다섯 층위
          <small>최빈 프레임 계열</small>
        </h2>
        <div className="afs-scroll">
          <table className="afs-table">
            <caption>
              칸은 그 매체의 <b>최빈 계열</b>입니다. 기사가 1건인 매체(n=1)는 매체 수준의 일반화가 아니라 그 기사의 값입니다.
              +N 은 같은 층위에 다른 계열도 있었다는 뜻입니다.
            </caption>
            <thead>
              <tr>
                <th scope="col">매체</th>
                {DIM_ORDER.map((dim) => (
                  <th scope="col" key={dim}>
                    {DIM_LABEL[dim]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {issue.outlets.map((outlet) => (
                <tr key={outlet.outlet}>
                  <th scope="row">
                    {outlet.outlet}
                    <small className="afs-num"> n={outlet.articleCount}</small>
                  </th>
                  {DIM_ORDER.map((dim) => (
                    <td key={dim}>
                      {outlet.lead[dim]?.family ? (
                        <>
                          <span className="afs-chip">{familyLabel(outlet.lead[dim].family)}</span>
                          {outlet.lead[dim].tied ? <span className="afs-chip afs-chip-src">동률</span> : null}
                          {outlet.families[dim].length > 1 ? (
                            <span className="afs-chip afs-chip-src afs-num">+{outlet.families[dim].length - 1}</span>
                          ) : null}
                        </>
                      ) : (
                        "미관측"
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="afs-foot">
          ‘미관측’은 그 층위의 설명을 본문에서 찾지 못했다는 뜻이며, 매체가 그렇게 생각하지 않았다는 뜻은 아닙니다.
        </p>
      </section>
    </>
  );
}
