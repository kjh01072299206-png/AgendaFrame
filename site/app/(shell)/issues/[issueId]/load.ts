import { notFound } from "next/navigation";
import { getInitialFiveIssueBundle } from "../../../../lib/initial-five/artifacts";
import { deriveIssue, safeDecode, type IssueView } from "../../../../lib/initial-five/derive";

export async function loadIssue(params: Promise<{ issueId: string }>): Promise<IssueView> {
  const { issueId } = await params;
  const bundle = getInitialFiveIssueBundle(safeDecode(issueId));
  if (!bundle) notFound();
  return deriveIssue(bundle);
}
