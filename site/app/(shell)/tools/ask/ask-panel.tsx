"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import type { IssueAnalysisBundle } from "../../../../lib/initial-five/types";
import { ruleExamples, ruleGroundedAnswer } from "../../../../lib/initial-five/rule-answers.mjs";

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

/* 질문할 때 선택한 issueId를 API에 함께 보내므로 1위 의제에 고정되지 않는다.
   AI 번들이 아직 준비되지 않은 환경에서는 명시적인 규칙 기반 보조 답변을 표시한다. */
export function AskPanel({ issues }: { issues: Array<{ issueId: string; rank: number; title: string; payloadKey?: string }> }) {
  const [issueId, setIssueId] = useState(() => {
    if (typeof window !== "undefined") {
      const fromUrl = new URLSearchParams(window.location.search).get("issue");
      if (fromUrl && issues.some((issue) => issue.issueId === fromUrl)) return fromUrl;
    }
    return issues[0]?.issueId ?? "";
  });
  const [selectedBundle, setSelectedBundle] = useState<IssueAnalysisBundle | null>(null);
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const bundleCache = useRef(new Map<string, IssueAnalysisBundle>());
  const bundleRequest = useRef<AbortController | null>(null);

  useEffect(() => {
    const issue = issues.find((candidate) => candidate.issueId === issueId);
    if (!issue) return;
    const cached = bundleCache.current.get(issueId);
    if (cached) {
      setSelectedBundle(cached);
      return;
    }
    setSelectedBundle(null);
    bundleRequest.current?.abort();
    const controller = new AbortController();
    bundleRequest.current = controller;
    const endpoints = [
      `/api/initial-five/issues/${encodeURIComponent(issue.issueId)}`,
      issue.payloadKey ? `/initial-five/${issue.payloadKey}` : "",
    ].filter(Boolean);
    const load = async () => {
      for (const endpoint of endpoints) {
        try {
          const response = await fetch(endpoint, { signal: controller.signal, headers: { Accept: "application/json" } });
          if (!response.ok) continue;
          const candidate = await response.json() as IssueAnalysisBundle;
          if (candidate.issue?.issueId !== issue.issueId) continue;
          bundleCache.current.set(issueId, candidate);
          if (!controller.signal.aborted) setSelectedBundle(candidate);
          return;
        } catch {
          if (controller.signal.aborted) return;
        }
      }
      if (!controller.signal.aborted) setSelectedBundle(null);
    };
    void load();
    return () => controller.abort();
  }, [issueId, issues]);

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
        if (response.status !== 429 && selectedBundle) {
          setTurns((prev) => [...prev, { role: "ai", result: ruleGroundedAnswer(selectedBundle, normalized) as AskResult }]);
          setError("AI 근거 API를 사용할 수 없어 규칙 기반 보조 답변을 표시했습니다.");
          return;
        }
        throw new Error(
          payload.error === "rate_limited"
            ? "질문이 많습니다. 잠시 뒤 다시 시도해 주세요."
            : "근거 답변을 불러오지 못했습니다.",
        );
      }
      setTurns((prev) => [...prev, { role: "ai", result: payload }]);
    } catch (cause) {
      if (selectedBundle) {
        setTurns((prev) => [...prev, { role: "ai", result: ruleGroundedAnswer(selectedBundle, normalized) as AskResult }]);
        setError("AI 근거 API에 연결하지 못해 규칙 기반 보조 답변을 표시했습니다.");
      } else {
        setError(cause instanceof Error ? cause.message : "근거 답변을 불러오지 못했습니다.");
      }
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
              const url = new URL(window.location.href);
              url.searchParams.set("issue", event.target.value);
              window.history.replaceState({ issueId: event.target.value }, "", `${url.pathname}?${url.searchParams.toString()}${url.hash}`);
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
                    <small className="afs-answer-provider">
                      {turn.result.provider === "rules_initial_five_v1" ? "규칙 기반 보조 답변" : "AI 본문 근거 답변"}
                    </small>
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
        <section className="afs-card afs-rule-example-card">
          <h2>선택한 의제 예시</h2>
          <div className="afs-in">
            {selectedBundle ? (
              <div className="afs-rule-examples">
                <p className="afs-example-note">규칙 기반 미리보기입니다. 질문을 누르면 선택한 의제의 AI 근거 API로 전송됩니다.</p>
                {ruleExamples(selectedBundle).map((example) => (
                  <article key={example.question}>
                    <button type="button" className="afs-example-question" onClick={() => void ask(undefined, example.question)} disabled={loading}>
                      {example.question}
                    </button>
                    <p>{example.result.answer}</p>
                  </article>
                ))}
              </div>
            ) : (
              <p className="afs-hold">선택한 의제의 공개 분석 번들을 불러오는 중입니다.</p>
            )}
          </div>
        </section>
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
