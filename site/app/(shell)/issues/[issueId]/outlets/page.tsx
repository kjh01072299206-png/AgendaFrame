import { deriveIssue } from "../../../../../lib/initial-five/derive";
import { OutletsSemanticPage, AnalysisPageIntro } from "../../../semantic-analysis-pages";
import { loadIssueBundle } from "../load";

export const metadata = { title: "언론사 비교 | AgendaFrame" };

export default async function OutletsPage({ params }: { params: Promise<{ issueId: string }> }) {
  const bundle = await loadIssueBundle(params);
  const issue = deriveIssue(bundle);
  return (
    <>
      <AnalysisPageIntro
        title="언론사 비교"
        description="같은 사건을 보도한 기사에서 문제·원인·책임·평가·해법과 취재원 배치가 어떻게 달랐는지, 기사 단위 semantic AI 근거로 비교합니다."
      />
      <OutletsSemanticPage bundle={bundle} issue={issue} />
    </>
  );
}
