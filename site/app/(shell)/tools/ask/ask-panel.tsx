"use client";

import { FormEvent, useRef, useState } from "react";

interface AskEvidence {
  articleId: string;
  source: string;
  sourceUrl: string;
  title: string;
  evidenceLocator: string | null;
  evidenceHash: string | null;
}

interface AskResult {
  status: "answered" | "withheld";
  answer: string;
  evidence: AskEvidence[];
  limitations: string[];
  provider: string;
}

type Turn = { role: "me"; text: string } | { role: "ai"; result: AskResult };

const SUGGESTIONS = [
  "기사에 등장한 취재원과 화자는 누구인가요?",
  "매체별 설명이 갈린 지점은 무엇인가요?",
  "책임 귀속을 어떻게 다르게 설명했나요?",
  "모든 매체가 같게 쓴 사실은 무엇인가요?",
];

/* 대화 화면. 답은 실행 시점에 /api/initial-five/ask 가 만든다 — 성공한 본문 분석의
   공개 의역과 근거 위치에서만 찾고, 없으면 보류한다. */
export function AskPanel({ issues }: { issues: Array<{ issueId: string; rank: number; title: string }> }) {
  const [issueId, setIssueId] = useState(issues[0]?.issueId ?? "");
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const ask = async (event?: FormEvent<HTMLFormElement>, asked = question) => {
    event?.preventDefault();
    const normalized = asked.trim();
    if (!issueId || !normalized || loading) return;
    setTurns((prev) => [...prev, { role: "me", text: normalized }]);
    setQuestion("");
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/initial-five/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ issueId, question: normalized }),
      });
      const payload = (await response.json()) as AskResult & { error?: string };
      if (!response.ok) {
        throw new Error(
          payload.error === "rate_limited"
            ? "질문이 많습니다. 잠시 뒤 다시 시도해 주세요."
            : "근거 답변을 불러오지 못했습니다.",
        );
      }
      setTurns((prev) => [...prev, { role: "ai", result: payload }]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "근거 답변을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
      requestAnimationFrame(() => endRef.current?.scrollIntoView({ block: "nearest" }));
    }
  };

  return (
    <div className="afs-grid-2">
      <section className="afs-card">
        <h2>
          대화
          <select
            className="afs-chat-issue"
            value={issueId}
            aria-label="의제"
            onChange={(event) => {
              setIssueId(event.target.value);
              setTurns([]);
              setError("");
            }}
          >
            {issues.map((issue) => (
              <option value={issue.issueId} key={issue.issueId}>
                {issue.rank}위 · {issue.title}
              </option>
            ))}
          </select>
        </h2>

        <div className="afs-chat">
          {turns.length ? (
            turns.map((turn, index) =>
              turn.role === "me" ? (
                <div className="afs-turn afs-turn-me" key={index}>
                  <p>{turn.text}</p>
                </div>
              ) : (
                <div className="afs-turn" key={index}>
                  <div>
                    {turn.result.answer.split("\n").map((line, i) =>
                      line.trim() ? <p key={i}>{line}</p> : null,
                    )}
                    {turn.result.evidence.length ? (
                      <div className="afs-cite-chips">
                        {turn.result.evidence.map((item) => (
                          <a
                            key={`${item.articleId}-${item.evidenceHash ?? "e"}`}
                            className="afs-chip"
                            href={item.sourceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={item.title}
                          >
                            {item.source}
                            {item.evidenceLocator ? <b className="afs-num">{item.evidenceLocator}</b> : null}
                          </a>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
              ),
            )
          ) : (
            <p className="afs-hold">아래 질문을 누르거나 직접 물어보세요.</p>
          )}
          {loading ? (
            <div className="afs-turn">
              <div>
                <p className="afs-hold">근거를 찾고 있습니다…</p>
              </div>
            </div>
          ) : null}
          <div ref={endRef} />
        </div>

        {error ? (
          <p className="afs-chat-err" role="alert">
            {error}
          </p>
        ) : null}

        <form className="afs-compose" onSubmit={ask}>
          <input
            type="text"
            value={question}
            maxLength={500}
            placeholder="이 의제에 대해 물어보세요"
            aria-label="질문"
            onChange={(event) => setQuestion(event.target.value)}
          />
          <button type="submit" disabled={!question.trim() || loading}>
            보내기
          </button>
        </form>
      </section>

      <div className="afs-grid">
        <section className="afs-card">
          <h2>추천 질문</h2>
          <div className="afs-in">
            <div className="afs-suggest">
              {SUGGESTIONS.map((item) => (
                <button type="button" className="afs-pill" key={item} onClick={() => void ask(undefined, item)} disabled={loading}>
                  {item}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="afs-card">
          <h2>답변 규칙</h2>
          <div className="afs-in">
            <ul className="afs-bullets">
              <li>수집된 기사 내용만으로 답합니다.</li>
              <li>근거가 없으면 답하지 않습니다.</li>
              <li>사실 여부·이념은 판정하지 않습니다.</li>
              <li>화자는 직위·소속까지만 나옵니다. 이름은 저장하지 않습니다.</li>
              <li>취재원의 발언은 그 매체의 입장과 다릅니다.</li>
            </ul>
          </div>
        </section>
      </div>
    </div>
  );
}
