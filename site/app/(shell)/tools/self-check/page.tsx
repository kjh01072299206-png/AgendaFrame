import { ReaderTypeQuiz } from "./reader-type";

export const metadata = { title: "읽기 유형 자가점검 | AgendaFrame" };

const AXIS_INTRO = [
  { code: "H / B", label: "제목형 · 본문형", says: "무엇을 근거로 판단하는가" },
  { code: "M / D", label: "뭉침형 · 가름형", says: "인용과 기자 서술을 나눠 읽는가" },
  { code: "O / C", label: "단독형 · 교차형", says: "한 매체로 끝내는가, 견주는가" },
  { code: "R / P", label: "결론형 · 과정형", says: "결론을 원하는가, 구도를 원하는가" },
];

export default function SelfCheckPage() {
  return (
    <>
      <header className="afs-head">
        <span className="afs-eyebrow">자가점검</span>
        <h1>내 읽기 습관은 어느 쪽으로 기울어 있나</h1>
        <p>
          프레이밍은 기사에만 있는 것이 아닙니다. 읽는 쪽에도 습관이 있습니다. 네 가지 축으로 그 습관을 재고, 무엇을 놓치기
          쉬운지와 이 사이트에서 무엇부터 볼지를 알려 줍니다.
        </p>
      </header>

      <section className="afs-card">
        <h2>네 가지 축</h2>
        <div className="afs-in">
          <div className="afs-cards">
            {AXIS_INTRO.map((axis) => (
              <article className="afs-mini" key={axis.code}>
                <h3>
                  <span className="afs-chip afs-chip-brand afs-num">{axis.code}</span> {axis.label}
                </h3>
                <p>{axis.says}</p>
              </article>
            ))}
          </div>
        </div>
        <p className="afs-foot">
          축마다 문항이 세 개라 무승부가 없습니다. 많이 고른 쪽이 그 축의 글자가 되고, 네 글자가 모여 유형이 됩니다.
        </p>
      </section>

      <ReaderTypeQuiz />
    </>
  );
}
