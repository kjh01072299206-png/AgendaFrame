import { notFound } from "next/navigation";
import { getActiveSnapshot } from "../../../../../lib/active-snapshot";
import { deriveIssue, safeDecode } from "../../../../../lib/initial-five/derive";
import { FramingSemanticPage } from "../../../semantic-analysis-pages";

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
  if (!activeBundle) notFound();
  return <FramingSemanticPage bundle={activeBundle} issue={deriveIssue(activeBundle)} />;
}
