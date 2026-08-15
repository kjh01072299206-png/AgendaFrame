import { getInitialFiveIssueBundle } from "../../../../lib/initial-five/artifacts";
import { safeDecode } from "../../../../lib/initial-five/derive";
import { protoIssue } from "../../../../lib/proto";
import { SynthesisNarrative } from "../../semantic-analysis-pages";
import { AgreedFacts, Camps, Glossary, Keywords, SplitTable, Timeline } from "../../proto-parts";
import { LiveIssueView } from "./live-issue";
import { loadIssue, loadIssueBundle } from "./load";

/* 무슨 일이었나. 사실 → 보도 흐름 → 같게 쓴 것 → 갈린 것 순서로만 간다.
   방법론·유의사항은 방법론 화면에 한 번만 둔다. */
export default async function IssueOverviewPage({ params }: { params: Promise<{ issueId: string }> }) {
  const { issueId } = await params;
  const decoded = safeDecode(issueId);
  if (!getInitialFiveIssueBundle(decoded)) return <LiveIssueView issueId={decoded} view="overview" />;
  const issue = await loadIssue(Promise.resolve({ issueId }));
  const bundle = await loadIssueBundle(Promise.resolve({ issueId }));
  const proto = protoIssue(issue.issueId);
  if (!proto) {
    return (
      <>
        <SynthesisNarrative bundle={bundle} />
        <section className="afs-card">
          <h2>보도 흐름</h2>
          <div className="afs-in">
            <Timeline articles={issue.articles} />
          </div>
        </section>
      </>
    );
  }

  return (
    <>
      <SynthesisNarrative bundle={bundle} />
      <section className="afs-card afs-card-lead">
        <h2>무슨 일이었나</h2>
        <div className="afs-in afs-prose">
          <p>{proto.whatHappened}</p>
          <Keywords terms={proto.topTerms} />
        </div>
      </section>

      <div className="afs-grid-2">
        <section className="afs-card">
          <h2>보도 흐름</h2>
          <div className="afs-in">
            <Timeline articles={issue.articles} />
          </div>
        </section>

        <section className="afs-card">
          <h2>모든 기사가 같게 쓴 것</h2>
          <div className="afs-in">
            <AgreedFacts rows={proto.factRows} />
          </div>
        </section>
      </div>

      <section className="afs-card">
        <h2>매체가 갈린 지점</h2>
        <div className="afs-in">
          <Camps camps={proto.camps} />
          <SplitTable issue={proto} />
        </div>
      </section>

      {proto.terms.length ? (
        <section className="afs-card">
          <h2>낱말 풀이</h2>
          <div className="afs-in">
            <Glossary terms={proto.terms} />
          </div>
        </section>
      ) : null}
    </>
  );
}
