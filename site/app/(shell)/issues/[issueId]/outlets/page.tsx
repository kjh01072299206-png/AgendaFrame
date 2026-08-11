import { notFound } from "next/navigation";
import { getInitialFiveIssueBundle } from "../../../../../lib/initial-five/artifacts";
import { safeDecode } from "../../../../../lib/initial-five/derive";
import { protoIssue } from "../../../../../lib/proto";
import {
  ArticleList,
  MorphologyTable,
  SourcingTable,
  VerticalCompare,
  VoiceTable,
} from "../../../proto-parts";
import { LiveIssueView } from "../live-issue";
import { loadIssue } from "../load";

export const metadata = { title: "언론사 비교 | AgendaFrame" };

/* 언론사 비교는 세는 것만 놓는다 — 누구를 인용했나, 어떤 말로 썼나, 어떤 낱말을 유독 많이 썼나.
   프레임 이론(Entman·Boydstun·Semetko·Iyengar·군집·연결망)은 프레이밍 분석 화면으로 넘긴다. */
export default async function OutletsPage({ params }: { params: Promise<{ issueId: string }> }) {
  const { issueId } = await params;
  const decoded = safeDecode(issueId);
  if (!getInitialFiveIssueBundle(decoded)) return <LiveIssueView issueId={decoded} view="outlets" />;
  const issue = await loadIssue(Promise.resolve({ issueId }));
  const proto = protoIssue(issue.issueId);
  if (!proto) notFound();

  /* 취재원 역할과 발언이 다루는 주체는 라이브 코딩본에서 가져온다. 두 산출물은 기사 순서가 같고,
     frames 만 기사 id 를 갖고 있어 그것으로 잇는다. */
  const liveByArticle = new Map(issue.articles.map((article) => [article.articleId, article]));
  const liveAt = (index: number) =>
    proto.frames ? liveByArticle.get(proto.frames[index]?.article_id ?? "") ?? null : null;

  const sourcingRows = proto.evidence.map((entry, index) => ({
    outlet: entry.outlet,
    roles: (liveAt(index)?.roles ?? []).map((role) => ({ label: role.label, n: role.count })),
    subjects: (liveAt(index)?.passageSubjects ?? []).map((role) => ({ label: role.label, n: role.count })),
  }));

  const rows = proto.evidence.map((entry, index) => ({
    outlet: entry.outlet,
    problem: entry.rows.find((row) => row.label === "무엇이 문제인가")?.family ?? "명시 없음",
    called: (proto.devices[index]?.terms ?? []).slice(0, 4).map((term) => term.used),
    sources: (sourcingRows[index]?.roles ?? []).map((role) => `${role.label} ${role.n}`),
    tokens: proto.morphology[index]?.tokens ?? 0,
    scope: entry.scope,
  }));

  return (
    <>
      <section className="afs-card afs-card-lead">
        <h2>
          세로선 비교
          <small className="afs-num">
            매체 {proto.outletCount}곳 · 기사 {proto.articleCount}건
          </small>
        </h2>
        <div className="afs-in">
          <VerticalCompare rows={rows} />
        </div>
      </section>

      <section className="afs-card">
        <h2>
          누구를 인용했나
          <small className="afs-num">인용원 {proto.sourceCount}명</small>
        </h2>
        <div className="afs-in">
          <SourcingTable rows={sourcingRows} />
        </div>
      </section>

      <section className="afs-card">
        <h2>어떤 말로 실었나</h2>
        <div className="afs-in">
          <VoiceTable rows={proto.voices} />
        </div>
      </section>

      <section className="afs-card">
        <h2>
          형태소 분석
          <small className="afs-num">내용어 {proto.tokenCount}개</small>
        </h2>
        <div className="afs-in">
          <MorphologyTable rows={proto.morphology} />
        </div>
      </section>

      <section className="afs-card">
        <h2>기사 원문</h2>
        <div className="afs-in">
          <ArticleList rows={proto.evidence} />
        </div>
      </section>
    </>
  );
}
