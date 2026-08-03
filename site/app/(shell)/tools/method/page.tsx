import { DIM_LABEL, DIM_ORDER, DIM_QUESTION } from "../../../../lib/initial-five/derive";

export const metadata = { title: "방법론 | AgendaFrame" };

const SECTIONS = [
  {
    label: "범위",
    title: "하루치 상위 5개 의제",
    body: "2026년 7월 26일 표본에서 보도량 상위 5개 의제, 기사 25건을 비교합니다. 기사 수와 참여 매체는 이 표본 안의 관측값이며, 사안의 사회적 중요도나 사실성을 뜻하지 않습니다.",
  },
  {
    label: "무엇을 비교하나",
    title: "찬반이 아니라 설명의 구조",
    body: "같은 사건을 두고 무엇을 문제로 규정했는지부터 갈립니다. 그 다음에 원인·책임·평가·해법이 따라옵니다. 이 다섯 층위를 본문 근거로 나눠 매체를 견줍니다.",
  },
  {
    label: "코딩 절차",
    title: "두 번 코딩하고 판정합니다",
    body: "기사마다 두 개의 독립 코더가 서로 다른 순서로 라벨을 붙이고, 불일치한 층위만 판정 단계에서 다시 봅니다. 그 뒤 근거 문장이 본문에 실재하고 라벨을 실제로 지지하는지 반박 검증을 거칩니다.",
  },
  {
    label: "원문 처리",
    title: "본문 전문은 저장하지 않습니다",
    body: "화면에는 의역, 근거 위치(문단·문장), 비복원 지문, 원문 링크만 남습니다. 원문 문장을 그대로 옮기지 않습니다.",
  },
  {
    label: "‘미관측’의 뜻",
    title: "쓰지 않은 것과 그렇게 생각하지 않은 것은 다릅니다",
    body: "미관측은 분석 가능한 본문에서 그 설명을 찾지 못했다는 뜻입니다. 매체가 그 입장이 아니라는 근거는 아닙니다. 마찬가지로 취재원의 발언은 그 매체의 입장이 아닙니다.",
  },
  {
    label: "지금 확장 중인 것",
    title: "기간 데이터가 쌓이면 열리는 화면",
    body: "일별 보도량 추이, 매체별 보도량 비교, 프레임의 생애주기는 같은 의제를 여러 날 모아야 성립합니다. 하루치 표본에서는 계산하지 않습니다.",
  },
];

export default function MethodPage() {
  return (
    <>
      <header className="afs-head">
        <span className="afs-eyebrow">방법론</span>
        <h1>무엇을 비교하고, 무엇을 말하지 않는가</h1>
        <p>이 서비스가 화면에 올리는 모든 수치는 기사 본문의 특정 위치에 묶여 있습니다. 그 규칙을 여기 적어 둡니다.</p>
      </header>

      <section className="afs-card">
        <h2>다섯 층위</h2>
        <div className="afs-in">
          <div className="afs-scroll">
            <table className="afs-table">
              <thead>
                <tr>
                  <th scope="col">층위</th>
                  <th scope="col">묻는 것</th>
                </tr>
              </thead>
              <tbody>
                {DIM_ORDER.map((dim) => (
                  <tr key={dim}>
                    <th scope="row">{DIM_LABEL[dim]}</th>
                    <td>{DIM_QUESTION[dim]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <p className="afs-foot">
          Entman(1993)의 프레이밍 정의를 코딩 가능한 층위로 나눈 것입니다. 층위별 결과를 조합해 서사 묶음을 귀납적으로
          도출하는 방식은 Matthes &amp; Kohring(2008)을 따릅니다.
        </p>
      </section>

      <div className="afs-grid">
        {SECTIONS.map((section) => (
          <section className="afs-card" key={section.title}>
            <h3>
              {section.title}
              <small>{section.label}</small>
            </h3>
            <div className="afs-in afs-prose">
              <p>{section.body}</p>
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
