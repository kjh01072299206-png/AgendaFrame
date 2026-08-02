import InitialFiveExperience from "../../initial-five";

export default async function IssuePage({ params }: { params: Promise<{ issueId: string }> }) {
  const { issueId } = await params;
  return <InitialFiveExperience issueId={decodeURIComponent(issueId)} standalone />;
}
