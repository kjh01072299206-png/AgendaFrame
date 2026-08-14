import { notFound } from "next/navigation";
import { getActiveSnapshot } from "../../../../../lib/active-snapshot";
import { getInitialFiveIssueBundle } from "../../../../../lib/initial-five/artifacts";
import { deriveIssue, safeDecode } from "../../../../../lib/initial-five/derive";
import { protoIssue } from "../../../../../lib/proto";
import { FramingSemanticPage } from "../../../semantic-analysis-pages";
import {
  Clusters,
  DeviceTable,
  DimMatrix,
  GenericFrames,
  LayerVerdict,
  PolicyFrames,
  SemanticNetworks,
} from "../../../proto-parts";
import { LiveIssueView } from "../live-issue";
import { loadIssue } from "../load";

export const metadata = { title: "프레이밍 분석 | AgendaFrame" };

/* 프레이밍 분석은 이론에 붙은 층위만 모은다. 세는 것(인용원·인용 방식·형태소)은 언론사 비교로 갔다.
   각 층위 제목 옆의 출처가 그 표를 왜 그렇게 그렸는지의 근거다. */
export default async function FramingPage({ params }: { params: Promise<{ issueId: string }> }) {
  const { issueId } = await params;
  const decoded = safeDecode(issueId);
  const active = await getActiveSnapshot();
  const activeBundle = active.getIssueBundle(decoded);
  if (active.mode === "live" && activeBundle) {
    return <FramingSemanticPage bundle={activeBundle} issue={deriveIssue(activeBundle)} />;
  }
  if (!getInitialFiveIssueBundle(decoded)) return <LiveIssueView issueId={decoded} view="framing" />;
  const issue = await loadIssue(Promise.resolve({ issueId }));
  const proto = protoIssue(issue.issueId);
  if (!proto) notFound();

  /* 계열 이름만으로는 "누구의 공동 책임" 인지 알 수 없다. 라이브 코딩본이 층위별 의역문에서
     뽑아 둔 주체를 항목 칸에 붙인다. 두 산출물은 기사 순서가 같고 frames 만 기사 id 를 갖는다. */
  const DIM_BY_ROW: Record<string, string> = {
    "무엇이 문제인가": "problem_definition",
    "왜 이렇게 됐나": "causal_interpretation",
    "누구 책임인가": "responsibility_attribution",
    "어떻게 평가하나": "moral_evaluation",
    "어떻게 하자는가": "treatment_recommendation",
  };
  const liveByArticle = new Map(issue.articles.map((article) => [article.articleId, article]));
  const subjects = proto.evidence.map((entry, index) => {
    const live = proto.frames ? liveByArticle.get(proto.frames[index]?.article_id ?? "") : undefined;
    const byRow: Record<string, string[]> = {};
    for (const [rowLabel, dim] of Object.entries(DIM_BY_ROW)) byRow[rowLabel] = live?.subjects[dim] ?? [];
    return byRow;
  });

  return (
    <>
      <section className="afs-card afs-card-lead">
        <h2>이 사안의 프레이밍</h2>
        <div className="afs-in afs-prose">
          <p>{proto.agreedLine}</p>
          <p>{proto.splitLine}</p>
        </div>
      </section>

      <section className="afs-card">
        <h2>
          여섯 항목을 무엇으로 규정했나
          <small>Entman 1993</small>
        </h2>
        <div className="afs-in">
          <DimMatrix rows={proto.evidence} subjects={subjects} />
        </div>
      </section>

      <section className="afs-card">
        <h2>
          요소 조합 군집
          <small>Matthes &amp; Kohring 2008</small>
        </h2>
        <div className="afs-in">
          <Clusters mk={proto.mk} />
        </div>
      </section>

      {/* 열이 여덟이라 절반 폭에 두면 잘린다(관문 DESK-CLIP). 폭을 다 쓴다.
          지배 프레임 도넛은 이 표의 '지배' 칸과 같은 값이고 의제마다 값이 하나뿐이어서 뺐다. */}
      <section className="afs-card">
        <h2>
          정책 프레임
          <small>Boydstun et al. 2014</small>
        </h2>
        <div className="afs-in">
          {proto.frames ? <PolicyFrames frames={proto.frames} /> : <p className="afs-hold">코딩 진행 중</p>}
        </div>
      </section>

      <section className="afs-card">
        <h2>
          보편 프레임 다섯 종
          <small>Semetko &amp; Valkenburg 2000</small>
        </h2>
        <div className="afs-in">
          {proto.frames ? <GenericFrames frames={proto.frames} /> : <p className="afs-hold">코딩 진행 중</p>}
        </div>
      </section>

      <section className="afs-card">
        <h2>
          시야의 넓이와 지칭어
          <small>Iyengar 1991</small>
        </h2>
        <div className="afs-in">
          <DeviceTable rows={proto.devices} />
        </div>
      </section>

      <section className="afs-card">
        <h2>
          프레임별 의미 연결망
          <small>semantic network analysis</small>
        </h2>
        <div className="afs-in">
          <SemanticNetworks groups={proto.frameGroups} />
        </div>
      </section>

      <section className="afs-card">
        <h2>
          층위별 판정
          <small className="afs-num">
            {proto.splitLayers[0]}/{proto.splitLayers[1]} 갈림
          </small>
        </h2>
        <div className="afs-in">
          <LayerVerdict counts={proto.counts} />
        </div>
      </section>
    </>
  );
}
