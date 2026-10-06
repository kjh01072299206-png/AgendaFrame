import { notFound } from "next/navigation";
import { getActiveSnapshot } from "../../../../../lib/active-snapshot";
import { deriveIssue, safeDecode } from "../../../../../lib/initial-five/derive";
import { FramingSemanticPage } from "../../../semantic-analysis-pages";
import { EditorialFramingPage } from "../../../editorial-analysis-pages";
import { getEditorialReview } from "../../../../../lib/editorial-review";

export const metadata = { title: "프레이밍 분석 | AgendaFrame" };

export default async function FramingPage({ params }: { params: Promise<{ issueId: string }> }) {
  const { issueId } = await params;
  const decoded = safeDecode(issueId);
  const active = await getActiveSnapshot();
  const editorial = getEditorialReview(decoded, active.manifest.basisDate);
  const activeBundle = active.getIssueBundle(decoded);
  if (editorial && activeBundle) return <EditorialFramingPage issue={editorial} />;
  if (active.mode === "live") {
    if (!activeBundle) notFound();
    return <FramingSemanticPage bundle={activeBundle} issue={deriveIssue(activeBundle)} />;
  }
  if (!activeBundle) notFound();
  return <FramingSemanticPage bundle={activeBundle} issue={deriveIssue(activeBundle)} />;
}
