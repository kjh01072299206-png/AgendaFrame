import { ReaderTypeQuiz } from "./reader-type";

export const metadata = { title: "내 읽기 유형 | AgendaFrame" };

/* 네 축 설명은 검사 전이 아니라 결과 뒤에 둔다 — 먼저 보여 주면 무엇을 재는지 알고 답하게 되고,
   답을 고르는 동안에는 어차피 읽지 않는다. reader-type.tsx 의 결과 화면에서 같은 내용을 낸다. */
export default function SelfCheckPage() {
  return (
    <>
      <header className="afs-head">
        <span className="afs-eyebrow">12문항 · 약 2분</span>
        <h1>내 읽기 습관은 어떤 유형일까?</h1>
        <p>
          프레이밍은 기사에만 있는 것이 아닙니다. 읽는 쪽에도 습관이 있습니다. 맞고 틀림을 매기지 않고, 무엇을 놓치기 쉬운지와
          이 사이트에서 무엇부터 볼지를 알려 줍니다.
        </p>
      </header>

      <ReaderTypeQuiz />
    </>
  );
}
