import { notFound } from "next/navigation";
import { getInitialFiveIssueBundle, initialFiveManifest } from "../../../../lib/initial-five/artifacts";
import { deriveIssue } from "../../../../lib/initial-five/derive";
import { IssueSubject } from "../../issue-subject";

export function generateStaticParams() {
  return initialFiveManifest.issues.map((issue) => ({ issueId: issue.issueId }));
}

export default async function IssueLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ issueId: string }>;
}) {
  const { issueId } = await params;
  const bundle = getInitialFiveIssueBundle(decodeURIComponent(issueId));
  if (!bundle) notFound();
  const issue = deriveIssue(bundle);

  return (
    <>
      <IssueSubject
        issueId={issue.issueId}
        rank={issue.rank}
        title={issue.title}
        lead={issue.lead}
        category={issue.category}
        articleCount={issue.articleCount}
        outletCount={issue.outletCount}
        evidenceCount={issue.evidenceTotal}
        splitDimensions={issue.splitDimensions}
      />
      {children}
    </>
  );
}
