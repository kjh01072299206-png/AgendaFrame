import { deriveIssue } from "../../../../../lib/initial-five/derive";
import { AnalysisPageIntro, FramingSemanticPage } from "../../../semantic-analysis-pages";
import { loadIssueBundle } from "../load";

export const metadata = { title: "프레이밍 분석 | AgendaFrame" };

export default async function FramingPage({ params }: { params: Promise<{ issueId: string }> }) {
  const bundle = await loadIssueBundle(params);
  const issue = deriveIssue(bundle);
  return (
    <>
      <AnalysisPageIntro
        title="프레이밍 분석"
        description="예시 HTML의 프레임 4기능 순서를 따라, 실제 기사에서 관측된 문제 정의·원인 해석·책임 귀속·평가·해법과 취재원 배치를 근거 위치와 함께 읽습니다."
      />
      <FramingSemanticPage bundle={bundle} issue={issue} />
    </>
  );
}
