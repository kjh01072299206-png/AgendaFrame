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
          질문에 답할 때 이 도구는 기사 본문에서 뽑아 둔 설명 요소와 근거 위치만 씁니다. 답변마다 어떤 기사의 어느 문단·문장을
          근거로 삼았는지 함께 표시됩니다.
        </p>
        <p>
          답변은 <b>생성이 아니라 검색</b>입니다. 질문을 받으면 이미 코딩된 항목에서 맞는 것을 골라 그대로 돌려주므로, 같은
          질문에 항상 같은 답이 오고 없는 사실을 만들지 않습니다. 근거를 못 찾으면 답을 지어내는 대신 <b>보류</b>합니다.
        </p>
      </header>
      <AskPanel issues={issues} />
    </>
  );
}
