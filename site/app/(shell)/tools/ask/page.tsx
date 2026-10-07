import { getActiveSnapshot } from "../../../../lib/active-snapshot";
import { AskPanel } from "./ask-panel";

export const metadata = { title: "AI 대화 | AgendaFrame" };

export const dynamic = "force-dynamic";

export default async function AskPage() {
  const active = await getActiveSnapshot();
  const issues = active.manifest.issues
    .slice()
    .sort((a, b) => a.rank - b.rank)
    .map((issue) => ({ issueId: issue.issueId, rank: issue.rank, title: issue.title, payloadKey: issue.payloadKey }));

  return (
    <>
      <header className="afs-head">
        <h1>AI 대화</h1>
        <p>의제를 선택하고 기사 내용과 보도의 차이를 물어보세요.</p>
      </header>
      <AskPanel issues={issues} />
    </>
  );
}
