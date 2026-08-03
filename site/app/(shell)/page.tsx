import { Donut, HBars, RankList, SplitMeter, StackBars } from "../charts";
import { deriveDay } from "../../lib/initial-five/derive";

const formatDate = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return `${y}년 ${Number(m)}월 ${Number(d)}일`;
};

export default function HomePage() {
  const day = deriveDay();
  const topLayer = day.layers[0];
  const flatLayer = day.layers[day.layers.length - 1];
  const voiceKeys = day.voices.slice(0, 3).map((v) => ({ key: v.key, label: v.label }));
  const widest = day.spread.slice().sort((a, b) => b.outletCount - a.outletCount)[0];

  return (
    <>
      <header className="afs-head">
        <span className="afs-eyebrow">{formatDate(day.basisDate)} · 하루의 보도 지형</span>
        <h1>이날 언론은 무엇을 얼마나, 그리고 어떻게 갈라져 다뤘나</h1>
        <p>
          가장 많이 보도된 의제 {day.issueCount}건, 기사 {day.articleCount}건, 매체 {day.outletCount}곳을 본문 근거로
          비교했습니다. 개별 사안 설명은 순위를 눌러 들어가고, 이 화면에서는 하루 전체의 모양을 봅니다.
        </p>
      </header>

      <dl className="afs-kpis">
        <div className="afs-kpi">
          <dt>의제</dt>
          <dd>
            {day.issueCount}
            <small>건</small>
          </dd>
          <p>같은 사건으로 묶인 보도 묶음</p>
        </div>
        <div className="afs-kpi">
          <dt>기사</dt>
          <dd>
            {day.articleCount}
            <small>건</small>
          </dd>
          <p>본문까지 분석을 마친 기사</p>
        </div>
        <div className="afs-kpi">
          <dt>매체</dt>
          <dd>
            {day.outletCount}
            <small>곳</small>
          </dd>
          <p>가장 넓게 퍼진 의제는 {widest?.outletCount ?? 0}곳</p>
        </div>
        <div className="afs-kpi">
          <dt>본문 근거</dt>
          <dd>
            {day.evidenceTotal}
            <small>건</small>
          </dd>
          <p>문단·문장 위치로 고정된 인용 지점</p>
        </div>
      </dl>

      <div className="afs-grid-2">
        <section className="afs-card">
          <h2>
            오늘의 의제 순위
            <small>보도량 순</small>
          </h2>
          <div className="afs-in">
            <RankList
              rows={day.issues.map((issue) => ({
                rank: issue.rank,
                title: issue.title,
                href: `/issues/${encodeURIComponent(issue.issueId)}`,
                category: issue.category,
                articleCount: issue.articleCount,
                outletCount: issue.outletCount,
              }))}
            />
          </div>
          <p className="afs-foot">막대 길이는 해당 의제의 기사 수입니다. 눌러 들어가면 사안 설명부터 시작합니다.</p>
        </section>

        <div className="afs-grid" style={{ gridTemplateColumns: "minmax(0, 1fr)", alignContent: "start" }}>
          <section className="afs-card">
            <h3>
              매체 차이는 어느 층위에서 드러나나
              <small>{day.issueCount}개 의제 기준</small>
            </h3>
            <div className="afs-in">
              <p className="afs-note">
                각 층위에서 매체별 대표값이 두 종류 이상 관측된 의제 수입니다. 점이 많을수록 그 층위가 매체를 잘 가릅니다.
              </p>
              <SplitMeter
                rows={day.layers.map((layer) => ({
                  label: layer.label,
                  note: layer.note,
                  split: layer.split,
                  total: layer.total,
                }))}
              />
            </div>
            <p className="afs-foot">
              {topLayer ? `‘${topLayer.label}’가 가장 잘 가릅니다(${topLayer.split}/${topLayer.total}).` : ""}
              {flatLayer && flatLayer.split === 0 ? ` ‘${flatLayer.label}’는 이날 어느 의제에서도 매체를 가르지 않았습니다.` : ""}
            </p>
          </section>

          <section className="afs-card">
            <h3>분야 구성</h3>
            <div className="afs-in">
              <Donut
                items={day.categories.map((c) => ({ label: c.label, count: c.count }))}
                center={day.articleCount}
                sub="기사"
                caption="분야별 기사 수"
              />
            </div>
          </section>
        </div>
      </div>

      <div className="afs-grid">
        <section className="afs-card">
          <h3>
            매체는 얼마나 참여했나
            <small>기사 수 · 의제 수</small>
          </h3>
          <div className="afs-in">
            <HBars
              caption="매체별 기사 수"
              rows={day.outlets.map((outlet) => ({
                label: outlet.outlet,
                value: outlet.articleCount,
                sub: `${day.issueCount}개 의제 중 ${outlet.issueCount}개에 보도`,
              }))}
            />
          </div>
        </section>

        <section className="afs-card">
          <h3>
            어떤 목소리로 말했나
            <small>인용 방식</small>
          </h3>
          <div className="afs-in">
            <p className="afs-note">
              본문 근거를 누가 말했는지로 나눈 것입니다. 기자 서술 비중이 높으면 매체 자신의 설명이 많다는 뜻입니다.
            </p>
            <StackBars
              keys={voiceKeys}
              caption="의제별 인용 방식 구성"
              rows={day.issues.map((issue) => ({
                label: `${issue.rank}위`,
                parts: Object.fromEntries(issue.voices.map((v) => [v.key, v.count])),
              }))}
            />
          </div>
        </section>

        <section className="afs-card">
          <h3>
            이날 가장 많이 쓰인 설명 틀
            <small>프레임 계열</small>
          </h3>
          <div className="afs-in">
            <p className="afs-note">
              다섯 층위에서 관측된 설명을 계열로 묶은 것입니다. 하루의 보도가 사건을 주로 어떤 틀로 옮겼는지 보여 줍니다.
            </p>
            <HBars caption="계열별 관측 건수" rows={day.families.slice(0, 8).map((f) => ({ label: f.label, value: f.count }))} />
          </div>
          <p className="afs-foot">
            {day.families[0] ? `가장 많이 쓰인 틀은 ‘${day.families[0].label}’(${day.families[0].count}건)입니다.` : ""}
          </p>
        </section>
      </div>

      <section className="afs-card">
        <h3>이 화면을 읽는 방법</h3>
        <div className="afs-in afs-prose">
          <p>
            순위는 보도량입니다. 많이 보도된 것이 중요한 것과 같지는 않지만, 하루의 편집 관심이 어디로 쏠렸는지를 보여줍니다.
          </p>
          <p>
            층위별 변별력은 이 서비스의 출발점입니다. 매체 차이는 찬반 이전에 <b>무엇을 문제로 볼 것인가</b> 단계에서
            시작되고, 어떤 층위에서는 아예 갈리지 않습니다. 갈리지 않은 층위는 비교할 것이 없다는 뜻이므로, 그 사실 자체가
            정보입니다.
          </p>
          <p>
            모든 수치는 기사 본문에서 뽑은 근거 위치(문단·문장)에 묶여 있습니다. 각 의제 화면에서 근거 건수와 원문 링크를
            함께 볼 수 있습니다.
          </p>
        </div>
      </section>
    </>
  );
}
