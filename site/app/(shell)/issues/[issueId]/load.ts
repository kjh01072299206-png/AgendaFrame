import { notFound } from "next/navigation";
import { getActiveSnapshot } from "../../../../lib/active-snapshot";
import { getInitialFiveIssueBundle } from "../../../../lib/initial-five/artifacts";
import { withEventSynthesis } from "../../../../lib/initial-five/compose-synthesis.mjs";
import { deriveIssue, safeDecode, type IssueView } from "../../../../lib/initial-five/derive";
import type { IssueAnalysisBundle } from "../../../../lib/initial-five/types";

export async function loadIssueBundle(params: Promise<{ issueId: string }>): Promise<IssueAnalysisBundle> {
  const { issueId } = await params;
  const decodedIssueId = safeDecode(issueId);
  const active = await getActiveSnapshot();
  const bundle = active.getIssueBundle(decodedIssueId)
    ?? (active.mode === "demo" ? withEventSynthesis(getInitialFiveIssueBundle(decodedIssueId)) : null);
  if (!bundle) notFound();
  return bundle;
}

export async function loadIssue(params: Promise<{ issueId: string }>): Promise<IssueView> {
  return deriveIssue(await loadIssueBundle(params));
}
