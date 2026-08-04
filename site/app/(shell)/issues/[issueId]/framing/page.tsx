import { HBars } from "../../../../charts";
import { DIM_LABEL, DIM_ORDER, familyLabel, SCOPE_LABEL, VOICE_LABEL, type LayerItem } from "../../../../../lib/initial-five/derive";
import { loadIssue } from "../load";

function ItemList({ items, kind }: { items: LayerItem[]; kind: "narrated" | "attributed" }) {
  return (
    <ol className="afs-patterns">
      {items.map((item, index) => (
        <li key={`${item.articleId}-${index}`}>
          <span className={`afs-patterns-no${kind === "attributed" ? " afs-patterns-no-src" : ""}`}>{index + 1}</span>
          <div>
            <p>{item.paraphrase}</p>
            <p className="afs-patterns-meta">
              <span className="afs-chip">{item.outlet}</span>
              {item.family ? <span className="afs-chip afs-chip-brand">{familyLabel(item.family)}</span> : null}
              {item.voiceKind ? <span className="afs-chip">{VOICE_LABEL[item.voiceKind] ?? item.voiceKind}</span> : null}
              {item.locator ? <span className="afs-chip afs-chip-src afs-num">{item.locator}</span> : null}
              {item.hash ? <span className="afs-chip afs-chip-src afs-num">{item.hash.slice(0, 10)}…</span> : null}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}

export default async function FramingPage({ params }: { params: Promise<{ issueId: string }> }) {
  const issue = await loadIssue(params);

  return (
    <>
      <section className="afs-card afs-card-lead">
        <h2>다섯 층위를 하나씩 봅니다</h2>
        <div className="afs-in afs-prose">
          <p>
            프레이밍은 찬반이 아닙니다. 같은 사건을 두고 <b>무엇을 문제로 볼 것인가</b>부터 갈리고, 그 다음에 원인·책임·평가·해법이
            따라옵니다.
          </p>
          <p>
            각 층위의 설명을 <b>매체가 직접 쓴 것</b>과 <b>취재원의 말로 실린 것</b>으로 나눠 놓았습니다. 둘을 합치지 않는 것이
            이 분석의 원칙입니다 — 취재원의 발언은 그 매체의 입장이 아니기 때문입니다. 항목마다 근거 문단·문장 위치와 지문이
            붙어 있어 원문에서 확인할 수 있습니다.
          </p>
        </div>
      </section>

      <section className="afs-card">
        <h2>
          요소 조합으로 묶은 프레임
          <span className="afs-chip afs-chip-brand">
            {issue.frameClusters.length}종
          </span>
          <small>Matthes &amp; Kohring 귀납 도출</small>
        </h2>
        <div className="afs-in">
          <p className="afs-note">
            프레임을 통째로 판정하지 않고 다섯 층위를 따로 코딩한 뒤, <b>조합이 같은 기사</b>를 묶은 것입니다. 별도 요약
            모델이 아니라 위 코딩 결과 자체에서 나옵니다. 가장 큰 묶음과 다른 칸에 표시가 붙습니다.
          </p>
          <div className="afs-scroll">
            <table className="afs-table">
              <thead>
                <tr>
                  <th scope="col">묶음</th>
                  {DIM_ORDER.map((dim) => (
                    <th scope="col" key={dim}>
                      {DIM_LABEL[dim]}
                    </th>
                  ))}
                  <th scope="col">기사</th>
                  <th scope="col">매체</th>
                </tr>
              </thead>
              <tbody>
                {issue.frameClusters.map((cluster, index) => (
                  <tr key={cluster.key}>
                    <th scope="row">
                      {index === 0 ? "기본형" : `변이 ${index}`}
                    </th>
                    {DIM_ORDER.map((dim) => (
                      <td key={dim}>
                        {cluster.differsAt.includes(dim) ? (
                          cluster.signature[dim] ? (
                            <span className="afs-chip afs-chip-brand">{familyLabel(cluster.signature[dim])}</span>
                          ) : (
                            <span className="afs-chip">미관측</span>
                          )
                        ) : (
                          <span className="afs-cell-same">{cluster.signature[dim] ? familyLabel(cluster.signature[dim]) : "미관측"}</span>
                        )}
                      </td>
                    ))}
                    <td className="afs-num">{cluster.count}건</td>
                    <td>{cluster.outlets.join(" · ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <p className="afs-foot">
          {issue.frameClusters.length === 1
            ? `기사 ${issue.articleCount}건이 모두 같은 조합입니다 — 이 사안에서는 프레임이 하나이고 변이가 없습니다.`
            : `기본형 ${issue.frameClusters[0]?.count ?? 0}건에 변이 ${issue.frameClusters.length - 1}종입니다. 변이가 다른 층위는 ${[
                ...new Set(issue.frameClusters.slice(1).flatMap((c) => c.differsAt)),
              ]
                .map((d) => DIM_LABEL[d])
                .join(" · ")}입니다.`}
        </p>
      </section>

      {issue.layers.map((layer) => {
        const total = layer.narrated.length + layer.attributed.length;
        return (
          <section className={`afs-card${layer.outletKinds >= 2 ? " afs-card-split" : ""}`} key={layer.dimension} id={layer.dimension}>
            <h2>
              {layer.label}
              {layer.outletKinds >= 2 ? (
                <span className="afs-chip afs-chip-brand">갈림 · 대표 계열 {layer.outletKinds}종</span>
              ) : total === 0 ? (
                <span className="afs-chip afs-chip-src">전 기사 미관측</span>
              ) : (
                <span className="afs-chip">매체 간 동일</span>
              )}
              <small>
                매체 서술 {layer.narrated.length} · 취재원 발언 {layer.attributed.length} · 미관측 기사 {layer.notObserved}
              </small>
            </h2>
            <div className="afs-in">
              <p className="afs-note">{layer.question}</p>

              {layer.narrated.length ? (
                <>
                  <h3 className="afs-layer-head">
                    매체가 직접 쓴 설명
                    <b className="afs-num">{layer.narrated.length}건</b>
                  </h3>
                  <ItemList items={layer.narrated} kind="narrated" />
                </>
              ) : null}

              {layer.attributed.length ? (
                <>
                  <h3 className="afs-layer-head">
                    취재원의 말로 실린 설명
                    <b className="afs-num">{layer.attributed.length}건</b>
                  </h3>
                  <p className="afs-note">
                    아래 설명은 인용된 발언입니다. 매체의 서술로 합산하지 않으므로 비교축 집계(매체 서술 기준)에는 들어가지
                    않습니다.
                  </p>
                  <ItemList items={layer.attributed} kind="attributed" />
                </>
              ) : null}

              {total === 0 ? (
                <p className="afs-note">
                  이 층위에서는 매체 서술도 취재원 발언도 본문 근거로 확인되지 않았습니다. 기사 {layer.notObserved}건 모두
                  미관측입니다.
                </p>
              ) : null}

              <p className="afs-caption">
                항목마다 붙은 문단·문장 위치와 지문으로 원문에서 확인할 수 있습니다. 라벨은 독립 코딩 2회 뒤 판정을 거친
                자동 초안입니다{issue.provenance.model ? ` (${issue.provenance.model})` : ""}.
              </p>
              {layer.patterns.length ? (
                <p className="afs-caption">
                  규칙 기반 비교축이 잡은 패턴 {layer.patterns.length}개
                  {layer.patterns[0]?.voiceScope
                    ? ` (${SCOPE_LABEL[layer.patterns[0].voiceScope] ?? layer.patterns[0].voiceScope})`
                    : ""}
                  : {layer.patterns.map((p) => `${p.label.slice(0, 40)}… ${p.articleCount}건`).join(" / ")}
                </p>
              ) : null}
            </div>
          </section>
        );
      })}

      <div className="afs-grid">
        <section className="afs-card">
          <h3>
            프레임 계열 분포
            <small>관측 건수</small>
          </h3>
          <div className="afs-in">
            <HBars
              caption={`관측된 프레임 항목 ${issue.familyItems.reduce((s, f) => s + f.count, 0)}건 기준`}
              rows={issue.familyItems.map((family) => ({ label: family.label, value: family.count }))}
            />
          </div>
        </section>

        {issue.genericFrames.length ? (
          <section className="afs-card">
            <h3>
              일반 프레임
              <small>기사 수</small>
            </h3>
            <div className="afs-in">
              <p className="afs-note">사안의 내용과 무관하게 뉴스가 반복적으로 쓰는 틀입니다.</p>
              <HBars
                caption="일반 프레임이 나타난 기사 수"
                rows={issue.genericFrames.map((frame) => ({ label: frame.label, value: frame.count }))}
              />
            </div>
          </section>
        ) : null}

        {issue.policyFrames.length ? (
          <section className="afs-card">
            <h3>
              정책 프레임
              <small>기사 {issue.articleCount}건 중</small>
            </h3>
            <div className="afs-in">
              {issue.policySaturated ? (
                <p className="afs-note">
                  정책 프레임 {issue.policyFrames.length}종이 기사 {issue.articleCount}건 <b>전부</b>에 부여됐습니다. 이 표본에서는
                  정책 프레임으로 매체를 변별할 수 없습니다 — 분류기가 포화된 상태이며, 이 라벨은 기술적 표기로만 씁니다.
                </p>
              ) : (
                <>
                  <p className="afs-note">한 기사가 여러 정책 프레임을 함께 쓸 수 있어 합이 기사 수보다 큽니다.</p>
                  <HBars
                    caption={`정책 프레임이 나타난 기사 수 (전체 ${issue.articleCount}건)`}
                    rows={issue.policyFrames.map((frame) => ({ label: frame.label, value: frame.count }))}
                  />
                </>
              )}
            </div>
            {issue.comparisonEngine.secondaryDescriptiveOnly ? (
              <p className="afs-foot">부차 분류(정책·일반 프레임)는 기술적 라벨이며 검증 대상이 아닙니다.</p>
            ) : null}
          </section>
        ) : null}
      </div>

      <section className="afs-card">
        <h2>
          기사별 층위 코딩
          <small>{issue.articles.length}건 · 첫 항목의 계열</small>
        </h2>
        <div className="afs-scroll">
          <table className="afs-table">
            <caption>
              한 칸에는 그 기사에서 해당 층위의 첫 항목 계열을 적었습니다. 취재원 발언으로 실린 것도 포함합니다.
            </caption>
            <thead>
              <tr>
                <th scope="col">매체</th>
                {issue.layers.map((layer) => (
                  <th scope="col" key={layer.dimension}>
                    {DIM_LABEL[layer.dimension]}
                  </th>
                ))}
                <th scope="col">근거</th>
              </tr>
            </thead>
            <tbody>
              {issue.articles.map((article) => (
                <tr key={article.articleId}>
                  <th scope="row">{article.outlet}</th>
                  {issue.layers.map((layer) => (
                    <td key={layer.dimension}>
                      {article.families[layer.dimension] ? familyLabel(article.families[layer.dimension]) : "미관측"}
                    </td>
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
