import { HBars, HeatTable, Spectrum, StackBars } from "../../../../charts";
import { DIM_LABEL, DIM_ORDER, familyLabel, VOICE_LABEL } from "../../../../../lib/initial-five/derive";
import { loadIssue } from "../load";

export default async function OutletsPage({ params }: { params: Promise<{ issueId: string }> }) {
  const issue = await loadIssue(params);
  const roleColumns = [...new Set(issue.outlets.flatMap((outlet) => outlet.roles.map((role) => role.label)))];
  const voiceKeys = ["direct_quote", "journalist_narration", "indirect_source"].map((key) => ({
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
            축의 양 끝은 본문에서 가장 많이 관측된 두 설명입니다. 매체 위치는 그 매체의 기사가 어느 설명에 붙었는지로
            정해집니다 — 매체의 정치 성향이 아니라 이 사건에서의 서술입니다.
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
              칸의 숫자는 그 역할의 취재원이 몇 명 등장했는지입니다. 취재원 구성은 매체가 누구의 말을 통해 사건을 설명하기로
              했는지를 보여줍니다.
            </p>
            <HeatTable
              columns={roleColumns}
              rowHead="매체"
              caption="매체별 취재원 역할 구성 (명)"
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
            취재원을 몇 명 실었나
            <small>총 인원</small>
          </h3>
          <div className="afs-in">
            <HBars
              caption="매체별 취재원 수"
              unit="명"
              rows={issue.outlets.map((outlet) => ({
                label: outlet.outlet,
                value: outlet.sourceCount,
                sub: `기사 ${outlet.articleCount}건 · 직접 인용 ${outlet.directQuotes}회 · 간접 전언 ${outlet.indirectQuotes}회`,
              }))}
            />
          </div>
          <p className="afs-foot">가장 긴 막대가 이 의제에서 취재원을 가장 많이 실은 매체입니다.</p>
        </section>
      </div>

      <div className="afs-grid-2">
        <section className="afs-card">
          <h2>
            어떤 방식으로 말했나
            <small>인용 방식 구성</small>
          </h2>
          <div className="afs-in">
            <p className="afs-note">
              직접 인용이 많으면 취재원의 말로 사건을 옮긴 것이고, 기자 서술이 많으면 매체가 직접 설명한 것입니다.
            </p>
            <StackBars
              keys={voiceKeys}
              caption="매체별 인용 방식 (본문 근거 건수)"
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
            <small>회</small>
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
            간접 전언 비중이 높으면 확인 가능한 발화자 없이 서술된 부분이 많다는 뜻입니다.
          </p>
        </section>
      </div>

      <section className="afs-card">
        <h2>
          매체 × 다섯 층위
          <small>지배 프레임 계열</small>
        </h2>
        <div className="afs-scroll">
          <table className="afs-table">
            <caption>같은 층위에서 서로 다른 계열이 보이면 그 층위에서 매체가 갈렸다는 뜻입니다.</caption>
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
                  <th scope="row">{outlet.outlet}</th>
                  {DIM_ORDER.map((dim) => (
                    <td key={dim}>
                      {outlet.families[dim]?.length
                        ? outlet.families[dim].map((family) => (
                            <span className="afs-chip" key={family} style={{ marginRight: 4 }}>
                              {familyLabel(family)}
                            </span>
                          ))
                        : "미관측"}
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
