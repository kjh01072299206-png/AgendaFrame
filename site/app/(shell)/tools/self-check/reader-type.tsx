"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { clearLocal, useLocal, writeLocal } from "../../client-store";
import { communityFetch } from "../../community-session";

/* 네 축으로 읽기 습관을 가른다. 각 축의 세 문항 중 많이 고른 쪽이 그 축의 글자가 된다
   (문항이 홀수라 무승부가 없다). 16유형은 아래 TYPES 에 전부 적어 둔다. */

const AXES = [
  { id: "focus", a: "H", b: "B", aLabel: "제목형", bLabel: "본문형", question: "무엇을 근거로 판단하나" },
  { id: "voice", a: "M", b: "D", aLabel: "뭉침형", bLabel: "가름형", question: "인용과 서술을 나눠 읽나" },
  { id: "range", a: "O", b: "C", aLabel: "단독형", bLabel: "교차형", question: "몇 개 매체를 보나" },
  { id: "aim", a: "R", b: "P", aLabel: "결론형", bLabel: "과정형", question: "결론을 원하나 구도를 원하나" },
] as const;

type AxisId = (typeof AXES)[number]["id"];

const QUESTIONS: Array<{ axis: AxisId; text: string; a: string; b: string }> = [
  { axis: "focus", text: "기사를 열었을 때 나는", a: "제목과 첫 문단으로 대체를 파악한다", b: "본문을 끝까지 읽고 판단한다" },
  { axis: "focus", text: "같은 사건인데 제목이 서로 다르면", a: "제목 차이로 매체 성향을 짐작한다", b: "본문에서 무엇이 다른지 확인한다" },
  { axis: "focus", text: "시간이 없을 때 나는", a: "제목 여러 개를 훑는다", b: "한 기사를 제대로 읽는다" },
  { axis: "voice", text: "‘A씨는 ~라고 말했다’를 보면", a: "기사의 주장과 함께 읽는다", b: "취재원의 말과 기자의 문장을 따로 본다" },
  { axis: "voice", text: "익명 관계자 인용을 보면", a: "말의 내용에 집중한다", b: "누가 말했는지 확인할 수 없다는 점을 먼저 본다" },
  { axis: "voice", text: "기사를 다 읽고 기억에 남는 것은", a: "사건의 결론", b: "누가 무엇을 말했는지" },
  { axis: "range", text: "큰 사건이 터지면", a: "평소 보는 매체에서 확인한다", b: "성향이 다른 매체를 하나 더 찾아본다" },
  { axis: "range", text: "기사가 어딘가 이상하다고 느끼면", a: "그 기사를 다시 읽는다", b: "다른 매체가 어떻게 썼는지 찾는다" },
  { axis: "range", text: "뉴스를 볼 때 나는", a: "익숙한 매체를 먼저 연다", b: "같은 사건의 여러 매체를 나란히 연다" },
  { axis: "aim", text: "기사에서 가장 알고 싶은 것은", a: "결국 누가 맞느냐", b: "무엇이 쟁점이냐" },
  { axis: "aim", text: "논쟁적인 사안에서 나는", a: "내 판단을 정하고 싶다", b: "판단을 미루고 구도를 먼저 보고 싶다" },
  { axis: "aim", text: "후속 보도를 볼 때", a: "결과가 나왔는지 확인한다", b: "설명이 어떻게 바뀌었는지 본다" },
];

export interface ReaderType {
  code: string;
  name: string;
  line: string;
  strength: string;
  blind: string;
  todo: string;
}

