"use client";

import { useMemo, useState } from "react";

const prompts = [
  "이 설명은 기사에 직접 적힌 사실인가요, 취재원 발언인가요?",
  "제목과 본문에서 같은 표현과 다른 표현을 나눠 보았나요?",
  "반대되는 설명이나 다른 취재원의 목소리가 있는지 확인했나요?",
  "보도되지 않은 정보가 없다는 이유만으로 없다고 단정하지 않았나요?",
  "기사의 배열과 인용 위치가 읽는 방식에 영향을 주는지 살펴보았나요?",
];

export function SelfCheck() {
  const [checked, setChecked] = useState<boolean[]>(() => prompts.map(() => false));
  const completed = useMemo(() => checked.filter(Boolean).length, [checked]);
  return (
    <section className="af-checklist" aria-labelledby="self-check-title">
      <header><div><span className="af-section-label">읽기 도구</span><h2 id="self-check-title">읽기 전에 확인할 것</h2><p>정답을 매기는 검사가 아니라, 기사와 해석 사이를 잠시 확인하는 체크리스트입니다.</p></div><strong aria-label={`${completed}개 완료`}>{completed}/{prompts.length}</strong></header>
      <fieldset><legend className="sr-only">기사 읽기 자기점검 항목</legend>{prompts.map((prompt, index) => <label key={prompt}><input type="checkbox" checked={checked[index]} onChange={(event) => setChecked((current) => current.map((value, item) => item === index ? event.target.checked : value))} /><span>{prompt}</span></label>)}</fieldset>
      {completed === prompts.length && <p className="af-success-message" role="status">모든 항목을 확인했습니다. 이제 근거 기사와 함께 분석 결과를 살펴보세요.</p>}
    </section>
  );
}
