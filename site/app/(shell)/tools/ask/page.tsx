import { initialFiveManifest } from "../../../../lib/initial-five/artifacts";
import { AskPanel } from "./ask-panel";

export const metadata = { title: "AI 대화 | AgendaFrame" };

export default function AskPage() {
  const issues = initialFiveManifest.issues
    .slice()
    .sort((a, b) => a.rank - b.rank)
    .map((issue) => ({ issueId: issue.issueId, rank: issue.rank, title: issue.title }));

  return (
    <>
      <header className="afs-head">
        <h1>분석에 없는 답은 하지 않습니다</h1>
        <p>답변은 생성이 아니라 검색입니다. 근거를 못 찾으면 지어내는 대신 보류합니다.</p>
      </header>
      <AskPanel issues={issues} />
    </>
  );
}