export const TYPES: Record<string, ReaderType> = {
  BDCP: {
    code: "BDCP",
    name: "정밀 대조가",
    line: "본문을 끝까지 읽고, 인용을 갈라 보고, 여러 매체를 견주며 구도를 먼저 세웁니다.",
    strength: "설명이 갈리는 지점을 스스로 찾아냅니다. 프레이밍 비교가 가장 잘 맞는 유형입니다.",
    blind: "구도만 보다 판단을 계속 미룰 수 있습니다. 근거가 충분한 지점에서는 결론을 내려도 됩니다.",
    todo: "층위별 갈림 표에서 대표 계열이 3종 이상인 사안을 골라 보세요.",
  },
  BDCR: {
    code: "BDCR",
    name: "근거 판정가",
    line: "본문과 인용을 꼼꼼히 나눠 읽고 여러 매체를 확인한 뒤, 결론을 냅니다.",
    strength: "근거의 무게를 재서 판단합니다. 판단이 빠르면서도 잘 흔들리지 않습니다.",
    blind: "결론이 먼저 서면 반대 근거를 가볍게 넘길 수 있습니다.",
    todo: "리포트의 ‘이렇게 읽어 보세요’에서 반대편 설명부터 읽어 보세요.",
  },
  BDOP: {
    code: "BDOP",
    name: "본문 해부가",
    line: "한 기사를 깊이 파고들며 누가 말했는지를 정확히 가려냅니다.",
    strength: "한 기사 안의 서술 구조를 정확히 봅니다. 취재원 분석에 강합니다.",
    blind: "그 기사에 없는 설명은 존재를 모릅니다. 한 매체의 시야가 곧 내 시야가 됩니다.",
    todo: "언론사 비교의 쟁점 축에서, 내가 읽은 매체가 어느 쪽에 있었는지 확인해 보세요.",
  },
  BDOR: {
    code: "BDOR",
    name: "단일 심층가",
    line: "한 기사를 제대로 읽고 인용을 가려낸 뒤 결론까지 갑니다.",
    strength: "짧은 시간에 근거 있는 판단에 도달합니다.",
    blind: "그 한 기사의 프레임이 내 결론의 프레임이 됩니다.",
    todo: "같은 사안을 다른 매체 하나로 더 읽고, 문제 정의가 같은지 보세요.",
  },
  BMCP: {
    code: "BMCP",
    name: "서사 수집가",
    line: "여러 매체를 폭넓게 읽으며 이야기가 어떻게 흘러가는지를 봅니다.",
    strength: "사건의 전체 그림과 흐름을 잘 잡습니다.",
    blind: "인용과 기자 서술을 뭉쳐 읽으면, 취재원의 주장이 매체의 판단처럼 기억됩니다.",
    todo: "인용 방식 구성에서 기자 서술 비중이 높은 매체를 찾아 보세요.",
  },
  BMCR: {
    code: "BMCR",
    name: "종합 요약가",
    line: "여러 기사를 읽고 하나의 결론으로 정리합니다.",
    strength: "많은 정보를 빠르게 압축합니다. 남에게 설명을 잘합니다.",
    blind: "요약 과정에서 갈린 지점이 지워집니다. 차이가 정보인데 평균이 남습니다.",
    todo: "요약 대신, 갈린 층위 이름만 적어 보세요.",
  },
  BMOP: {
    code: "BMOP",
    name: "몰입 정독가",
    line: "한 기사에 오래 머물며 사건의 맥락을 따라갑니다.",
    strength: "맥락과 배경을 잘 기억합니다.",
    blind: "한 매체의 서술을 사실의 전부로 받아들이기 쉽습니다.",
    todo: "홈의 층위별 변별력을 보고, 이 사건에 비교할 것이 있는지부터 확인해 보세요.",
  },
  BMOR: {
    code: "BMOR",
    name: "신뢰 위임가",
    line: "믿는 매체의 기사를 끝까지 읽고 그 판단을 따릅니다.",
    strength: "정보의 일관성이 높고 혼란이 적습니다.",
    blind: "그 매체가 다루지 않은 쟁점은 존재하지 않는 것이 됩니다.",
    todo: "의제 × 매체 표에서 내가 보는 매체의 빈 칸을 찾아 보세요.",
  },
  HDCP: {
    code: "HDCP",
    name: "빠른 대조가",
    line: "제목을 여러 개 훑으면서도 인용은 가려 읽고, 구도를 먼저 봅니다.",
    strength: "짧은 시간에 쟁점 구도를 파악합니다.",
    blind: "제목에 없는 층위는 지나칩니다. 해법·처방은 제목에 거의 안 나옵니다.",
    todo: "프레이밍 분석에서 ‘해법·처방’ 층위만 따로 읽어 보세요.",
  },
  HDCR: {
    code: "HDCR",
    name: "쟁점 스캐너",
    line: "제목을 훑어 쟁점을 잡고, 인용을 가려 읽은 뒤 결론을 냅니다.",
    strength: "무엇이 논쟁인지 빠르게 알아냅니다.",
    blind: "제목은 편집의 결과입니다. 제목 차이가 본문 차이보다 클 때가 있습니다.",
    todo: "쟁점 축의 양 끝 설명이 실제로 본문에서 몇 건씩 관측됐는지 확인해 보세요.",
  },
  HDOP: {
    code: "HDOP",
    name: "요점 추적가",
    line: "익숙한 한 매체에서 제목과 요점을 확인하며 흐름을 따라갑니다.",
    strength: "적은 시간으로 사건을 놓치지 않습니다.",
    blind: "한 매체의 제목 편집이 내 인식의 틀이 됩니다.",
    todo: "이슈 탐색에서 갈린 층위가 많은 사안 하나만 골라 본문까지 읽어 보세요.",
  },
  HDOR: {
    code: "HDOR",
    name: "헤드라인 판정가",
    line: "제목으로 판단하고 결론을 빠르게 냅니다. 다만 인용은 구분해서 봅니다.",
    strength: "판단이 빠르고 결정을 미루지 않습니다.",
    blind: "제목과 본문의 프레임이 다를 때 이를 알아채기 어렵습니다.",
    todo: "한 사안에서 제목만 본 인상과 리포트의 쟁점 구도를 비교해 보세요.",
  },
  HMCP: {
    code: "HMCP",
    name: "흐름 관찰가",
    line: "여러 매체의 제목을 넓게 보며 분위기와 흐름을 읽습니다.",
    strength: "여론의 방향과 편집 관심의 이동을 잘 감지합니다.",
    blind: "인용을 뭉쳐 읽고 본문을 건너뛰면, 흐름은 알지만 근거는 남지 않습니다.",
    todo: "관측 상태 구성에서 ‘취재원 발언’ 비중이 높은 사안을 찾아 보세요.",
  },
  HMCR: {
    code: "HMCR",
    name: "여론 추종가",
    line: "많은 매체의 제목을 보고 다수의 방향으로 결론을 잡습니다.",
    strength: "사회적 반응을 빠르게 읽습니다.",
    blind: "제목 다수는 사실 다수가 아닙니다. 같은 통신 기사를 여러 매체가 실은 경우가 많습니다.",
    todo: "매체 확산도가 낮은 사안(소수 매체가 여러 건)을 찾아 보세요.",
  },
  HMOP: {
    code: "HMOP",
    name: "인상 독자",
    line: "한 매체의 제목을 보며 사건의 인상을 쌓아 갑니다.",
    strength: "정보 피로가 적고 오래 지치지 않습니다.",
    blind: "인상은 근거 없이도 굳습니다. 나중에 왜 그렇게 생각했는지 되짚기 어렵습니다.",
    todo: "AI 대화에서 ‘이 사안의 공통 사실은 무엇인가’를 물어 보세요.",
  },
  HMOR: {
    code: "HMOR",
    name: "직관 결론가",
    line: "익숙한 매체의 제목으로 빠르게 결론에 도달합니다.",
    strength: "결정이 빠르고 정보에 압도되지 않습니다.",
    blind: "가장 넓은 사각지대를 가진 조합입니다. 제목·단일 매체·즉시 결론이 겹칩니다.",
    todo: "사안 하나만 골라 리포트를 끝까지 읽어 보세요. 5분이면 됩니다.",
  },
};

