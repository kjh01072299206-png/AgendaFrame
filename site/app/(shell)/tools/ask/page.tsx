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
        <span className="afs-eyebrow">AI 대화</span>
        <h1>분석에 없는 답은 하지 않습니다</h1>
        <p>
          질문에 답할 때 이 도구는 기사 본문에서 뽑아 둔 설명 요소와 근거 위치만 씁니다. 답변마다 어떤 기사의 어느 문단을 근거로
          삼았는지 함께 표시됩니다.
        </p>
      </header>
      <AskPanel issues={issues} />
    </>
  );
}
