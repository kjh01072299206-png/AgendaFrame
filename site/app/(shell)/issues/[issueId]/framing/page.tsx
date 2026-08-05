import { HBars, HeatTable, Spectrum, StackBars } from "../../../../charts";
import { DIM_LABEL, DIM_ORDER, familyLabel, VOICE_LABEL, type LayerItem } from "../../../../../lib/initial-five/derive";
import { loadIssue } from "../load";

type ArticleRef = { title: string; url?: string | null };

/* 근거는 되짚을 수 있어야 근거다. 예전에는 지문(해시) 앞 10자를 칩으로 달아 뒀는데
   누를 수도, 뜻을 볼 수도 없어 장식이었다. 원문 링크와 문장 번호를 싣고, 해시는
   같은 문장을 다시 지목하는 식별자로 title 속성에만 남긴다. */
function ItemList({
  items,
  kind,
  articles,
}: {
  items: LayerItem[];
  kind: "narrated" | "attributed";
  articles: Map<string, ArticleRef>;
}) {
  return (
    <ol className="afs-patterns">
      {items.map((item, index) => {
        const article = articles.get(item.articleId);
        return (
          <li key={`${item.articleId}-${index}`}>
            <span className={`afs-patterns-no${kind === "attributed" ? " afs-patterns-no-src" : ""}`}>{index + 1}</span>
            <div>
              <p>{item.paraphrase}</p>
              <p className="afs-patterns-meta">
                <span className="afs-chip">{item.outlet}</span>
                {item.family ? <span className="afs-chip afs-chip-brand">{familyLabel(item.family)}</span> : null}
                {item.voiceKind ? <span className="afs-chip">{VOICE_LABEL[item.voiceKind] ?? item.voiceKind}</span> : null}
                {item.locator ? (
                  <span
                    className="afs-chip afs-chip-src afs-num"
                    title={
                      item.hash
                        ? `동일 문장 식별자 ${item.hash.slice(0, 10)} · 소금을 섞은 해시라 외부에서 재계산할 수 없습니다`
                        : undefined
                    }
                  >
                    발췌본 {item.locator}
                    {item.evidenceSentences && item.evidenceSentences > 1 ? ` · 근거 ${item.evidenceSentences}문장` : ""}
                  </span>
                ) : null}
                {article?.url ? (
                  <a className="afs-chip afs-chip-link" href={article.url} target="_blank" rel="noopener noreferrer">
                    기사 원문 ↗
                  </a>
                ) : null}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export default async function FramingPage({ params }: { params: Promise<{ issueId: string }> }) {
  const issue = await loadIssue(params);
  const articleRefs = new Map<string, ArticleRef>(
    issue.articles.map((article) => [article.articleId, { title: article.title, url: article.url }]),
  );

  /* 대표 조합은 매체가 직접 쓴 서술만으로 묶은 것이다. 취재원 발언까지 섞어 묶으면
     인용 배치가 만든 묶음을 '그 매체의 프레임'이라고 부르게 된다. */
  const clusters = issue.narratedClusters.filter((cluster) =>
    Object.values(cluster.signature).some((value) => value !== undefined),
  );
  const base = clusters[0];
  const variantCount = Math.max(0, clusters.length - 1);
  const variantDims = [...new Set(clusters.slice(1).flatMap((cluster) => cluster.differsAt))];
  const narratedArticleCount = clusters.reduce((sum, cluster) => sum + cluster.count, 0);
  const splitDims = issue.dimensionBasis.filter((row) => row.narratedKinds >= 2).map((row) => row.dimension);
  /* 언론사 비교 화면을 여기로 흡수한다. 그쪽의 '매체 × 다섯 층위' 표와 이쪽의 '묶음별 조합' 표는
     같은 행렬을 한 번은 매체별로 펼치고 한 번은 같은 값끼리 묶은 것이었다 — 정보량이 같다.
     매체별 표 하나만 두고, 어느 묶음에 속하는지는 열로 붙인다. */
  const roleColumns = [...new Set(issue.outlets.flatMap((outlet) => outlet.roles.map((role) => role.label)))];
  const coarseColumns = [...new Set(issue.outlets.flatMap((outlet) => outlet.coarseRoles.map((role) => role.label)))];
  const narrowedTotal = issue.outlets.reduce((sum, outlet) => sum + outlet.narrowedActorCount, 0);
  const actorTotal = issue.outlets.reduce(
    (sum, outlet) => sum + outlet.articles.reduce((n, article) => n + article.coarseRoles.length, 0),
    0,
  );
  const voiceKeys = ["direct_quote", "journalist_narration", "indirect_source", "uncertain_quote"].map((key) => ({
    key,
    label: VOICE_LABEL[key],
  }));
  const otherAxes = issue.spectra.filter((axis) => axis.dimension !== issue.spectrum?.dimension);
  const clusterOf = (outlet: string) => {
    const index = clusters.findIndex((cluster) => cluster.outlets.includes(outlet));
    if (index < 0) return null;
    return index === 0 ? "기본형" : `변이 ${index}`;
  };
  const familiesOf = (dimension: string) => {
    const layer = issue.layers.find((row) => row.dimension === dimension);
    if (!layer) return [] as string[];
    return [...new Set([...layer.narrated, ...layer.attributed].map((item) => item.family).filter(Boolean))] as string[];
  };

  return (
    <>
      {/* 6,000px 을 스크롤해서 얻을 결론을 페이지 최대 글자로 맨 위에 놓는다 */}
      <section className="afs-card afs-card-lead afs-conc">
        <p className="afs-conc-eyebrow">요소 조합으로 본 이 사안의 프레임</p>
        <p className="afs-conc-h">
          {narratedArticleCount === 0 ? (
            <>매체 서술로 본 조합 없음</>
          ) : (
            <>
              매체 서술 조합 {clusters.length}종
              {variantCount ? <span className="afs-conc-h-sub"> · 기본형 1 + 변이 {variantCount}</span> : null}
            </>
          )}
        </p>
        <p className="afs-conc-sub">
          {narratedArticleCount === 0 ? (
            <>
              이 사안에서는 <b>매체가 직접 쓴 설명이 다섯 층위 어디에서도 관측되지 않았습니다</b> — 설명이 전부 취재원의 말로
              실렸습니다. 매체 간 프레임 비교는 이 표본에서 성립하지 않고, 아래는 인용 배치의 기록입니다.
            </>
          ) : clusters.length === 1 ? (
            <>
              매체 서술이 관측된 기사 {narratedArticleCount}건은 조합이 <b>모두 같습니다</b>. 이 표본에서 매체 간 프레임 차이는
              관측되지 않았습니다.
            </>
          ) : (
            <>
              매체 서술이 관측된 기사 {narratedArticleCount}건 중 <b>{base?.count ?? 0}건</b>이 같은 조합입니다. 조합이 갈리는
              층위는{" "}
              {variantDims.length ? (
                variantDims.map((dim) => (
                  <a className="afs-conc-chip" href={`#${dim}`} key={dim}>
                    {DIM_LABEL[dim]}
                  </a>
                ))
              ) : (
                <b>관측 범위 차이뿐</b>
              )}
              입니다.
            </>
          )}
        </p>
        {/* 다섯 층위 레일 — 죽어 있던 앵커를 실제 이동 장치로 쓴다 */}
        <nav className="afs-rail" aria-label="다섯 층위로 이동">
          {DIM_ORDER.map((dim) => {
            const layer = issue.layers.find((row) => row.dimension === dim);
            const basis = issue.dimensionBasis.find((row) => row.dimension === dim);
            const total = (layer?.narrated.length ?? 0) + (layer?.attributed.length ?? 0);
            const families = familiesOf(dim);
            const isSplit = splitDims.includes(dim);
            const isVariant = variantDims.includes(dim);
            return (
              <a className={`afs-rail-item${isSplit || isVariant ? " on" : ""}`} href={`#${dim}`} key={dim}>
                <b>{DIM_LABEL[dim]}</b>
                <small>
                  {total === 0
                    ? "미관측"
                    : isSplit
                      ? `매체 서술 ${basis?.narratedKinds ?? 0}종으로 갈림`
                      : isVariant
                        ? "조합이 갈린 층위"
                        : families.length === 1
                          ? familyLabel(families[0])
                          : `계열 ${families.length}종`}
                </small>
              </a>
            );
          })}
        </nav>
        <p className="afs-foot">
          다섯 층위를 따로 코딩한 뒤 <b>조합이 같은 기사</b>를 묶은 결과입니다 — Matthes &amp; Kohring(2008)의 요소 코딩
          방식을 이 표본 크기(기사 {issue.articleCount}건)에 맞춰 완전일치 그룹화로 단순화했습니다. 군집분석이 아닙니다.
          취재원의 말로 실린 설명은 매체 서술과 합산하지 않습니다.{" "}
          <a className="afs-link" href="/tools/method">
            방법론 →
          </a>
        </p>
      </section>

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
            {otherAxes.length ? (
              <details className="afs-fold">
                <summary>다른 층위의 축 {otherAxes.length}개</summary>
                <div className="afs-axis-stack">
                  {otherAxes.map((axis) => (
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
              </details>
            ) : null}
          </div>
          <p className="afs-foot">
            축의 양 끝은 이 층위에서 가장 많이 관측된 두 계열입니다. 사건마다 축을 새로 만들므로 같은 매체가 다른 사건에서는
            반대쪽에 놓일 수 있습니다 — 매체의 정치 성향이 아니라 이 사건에서의 서술입니다.
          </p>
        </section>
      ) : null}

      <section className="afs-card">
        <h2>
          매체별 다섯 층위
          <span className="afs-chip afs-chip-brand">매체 서술 기준</span>
          <small>같은 조합끼리 묶음 표시</small>
        </h2>
        <div className="afs-scroll">
          <table className="afs-table afs-table-sig">
            <caption>
              칸은 그 매체의 최빈 계열입니다. 기사가 1건인 매체(n=1)는 그 기사의 값이며 매체 수준의 일반화가 아닙니다.
            </caption>
            <thead>
              <tr>
                <th scope="col">매체</th>
                {DIM_ORDER.map((dim) => (
                  <th scope="col" key={dim}>
                    {DIM_LABEL[dim]}
                  </th>
                ))}
                <th scope="col">묶음</th>
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
                    <td key={dim} className={variantDims.includes(dim) ? "afs-sig-diff" : undefined}>
                      {outlet.lead[dim]?.family ? (
                        <>
                          {familyLabel(outlet.lead[dim].family)}
                          {outlet.families[dim].length > 1 ? (
                            <small className="afs-num">+{outlet.families[dim].length - 1}</small>
                          ) : null}
                          {/* 계열 이름만으로는 '공동 책임'이 누구와 누구인지 알 수 없다.
                              의역문에서 좁힌 주체를 아래 줄에 붙인다. */}
                          {outlet.subjects[dim]?.length ? (
                            <small className="afs-cell-who">{outlet.subjects[dim].join(" · ")}</small>
                          ) : null}
                        </>
                      ) : (
                        <span className="afs-unobs">미관측</span>
                      )}
                    </td>
                  ))}
                  <td>{clusterOf(outlet.outlet) ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="afs-foot">
          ‘미관측’은 그 층위의 설명을 본문에서 찾지 못했다는 뜻이며 차이로 세지 않습니다. 같은 조합을 쓴 매체는 같은 묶음
          이름을 갖습니다 — 다섯 층위를 따로 코딩한 뒤 조합이 같은 기사를 묶은 결과입니다(Matthes &amp; Kohring 2008의 요소
          코딩을 이 표본 크기에 맞춰 완전일치 그룹화로 단순화. 군집분석이 아닙니다).
          {variantDims.length
            ? ` 이 사안에서 조합이 갈린 층위는 ${variantDims.map((dim) => DIM_LABEL[dim]).join(" · ")}입니다.`
            : ""}{" "}
          <a className="afs-link" href="/tools/method">
            방법론 →
          </a>
        </p>
      </section>

      {issue.layers.map((layer) => {
        const total = layer.narrated.length + layer.attributed.length;
        const families = familiesOf(layer.dimension);
        // 판정 순서가 곧 기준이다. 매체 서술이 없으면 갈림·동일 어느 쪽도 말할 수 없다.
        const isSplit = layer.narrated.length > 0 && layer.outletKinds >= 2;
        const thin = layer.notObserved * 2 >= issue.articleCount;
        return (
          <section className={`afs-card${isSplit ? " afs-card-split" : ""}`} key={layer.dimension} id={layer.dimension}>
            <h2>
              {layer.label}
              {total === 0 ? (
                <span className="afs-chip afs-chip-src">전 기사 미관측</span>
              ) : layer.narrated.length === 0 ? (
                <span className="afs-chip afs-chip-src">매체 서술 0 · 취재원 발언만 {layer.attributed.length}건</span>
              ) : isSplit ? (
                <span className="afs-chip afs-chip-brand">
                  갈림 · 매체 서술 {layer.outletKinds}종 ({layer.narratedOutletCount}/{layer.outletCount}곳)
                </span>
              ) : thin ? (
                <span className="afs-chip afs-chip-src">
                  관측 부족 · 기사 {issue.articleCount}건 중 {layer.notObserved}건 미관측
                </span>
              ) : (
                <span className="afs-chip">
                  매체 간 동일 · 매체 서술 {layer.narratedOutletCount}/{layer.outletCount}곳
                </span>
              )}
              <small>
                매체 서술 {layer.narrated.length} · 취재원 발언 {layer.attributed.length} · 미관측 기사 {layer.notObserved}
              </small>
            </h2>
            <div className="afs-in">
              <p className="afs-note">
                {layer.question}
                {families.length === 1 ? (
                  <>
                    {" "}
                    — 이 층위의 설명 {total}건은 모두 {familyLabel(families[0])} 계열입니다.
                  </>
                ) : families.length > 1 ? (
                  <>
                    {" "}
                    — 계열 {families.length}종: {families.map((family) => familyLabel(family)).join(" · ")}.
                  </>
                ) : null}
              </p>

              {total === 0 ? (
                <p className="afs-note">
                  이 층위에서는 매체 서술도 취재원 발언도 본문 근거로 확인되지 않았습니다. 기사 {layer.notObserved}건 모두
                  미관측입니다.
                </p>
              ) : (
                /* 갈린 층위만 기본으로 펼친다. 나머지는 위 한 줄 요약으로 결론이 이미 전달된다. */
                <details className="afs-fold" open={isSplit}>
                  <summary>
                    근거 {total}건 보기
                    {layer.narrated.length ? ` · 매체 서술 ${layer.narrated.length}` : ""}
                    {layer.attributed.length ? ` · 취재원 발언 ${layer.attributed.length}` : ""}
                  </summary>
                  {layer.narrated.length ? (
                    <>
                      <h3 className="afs-layer-head">
                        매체가 직접 쓴 설명
                        <b className="afs-num">{layer.narrated.length}건</b>
                      </h3>
                      <ItemList items={layer.narrated} kind="narrated" articles={articleRefs} />
                    </>
                  ) : null}
                  {layer.attributed.length ? (
                    <>
                      <h3 className="afs-layer-head">
                        취재원의 말로 실린 설명
                        <b className="afs-num">{layer.attributed.length}건</b>
                      </h3>
                      <ItemList items={layer.attributed} kind="attributed" articles={articleRefs} />
                    </>
                  ) : null}
                </details>
              )}
            </div>
          </section>
        );
      })}

      <div className="afs-grid">
        <section className="afs-card">
          <h3>
            층위별 계열 쏠림
            <small>주장 수 기준</small>
          </h3>
          <div className="afs-in">
            <p className="afs-note">
              층위마다 계열이 몇 종으로 갈렸는지 봅니다. 한 종이면 그 층위는 이 표본에서 만장일치이고, 0이면 전 기사 미관측입니다.
            </p>
            <HBars
              caption="층위별 계열 종류 수"
              unit="종"
              rows={issue.layers.map((layer) => ({
                label: layer.label,
                value: familiesOf(layer.dimension).length,
                sub: `주장 ${layer.narrated.length + layer.attributed.length}건 · 매체 서술 ${layer.narrated.length}건`,
              }))}
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
              <p className="afs-note">
                사안의 내용과 무관하게 뉴스가 반복적으로 쓰는 틀입니다 — 갈등·책임·인간적 관심·도덕성 계열(Semetko &amp;
                Valkenburg 2000의 일반 프레임 목록을 축약한 기술적 라벨이며 검증 대상이 아닙니다).
              </p>
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
                <>
                  <p className="afs-note">
                    정책 프레임 {issue.policyFrames.length}종이 기사 {issue.articleCount}건 <b>전부</b>에 부여됐습니다. 이
                    표본에서는 정책 프레임으로 매체를 변별할 수 없습니다 — 분류기가 포화된 상태이며, 이 라벨은 기술적 표기로만
                    씁니다.
                  </p>
                  <details className="afs-fold">
                    <summary>부여된 계열 {issue.policyFrames.length}종 보기</summary>
                    <p className="afs-note">{issue.policyFrames.map((frame) => frame.label).join(" · ")}</p>
                  </details>
                </>
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
          </section>
        ) : null}
      </div>

      {/* 인용원 분석 — 언론사 비교 화면에서 옮겨왔다. 그쪽에는 '누구를 인용했나'(매체 × 역할 표)와
          '취재원의 말을 몇 번 실었나'(매체별 막대)가 따로 있었는데, 두 번째는 첫 표의 행 합계였다
          (derive.ts 의 sourceCount = roles 합). 표에 '합' 열을 붙여 하나로 만든다.
          '직접 인용 대 간접 전언' 카드도 아래 인용 방식 막대의 두 범주라서 지웠다. */}
      <section className="afs-card">
        <h2>
          인용원 분석
          <small>매체 × 취재원 역할 · 인용·전언 횟수</small>
        </h2>
        <div className="afs-in">
          <p className="afs-note">
            칸의 숫자는 그 역할의 취재원이 인용·전언된 횟수입니다 — 사람 수가 아닙니다. 누구를 부를지 고르는 것은 기자의
            일이므로, 이 표는 매체의 주장이 아니라 매체의 선택을 보여줍니다.
          </p>
          <HeatTable
            columns={[...roleColumns, "합"]}
            rowHead="매체"
            caption="매체별 취재원 역할 구성 (인용·전언 횟수)"
            rows={issue.outlets.map((outlet) => ({
              label: outlet.outlet,
              cells: [
                ...roleColumns.map((column) => ({
                  value: outlet.roles.find((role) => role.label === column)?.count ?? 0,
                })),
                { value: outlet.sourceCount },
              ],
            }))}
          />
          {narrowedTotal ? (
            <details className="afs-fold">
              <summary>
                역할을 어떻게 좁혔나 <span className="afs-chip afs-chip-src">단어 규칙 · {narrowedTotal}/{actorTotal}건</span>
              </summary>
              <p className="afs-note">
                이중코딩이 낸 역할 코드는 <b>{coarseColumns.join(" · ")}</b> 처럼 굵어서, 여당인지 야당인지가 한 통에
                들어갑니다. 코딩 지침이 인물 실명 반환을 금지하므로 다시 코딩해도 이름은 얻을 수 없습니다. 대신 그 취재원의
                근거 문장과 <b>같은 위치에서 뽑힌 의역문</b>을 붙여, 문장이 가리키는 직위·기관을 단어 규칙으로 좁혔습니다.
              </p>
              <p className="afs-note">
                {actorTotal - narrowedTotal
                  ? `${actorTotal - narrowedTotal}건은 좁혀지지 않아 원 역할 코드를 그대로 씁니다. `
                  : ""}
                좁힌 값은 규칙 산출이므로 위 다섯 층위 계열과 같은 신뢰 수준으로 읽으면 안 됩니다.
              </p>
              <div className="afs-scroll">
                <table className="afs-table">
                  <caption>이중코딩이 낸 원 역할 코드로 센 값</caption>
                  <thead>
                    <tr>
                      <th scope="col">매체</th>
                      {coarseColumns.map((column) => (
                        <th scope="col" key={column}>
                          {column}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {issue.outlets.map((outlet) => (
                      <tr key={outlet.outlet}>
                        <th scope="row">{outlet.outlet}</th>
                        {coarseColumns.map((column) => (
                          <td key={column} className="afs-num">
                            {outlet.coarseRoles.find((role) => role.label === column)?.count ?? 0}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          ) : null}
        </div>
        <div className="afs-in">
          <h3 className="afs-layer-head">
            설명을 누구의 입으로 실었나
            <b>분모는 다섯 층위에서 코딩된 주장 수</b>
          </h3>
          <StackBars
            keys={voiceKeys}
            caption="매체별 인용 방식 — 기자 서술 비중이 높으면 매체가 직접 설명한 것"
            rows={issue.outlets.map((outlet) => ({
              label: outlet.outlet,
              parts: Object.fromEntries(outlet.voices.map((voice) => [voice.key, voice.count])),
            }))}
          />
        </div>
        <p className="afs-foot">
          취재원의 발언은 그 매체의 입장이 아닙니다. 인용은 선택이지만 동의는 아닙니다. 역할 코드는 코딩 지침상 실명을 남기지
          않으므로, 같은 코드 안에서 여당·야당을 가르지는 못합니다 — 다음 코딩 회차의 과제입니다.
        </p>
      </section>

      <section className="afs-card">
        <h2>
          기사별 층위 코딩
          <small>{issue.articles.length}건 · 지배 계열</small>
        </h2>
        <div className="afs-in">
          <details className="afs-fold">
            <summary>기사 {issue.articles.length}건의 층위별 계열 표 보기</summary>
            <p className="afs-note">
              한 칸은 그 기사에서 해당 층위의 지배 계열입니다. 취재원 발언으로 실린 설명도 포함하므로, 매체 자체 서술만으로 본
              비교는 위 층위 카드의 ‘매체가 직접 쓴 설명’을 보세요. 같은 매체가 여러 건을 쓴 경우 제목으로 구별합니다.
            </p>
            <div className="afs-scroll">
              <table className="afs-table">
                <thead>
                  <tr>
                    <th scope="col">기사</th>
                    {issue.layers.map((layer) => (
                      <th scope="col" key={layer.dimension}>
                        {DIM_LABEL[layer.dimension]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {issue.articles.map((article) => (
                    <tr key={article.articleId}>
                      <th scope="row">
                        {article.outlet}
                        <small className="afs-cell-sub">{article.title}</small>
                      </th>
                      {issue.layers.map((layer) => (
                        <td key={layer.dimension}>
                          {article.families[layer.dimension] ? familyLabel(article.families[layer.dimension]) : "미관측"}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </div>
      </section>
    </>
  );
}
