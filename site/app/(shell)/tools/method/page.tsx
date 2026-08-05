import { initialFiveManifest } from "../../../../lib/initial-five/artifacts";
import { proto } from "../../../../lib/proto";

export const metadata = { title: "방법론 | AgendaFrame" };

/* 일치율 파일의 층위 이름은 v2 프로필 스키마의 이름이라 화면 라벨과 다르다. */
const AGREEMENT_LABEL: Record<string, string> = {
  problem_definition: "무엇이 문제인가",
  causal_attribution: "왜 이렇게 됐나",
  responsibility_attribution: "누구 책임인가",
  evaluation: "어떻게 평가하나",
  treatment_recommendation: "어떻게 하자는가",
  actor_visibility: "누구 말을 실었나",
};

const pct = (value: number | null | undefined) => (typeof value === "number" ? `${Math.round(value * 100)}%` : "—");

/** 화면에 있는 여덟 층위와 각각의 출처. 어디 있는지도 함께 적는다. */
const LAYERS = [
  ["여섯 항목 규정", "Entman 1993", "프레이밍 분석"],
  ["요소 조합 군집", "Matthes & Kohring 2008", "프레이밍 분석"],
  ["정책 프레임", "Boydstun et al. 2014", "프레이밍 분석"],
  ["보편 프레임 다섯 종", "Semetko & Valkenburg 2000", "프레이밍 분석"],
  ["시야와 지칭어", "Iyengar 1991 · Gamson & Modigliani 1989", "프레이밍 분석"],
  ["의미 연결망", "문장 단위 동시출현", "프레이밍 분석"],
  ["인용원 구성", "역할 코드 집계", "언론사 비교"],
  ["형태소와 특징어", "kiwipiepy · 로그 비율", "언론사 비교"],
];

const MADE = [
  "2026년 7월 26일 기사 25건, 매체 9곳, 보도량 상위 5개 사안입니다.",
  "기사마다 독립 코더 두 명이 여섯 항목을 따로 라벨링하고, 다른 모델이 불일치 항목만 다시 보고 확정했습니다.",
  "확정 라벨은 근거 문장이 본문에 실재하는지 반박 검증을 거쳤습니다.",
  "형태소·연결망·군집은 모델 없이 계산합니다. 같은 데이터면 같은 결과가 나옵니다.",
  "본문에 붙어 있던 광고·추천기사 영역을 걷어냈습니다. 그대로 두면 광고의 낱말이 그 매체의 특징어로 잡힙니다.",
  "화면에는 의역·근거 문장 수·지칭어·원문 링크만 싣습니다. 원문 문장은 옮기지 않습니다.",
];

const LIMITS = [
  "하루치입니다. 프레임이 시간에 따라 어떻게 굳는지는 알 수 없습니다.",
  "‘무엇이 문제인가’의 코더 일치는 우연 보정 기준(κ)으로 0.636이며 통상 기준 0.67에 못 미칩니다.",
  "인용원 추출이 얇습니다. 기사당 중앙값 2명이고, 역할이 한 종류뿐인 기사가 25건 중 12건입니다.",
  "취재원의 발언은 그 매체의 입장과 다릅니다.",
  "관측되지 않은 항목은 기사에 없다는 뜻이지, 매체가 숨겼다는 뜻이 아닙니다.",
  "사실의 진위나 매체의 이념·성향은 판정하지 않습니다.",
];

export default function MethodPage() {
  const agreement = initialFiveManifest.coderAgreement;
  const perDimension = Object.entries(agreement?.summary.perDimensionAgreement ?? {});

  return (
    <>
      <header className="afs-head">
        <h1>무엇을 비교하고, 무엇을 말하지 않는가</h1>
        <p>화면의 모든 수치는 기사 본문의 특정 위치에 묶여 있습니다.</p>
      </header>

      <div className="afs-grid-2">
        <section className="afs-card">
          <h2>여덟 층위</h2>
          <div className="afs-in">
            <div className="afs-scroll">
              <table className="afs-table">
                <thead>
                  <tr>
                    <th scope="col">층위</th>
                    <th scope="col">출처</th>
                    <th scope="col">있는 화면</th>
                  </tr>
                </thead>
                <tbody>
                  {LAYERS.map(([name, cite, where]) => (
                    <tr key={name}>
                      <th scope="row">{name}</th>
                      <td>{cite}</td>
                      <td>{where}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section className="afs-card">
          <h2>
            층위별 변별력
            <small>다섯 사안 중 매체가 갈린 수</small>
          </h2>
          <div className="afs-in">
            <ul className="afs-verdict">
              {proto.summary.map((row) => (
                <li key={row.layer}>
                  <span>{row.layer.replace(/^\d+\s/, "")}</span>
                  <span className="afs-num">
                    {row.split}/{row.seen}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </div>

      {agreement ? (
        <section className="afs-card" id="일치율">
          <h2>
            두 코더가 얼마나 같게 판정했나
            <span className="afs-chip afs-chip-brand afs-num">{pct(agreement.summary.meanDimensionAgreement)}</span>
            <small>기사 {agreement.summary.articleCount}건 · 판정 전</small>
          </h2>
          <div className="afs-in">
            <div className="afs-scroll">
              <table className="afs-table">
                <thead>
                  <tr>
                    <th scope="col">층위</th>
                    <th scope="col">일치율</th>
                  </tr>
                </thead>
                <tbody>
                  {perDimension.map(([dimension, rate]) => (
                    <tr key={dimension}>
                      <th scope="row">{AGREEMENT_LABEL[dimension] ?? dimension}</th>
                      <td className="afs-num">{pct(rate)}</td>
                    </tr>
                  ))}
                  <tr>
                    <th scope="row">지배 정책 프레임</th>
                    <td className="afs-num">{pct(agreement.summary.dominantPolicyFrameAgreement)}</td>
                  </tr>
                  <tr>
                    <th scope="row">시야</th>
                    <td className="afs-num">{pct(agreement.summary.scopeAgreement)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
          <p className="afs-foot">코더는 사람이 아니라 프롬프트 각도가 다른 모델 코더입니다.</p>
        </section>
      ) : null}

      <div className="afs-grid-2">
        <section className="afs-card">
          <h2>만든 방법</h2>
          <div className="afs-in">
            <ul className="afs-bullets">
              {MADE.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        </section>

        <section className="afs-card">
          <h2>여기서 멈춥니다</h2>
          <div className="afs-in">
            <ul className="afs-bullets">
              {LIMITS.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        </section>
      </div>
    </>
  );
}
