import { notFound } from "next/navigation";
import { getActiveSnapshot } from "../../../../../lib/active-snapshot";
import { getInitialFiveIssueBundle } from "../../../../../lib/initial-five/artifacts";
import { withEventSynthesis } from "../../../../../lib/initial-five/compose-synthesis.mjs";
import { deriveIssue, safeDecode } from "../../../../../lib/initial-five/derive";
import { FramingSemanticPage } from "../../../semantic-analysis-pages";
import { LiveIssueView } from "../live-issue";

export const metadata = { title: "프레이밍 분석 | AgendaFrame" };

export default async function FramingPage({ params }: { params: Promise<{ issueId: string }> }) {
  const { issueId } = await params;
  const decoded = safeDecode(issueId);
  const active = await getActiveSnapshot();
  const activeBundle = active.getIssueBundle(decoded);
  if (active.mode === "live") {
    if (!activeBundle) notFound();
    return <FramingSemanticPage bundle={activeBundle} issue={deriveIssue(activeBundle)} />;
  }
  const bundle = activeBundle ?? withEventSynthesis(getInitialFiveIssueBundle(decoded));
  if (bundle) {
    return <FramingSemanticPage bundle={bundle} issue={deriveIssue(bundle)} />;
  }
  return <LiveIssueView issueId={decoded} view="framing" />;
}
