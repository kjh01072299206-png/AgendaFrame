import InitialFiveExperience from "./initial-five";
import {
  getInitialFiveIssueBundle,
  getInitialFiveIssueBundleByRank,
  initialFiveManifest,
} from "../lib/initial-five/artifacts";

type HomeSearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function Home({ searchParams }: { searchParams: HomeSearchParams }) {
  const query = await searchParams;
  const requestedIssueId = typeof query.issue === "string" ? query.issue : null;
  const initialBundle =
    (requestedIssueId ? getInitialFiveIssueBundle(requestedIssueId) : null) ??
    getInitialFiveIssueBundleByRank(1);

  if (!initialBundle) {
    throw new Error("Initial-five public artifact is missing the first issue bundle.");
  }

  return <InitialFiveExperience manifest={initialFiveManifest} initialBundle={initialBundle} />;
}
