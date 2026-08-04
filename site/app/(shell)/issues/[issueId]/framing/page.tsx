import { HBars } from "../../../../charts";
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

      <section className="afs-card">
        <h2>
          묶음별 다섯 층위 조합
          <span className="afs-chip afs-chip-brand">매체 서술 기준</span>
          <small>기본형과 다른 칸에 ‘변이’ 표시</small>
        </h2>
        <div className="afs-in">
          <div className="afs-scroll">
            <table className="afs-table afs-table-sig">
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
                {clusters.map((cluster, index) => (
                  <tr key={cluster.key}>
                    <th scope="row">{index === 0 ? "기본형" : `변이 ${index}`}</th>
                    {DIM_ORDER.map((dim) => {
                      const differs = cluster.differsAt.includes(dim);
                      const partial = cluster.partialAt.includes(dim);
                      const value = cluster.signature[dim] ? familyLabel(cluster.signature[dim]) : "미관측";
                      return (
                        <td key={dim} className={differs ? "afs-sig-diff" : partial ? "afs-sig-part" : undefined}>
                          <b>{value}</b>
                          {/* 색만으로 다름을 전달하지 않는다 — 글자로도 남긴다 */}
                          {differs ? <small>변이</small> : partial ? <small>부분 관측</small> : null}
                        </td>
                      );
                    })}
                    <td className="afs-num">{cluster.count}건</td>
                    <td className="afs-sig-outlets">{cluster.outlets.join(" · ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="afs-in">
          <details className="afs-fold">
            <summary>취재원 발언까지 포함해 묶으면 {issue.frameClusters.length}종</summary>
            <p className="afs-note">
              인용된 발언까지 지배 계열에 넣어 다시 묶은 결과입니다. 이 묶음은 <b>매체의 프레임이 아니라 인용 배치의 기록</b>
              이므로 위 표와 별개로 둡니다 — 두 결과가 다르면, 차이를 만든 것은 매체의 서술이 아니라 누구의 말을 실었는지입니다.
            </p>
            <p className="afs-note">
              {issue.frameClusters
                .map(
                  (cluster, index) =>
                    `${index === 0 ? "기본형" : `변이 ${index}`} ${cluster.count}건 (${cluster.outlets.join(" · ")})`,
                )
                .join(" / ")}
            </p>
          </details>
        </div>
        <p className="afs-foot">
          칸이 비면(미관측) 그 층위의 매체 서술을 본문에서 찾지 못했다는 뜻이며, <b>차이로 세지 않습니다</b>. 관측 범위만 다른
          칸은 ‘부분 관측’으로 표시합니다.
          {variantDims.length
            ? ` 이 사안에서 판단이 갈린 층위는 ${variantDims.map((dim) => DIM_LABEL[dim]).join(" · ")}입니다.`
            : ""}
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
                <b>{layer.question}</b>
                {families.length === 1 ? (
                  <>
                    {" "}
                    — 이 층위의 설명 {total}건은 모두 <b>{familyLabel(families[0])}</b> 계열입니다.
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