export function ReaderTypeQuiz() {
  const savedAnswers = useLocal("afs-reader-answers");
  const [picks, setPicks] = useState<Array<"a" | "b" | null>>(() => {
    try {
      const parsed = JSON.parse(savedAnswers ?? "null");
      return Array.isArray(parsed) && parsed.length === QUESTIONS.length && parsed.every((answer) => answer === "a" || answer === "b") ? parsed : QUESTIONS.map(() => null);
    } catch {
      return QUESTIONS.map(() => null);
    }
  });
  const [syncState, setSyncState] = useState<"loading" | "saved" | "offline">("loading");
  const answered = picks.filter(Boolean).length;
  const done = answered === QUESTIONS.length;

  const scores = useMemo(() => {
    const map: Record<AxisId, { a: number; b: number }> = {
      focus: { a: 0, b: 0 },
      voice: { a: 0, b: 0 },
      range: { a: 0, b: 0 },
      aim: { a: 0, b: 0 },
    };
    picks.forEach((pick, index) => {
      if (!pick) return;
      map[QUESTIONS[index].axis][pick] += 1;
    });
    return map;
  }, [picks]);

  const code = AXES.map((axis) => (scores[axis.id].a >= scores[axis.id].b ? axis.a : axis.b)).join("");
  const result = done ? TYPES[code] : null;

  useEffect(() => {
    let cancelled = false;
    void communityFetch("/api/self-check", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json();
        if (cancelled || !response.ok || !payload.result?.answers) return;
        const answers = payload.result.answers as Array<"a" | "b">;
        if (answers.length === QUESTIONS.length && answers.every((answer) => answer === "a" || answer === "b")) {
          // The API is the durable source of truth; local storage only keeps the form usable offline.
          setPicks(answers);
          writeLocal("afs-reader-answers", JSON.stringify(answers));
          writeLocal("afs-reader-type", String(payload.result.typeCode));
          setSyncState("saved");
        }
      })
      .catch(() => { if (!cancelled) setSyncState("offline"); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!result) {
      clearLocal("afs-reader-type");
      return;
    }
    const answers = picks as Array<"a" | "b">;
    writeLocal("afs-reader-type", result.code);
    writeLocal("afs-reader-answers", JSON.stringify(answers));
    let cancelled = false;
    void communityFetch("/api/self-check", { method: "POST", body: JSON.stringify({ answers }) })
      .then(async (response) => {
        if (!cancelled) setSyncState(response.ok ? "saved" : "offline");
      })
      .catch(() => { if (!cancelled) setSyncState("offline"); });
    return () => { cancelled = true; };
  }, [picks, result]);

  return (
    <>
      <section className="afs-card">
        <h2>
          문항 {QUESTIONS.length}개
          <small className="afs-num">
            {answered}/{QUESTIONS.length}
          </small>
        </h2>
        <div className="afs-in">
          <p className="afs-note">
            맞고 틀림을 매기지 않습니다. 평소에 기사를 어떻게 읽는지 고르면, 네 가지 축에서 어디에 서 있는지 알려 줍니다.
          </p>
          <ol className="afs-quiz">
            {QUESTIONS.map((question, index) => (
              <li key={`q${index}`} className={picks[index] ? "done" : ""}>
                <p className="afs-quiz-q" id={`afs-q${index}`}>
                  <span className="afs-quiz-no afs-num">{index + 1}</span>
                  {question.text}
                </p>
                <div className="afs-quiz-opts" role="radiogroup" aria-labelledby={`afs-q${index}`}>
                  {(["a", "b"] as const).map((side) => (
                    <button
                      type="button"
                      key={side}
                      role="radio"
                      aria-checked={picks[index] === side}
                      onClick={() =>
                        setPicks((current) => current.map((value, i) => (i === index ? (value === side ? null : side) : value)))
                      }
                    >
                      {question[side]}
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {result ? (
        <section className="afs-card afs-result">
          <h2>
            내 읽기 유형
            <small>다시 고르면 즉시 바뀝니다</small>
          </h2>
          <div className="afs-in">
            <p className="afs-result-code afs-num">{result.code}</p>
            <h3 className="afs-result-name">{result.name}</h3>
            <p className="afs-result-line">{result.line}</p>

            <div className="afs-result-axes">
              {AXES.map((axis) => {
                const score = scores[axis.id];
                const leaning = score.a >= score.b;
                const perAxis = QUESTIONS.filter((q) => q.axis === axis.id).length;
                const pct = (Math.max(score.a, score.b) / Math.max(1, perAxis)) * 100;
                return (
                  <div className="afs-result-axis" key={axis.id}>
                    <p>
                      <b>{axis.question}</b>
                      <span>
                        {leaning ? axis.aLabel : axis.bLabel} {Math.max(score.a, score.b)}/{perAxis}
                      </span>
                    </p>
                    <div className="afs-result-bar">
                      <span className={leaning ? "l" : "r"} style={{ width: `${pct}%` }} />
                    </div>
                    <p className="afs-result-poles">
                      <span>{axis.aLabel}</span>
                      <span>{axis.bLabel}</span>
                    </p>
                  </div>
                );
              })}
            </div>

            <div className="afs-cards" style={{ marginTop: 16 }}>
              <article className="afs-mini">
                <h3>강점</h3>
                <p>{result.strength}</p>
              </article>
              <article className="afs-mini">
                <h3>놓치기 쉬운 것</h3>
                <p>{result.blind}</p>
              </article>
              <article className="afs-mini">
                <h3>이 사이트에서 해 볼 것</h3>
                <p>{result.todo}</p>
              </article>
            </div>

            <p style={{ marginTop: 16 }}>
              <Link className="afs-link" href="/tools/community">
                커뮤니티에서 같은 유형의 사람들이 어떻게 읽는지 보기 →
              </Link>
            </p>
          </div>
          <p className="afs-foot">
            {syncState === "saved" ? "자가점검 결과가 익명 세션에 저장되어 커뮤니티 배지에 사용됩니다." : syncState === "offline" ? "현재 저장소와 연결되지 않았습니다. 연결되면 자동으로 저장됩니다." : "자가점검 결과를 저장하는 중입니다."}
          </p>
        </section>
      ) : (
        <section className="afs-card">
          <h3>16개 유형</h3>
          <div className="afs-in">
            <p className="afs-note">
              네 축이 각각 두 갈래이므로 16가지가 나옵니다. 문항을 모두 고르면 내 유형이 위에 나타납니다.
            </p>
            <div className="afs-scroll">
              <table className="afs-table">
                <thead>
                  <tr>
                    <th scope="col">코드</th>
                    <th scope="col">이름</th>
                    <th scope="col">한 줄</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.values(TYPES).map((type) => (
                    <tr key={type.code}>
                      <th scope="row" className="afs-num">
                        {type.code}
                      </th>
                      <td>{type.name}</td>
                      <td>{type.line}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}
    </>
  );
}
