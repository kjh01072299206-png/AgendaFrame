import Link from "next/link";
import { Donut, HBars, RankList, SplitMeter, StackBars } from "../charts";
import { deriveDay, DIM_LABEL, particle, VOICE_LABEL } from "../../lib/initial-five/derive";

const formatDate = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return `${y}년 ${Number(m)}월 ${Number(d)}일`;
};

export default function HomePage() {
  const day = deriveDay();
  const topLayer = [...day.layers, ...day.sideLayers].sort((a, b) => b.split - a.split)[0];
  // 어느 의제에서도 매체가 갈리지 않은 층위 — "무엇을 말하지 않았나"가 이 서비스의 발견이다
  const silent = day.layers.filter((layer) => layer.split === 0);
  // 네 범주를 다 넘긴다. 잘라내면 막대에 인쇄되는 합계가 실제보다 작아진다.
  const voiceKeys = ["direct_quote", "journalist_narration", "indirect_source", "uncertain_quote"].map((key) => ({
    key,
    label: VOICE_LABEL[key],
  }));
  const widest = day.spread.slice().sort((a, b) => b.outletCount - a.outletCount)[0];
  // 같은 사건을 다르게 제목 붙인 기사 두 건 — 홈에 실물 대비를 하나 둔다
  const contrastIssue = day.issues[0];
  const contrast = (() => {
    if (!contrastIssue) return [];
    const seen = new Set<string>();
    const picked: typeof contrastIssue.articles = [];
    for (const article of contrastIssue.articles) {
      const key = article.families.problem_definition ?? "none";
      if (seen.has(key) || picked.some((p) => p.outlet === article.outlet)) continue;
      seen.add(key);
      picked.push(article);
      if (picked.length === 2) break;
    }
    return picked.length === 2 ? picked : contrastIssue.articles.slice(0, 2);
  })();

  return (
    <>
      <header className="afs-head">
        <span className="afs-eyebrow">{formatDate(day.basisDate)} · 하루의 보도 지형</span>
        <h1>성향 라벨이 아니라, 설명의 구조를 비교합니다</h1>
        <p>
          같은 사건을 다룬 기사 {day.articleCount}건을 매체 {day.outletCount}곳에 걸쳐 다섯 층위로 쪼갰습니다 — 무엇을 문제로
          봤나, 왜 그렇게 됐다고 했나, 누구의 책임이라 했나, 옳고 그름을 어떻게 봤나, 무엇을 해야 한다고 했나. 각 항목은 기사
          본문의 문단·문장 위치에 묶여 있어 원문에서 확인할 수 있습니다.
        </p>
      </header>

      <section className="afs-card afs-card-lead">
        <h2>이날의 발견</h2>
        <div className="afs-in">
          <p className="afs-finding">
            {silent.length ? (
              <>
                이날 한국 언론은 <b>{silent.map((l) => l.label).join(" · ")}</b>에서 매체 사이에 아무 차이도 남기지 않았습니다 —
                의제 {day.issueCount}건 전부입니다.
              </>
            ) : (
              <>다섯 층위 모두에서 매체 간 차이가 관측되었습니다.</>
            )}
          </p>
          <p className="afs-finding-sub">
            반대로 가장 잘 갈린 지표는 <b>{topLayer?.label}</b>({topLayer?.split}/{topLayer?.total})입니다
            {topLayer && day.sideLayers.some((l) => l.key === topLayer.key)
              ? " — 프레이밍 다섯 층위가 아니라 취재원·인용 방식 쪽입니다."
              : "."}{" "}
            이 사건에서 매체 차이는 찬반이 아니라 <b>누구의 말을 통해 설명하기로 했는가</b>에서 먼저 벌어졌습니다. 다만 범주
            수가 다른 지표끼리는 갈림 횟수를 그대로 견줄 수 없습니다.
          </p>

          {contrast.length === 2 ? (
            <div className="afs-contrast">
              <p className="afs-contrast-q">
                {contrastIssue?.rank}위 · {contrastIssue?.title} — 같은 사건, 다른 제목
              </p>
              <div className="afs-contrast-pair">
                {contrast.map((article, index) => (
                  <blockquote key={article.articleId} className={index === 0 ? "l" : "r"}>
                    <cite>{article.outlet}</cite>
                    <p>{article.title}</p>
                  </blockquote>
                ))}
              </div>
              <p className="afs-contrast-foot">
                제목은 편집의 결과입니다. 이 서비스는 제목이 아니라 본문의 설명 구조를 비교하지만, 차이가 이미 제목에서
                시작된다는 점은 읽기 전에 알아 둘 만합니다.
              </p>
            </div>
          ) : null}
        </div>
        <p className="afs-foot">
          {contrastIssue ? (
            <Link className="afs-link" href={`/issues/${encodeURIComponent(contrastIssue.issueId)}/outlets`}>
              이 사안에서 매체가 어디에서 갈라지는지 보기 →
            </Link>
          ) : null}
        </p>
      </section>

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
              <h3 className="afs-layer-head">
                프레이밍 층위가 아닌 지표
                <b>범주 수가 달라 위와 같은 자로 재지 않습니다</b>
              </h3>
              <SplitMeter
                rows={day.sideLayers.map((layer) => ({
                  label: layer.label,
                  note: layer.note,
                  split: layer.split,
                  total: layer.total,
                }))}
              />
            </div>
            <p className="afs-foot">
              {topLayer
                ? `이날 표본에서 가장 많이 갈린 지표는 ‘${topLayer.label}’${particle(topLayer.label, "이", "가")} ${topLayer.split}/${topLayer.total}입니다.`
                : ""}
              {silent.length
                ? ` ${silent.map((l) => `‘${l.label}’`).join(" · ")}${particle(silent[silent.length - 1].label, "은", "는")} 어느 의제에서도 갈리지 않았습니다.`
                : ""}
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
              프레임 항목을 누가 말했는지로 나눈 것입니다. 기자 서술 비중이 높으면 매체 자신의 설명이 많다는 뜻입니다.
            </p>
            <StackBars
              keys={voiceKeys}
              caption="의제별 인용 방식 (프레임 항목 기준)"
              rows={day.issues.map((issue) => ({
                label: `${issue.rank}위`,
                parts: Object.fromEntries(issue.voices.map((v) => [v.key, v.count])),
              }))}
            />
          </div>
        </section>

        <section className="afs-card">
          <h3>
            사건을 어떤 시야로 썼나
            <small>Iyengar 일화적 · 주제적</small>
          </h3>
          <div className="afs-in">
            <p className="afs-note">
              일화적 보도는 사건을 개별 사례로 전하고, 주제적 보도는 구조·맥락 안에 놓습니다. Iyengar(1991)는 일화적 보도가
              많으면 책임이 개인에게 귀속되는 쪽으로 읽힌다고 봤습니다.
            </p>
            <HBars caption="시야별 기사 수" rows={day.scope.map((s) => ({ label: s.label, value: s.count }))} />
            {day.genres.length ? (
              <>
                <h3 className="afs-layer-head">
                  장르
                  <b>비교 범위를 규정합니다</b>
                </h3>
                <HBars caption="장르별 기사 수" rows={day.genres.map((g) => ({ label: g.label, value: g.count }))} />
              </>
            ) : null}
          </div>
          <p className="afs-foot">
            {(() => {
              const ep = day.scope.find((s) => s.key === "episodic")?.count ?? 0;
              const th = day.scope.find((s) => s.key === "thematic")?.count ?? 0;
              if (!ep && !th) return "시야 코딩이 관측되지 않았습니다.";
              return ep > th
                ? `일화적 ${ep}건 대 주제적 ${th}건입니다. 이날 표본에서 책임 귀속 최다 패턴이 개인 책임인 것과 함께 읽을 수 있습니다.`
                : `주제적 ${th}건 대 일화적 ${ep}건입니다.`;
            })()}
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
            프레이밍 이론(Entman 1993)은 매체 차이가 찬반 이전에 <b>무엇을 문제로 볼 것인가</b> 단계에서 시작된다고 봅니다.
            이날 표본에서 실제로 관측된 순서는 위 계기에 있는 그대로이며, 이론이 예측한 순서와 같지 않을 수 있습니다. 갈리지
            않은 층위는 비교할 것이 없다는 뜻이므로, 그 사실 자체가 정보입니다.
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
