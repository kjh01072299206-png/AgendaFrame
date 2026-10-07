import { SynthesisNarrative } from "../../semantic-analysis-pages";
import { Timeline } from "../../proto-parts";
import { loadIssue, loadIssueBundle } from "./load";
import { getEditorialReview } from "../../../../lib/editorial-review";
import { EditorialOverviewPage } from "../../editorial-analysis-pages";

/** The overview is intentionally derived from the same active snapshot as every sibling route. */
export default async function IssueOverviewPage({ params }: { params: Promise<{ issueId: string }> }) {
  const issue = await loadIssue(params);
  const bundle = await loadIssueBundle(params);
  const editorial = getEditorialReview(bundle.issue.issueId, bundle.basisDate);

  return (
    <>
      {editorial ? <EditorialOverviewPage issue={editorial} /> : <SynthesisNarrative bundle={bundle} />}
      <section className="afs-card">
        <h2>보도 흐름</h2>
        <div className="afs-in">
          <Timeline articles={issue.articles} />
        </div>
      </section>
    </>
  );
}
