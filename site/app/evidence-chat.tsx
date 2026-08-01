"use client";

import { FormEvent, useState } from "react";

type ChatEvidence = { claimId: string; source: string; sourceUrl: string; evidenceLocator?: string | null; evidenceHash?: string | null };
type ChatResult = { status: "answered" | "withheld"; answer: string; evidence: ChatEvidence[]; limitations: string[]; provider: string };

const suggested = ["매체들이 공통으로 보도한 내용은 무엇인가요?", "설명이 갈린 지점은 어디인가요?", "이 답변의 근거 기사를 보여주세요."];

export function EvidenceChat({ issueId }: { issueId: string }) {
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<ChatResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const ask = async (event?: FormEvent, requestedQuestion = question) => {
    event?.preventDefault();
    if (!requestedQuestion.trim() || loading) return;
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ issueId, question: requestedQuestion }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error?.message ?? "답변을 불러오지 못했습니다.");
      setResult(payload);
    } catch (cause) { setResult(null); setError(cause instanceof Error ? cause.message : "답변을 불러오지 못했습니다."); }
    finally { setLoading(false); }
  };
  return (
    <section className="trust-card evidence-chat" aria-labelledby="evidence-chat-title">
      <div className="trust-card-heading"><div><p className="context-label">근거 기반 질문</p><h3 id="evidence-chat-title">이 이슈에 질문하기</h3><p>저장된 비교 결과와 연결된 기사 근거 안에서만 답합니다.</p></div><span className="evidence-chat-badge">근거 범위 내 답변</span></div>
      <div className="chat-suggestions" aria-label="추천 질문">{suggested.map((item) => <button type="button" key={item} onClick={() => { setQuestion(item); void ask(undefined, item); }}>{item}</button>)}</div>
      <form onSubmit={ask} className="chat-form"><label htmlFor="evidence-question"><span className="sr-only">질문</span><input id="evidence-question" value={question} maxLength={500} onChange={(event) => setQuestion(event.target.value)} placeholder="예: 설명이 갈린 지점은 어디인가요?" /></label><button type="submit" disabled={loading || !question.trim()}>{loading ? "확인 중…" : "질문"}</button></form>
      {error && <p className="trust-error" role="alert">{error}</p>}
      {result && <div className={`chat-result ${result.status === "withheld" ? "withheld" : ""}`} role="status"><p className="chat-answer">{result.answer}</p>{result.evidence.length > 0 && <div className="chat-evidence"><strong>연결된 근거</strong><ul>{result.evidence.map((item, index) => <li key={`${item.claimId}-${index}`}><a href={item.sourceUrl} target="_blank" rel="noopener noreferrer">{item.source}</a><small>{item.evidenceLocator ?? "근거 위치 기록"}{item.evidenceHash ? ` · ${item.evidenceHash.slice(0, 12)}` : ""}</small></li>)}</ul></div>}<ul className="chat-limitations">{result.limitations.map((item) => <li key={item}>{item}</li>)}</ul></div>}
    </section>
  );
}
