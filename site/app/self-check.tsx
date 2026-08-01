"use client";

import { useMemo, useState } from "react";

const prompts = [
  "이 설명을 사실 자체가 아니라 매체가 선택한 관점으로 읽었나요?",
  "제목의 인상과 본문에 연결된 근거를 구분했나요?",
  "반대되는 설명이나 다른 취재원의 목소리를 확인했나요?",
  "보도되지 않은 정보가 곧 존재하지 않는다는 뜻은 아니라는 점을 기억했나요?",
  "기사 수와 홈 배치가 중요도·진실성·여론을 뜻하지 않는다는 점을 확인했나요?",
];

export function SelfCheck() {
  const [checked, setChecked] = useState<boolean[]>(() => prompts.map(() => false));
  const completed = useMemo(() => checked.filter(Boolean).length, [checked]);
  return (
    <section className="trust-card self-check" aria-labelledby="self-check-title">
      <div className="trust-card-heading"><div><p className="context-label">읽기 전환 장치</p><h3 id="self-check-title">내 읽기 점검</h3><p>정답 점수가 아니라, 기사를 비교할 때 놓치기 쉬운 질문입니다.</p></div><strong>{completed}/{prompts.length}</strong></div>
      <ul>
        {prompts.map((prompt, index) => (
          <li key={prompt}><label><input type="checkbox" checked={checked[index]} onChange={(event) => setChecked((current) => current.map((value, item) => item === index ? event.target.checked : value))} /> <span>{prompt}</span></label></li>
        ))}
      </ul>
      {completed === prompts.length && <p className="trust-success" role="status">좋습니다. 이제 근거 위치와 원문을 함께 확인해 보세요.</p>}
    </section>
  );
}
