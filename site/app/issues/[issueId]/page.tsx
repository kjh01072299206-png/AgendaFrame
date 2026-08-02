import { notFound } from "next/navigation";
import {
  getInitialFiveIssueBundle,
  initialFiveManifest,
} from "../../../lib/initial-five/artifacts";
import { IssueDetailExperience } from "../../initial-five";

export function generateStaticParams() {
  return initialFiveManifest.issues.map((issue) => ({ issueId: issue.issueId }));
}

export default async function IssuePage({ params }: { params: Promise<{ issueId: string }> }) {
  const { issueId } = await params;
  const decodedIssueId = decodeURIComponent(issueId);
  const bundle = getInitialFiveIssueBundle(decodedIssueId);
  if (!bundle) notFound();
  return <IssueDetailExperience bundle={bundle} />;
}
