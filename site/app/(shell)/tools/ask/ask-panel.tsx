"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";

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

const SUGGESTIONS = [
  "매체별 설명이 갈린 지점은 무엇인가요?",
  "기사에 등장한 취재원과 화자는 누구인가요?",
  "책임 귀속을 어떻게 다르게 설명했나요?",
  "모든 매체가 같게 쓴 사실은 무엇인가요?",
];

export function AskPanel({ issues }: { issues: Array<{ issueId: string; rank: number; title: string }> }) {
  const [issueId, setIssueId] = useState(issues[0]?.issueId ?? "");
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<AskResult | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const ask = async (event?: FormEvent<HTMLFormElement>, asked = question) => {
    event?.preventDefault();
    const normalized = asked.trim();
    if (!issueId || !normalized || loading) return;
    setQuestion(normalized);
    setLoading(true);
    setError("");
    setResult(null);
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
            ? "질문 요청이 많습니다. 잠시 뒤 다시 시도해 주세요."
            : "근거 답변을 불러오지 못했습니다.",
        );
      }
      setResult(payload);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "근거 답변을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <section className="afs-card">
        <h2>
          질문하기
          <small>근거가 있는 범위에서만 답합니다</small>
        </h2>
        <div className="afs-in">
          <div className="afs-suggest" aria-label="추천 질문">
            {SUGGESTIONS.map((item) => (
              <button type="button" className="afs-pill" key={item} onClick={() => void ask(undefined, item)} disabled={loading}>
                {item}
              </button>
            ))}
          </div>
          <form className="afs-askform" onSubmit={ask}>
            <label>
              의제
              <select value={issueId} onChange={(event) => { setIssueId(event.target.value); setResult(null); }}>
                {issues.map((issue) => (
                  <option value={issue.issueId} key={issue.issueId}>
                    {issue.rank}위 · {issue.title}
                  </option>
                ))}
              </select>
            </label>
            <label>
              질문
              <textarea
                value={question}
                maxLength={500}
                rows={3}
                onChange={(event) => setQuestion(event.target.value)}
                placeholder="예: 이 의제에서 직접 인용된 취재원은 누구인가요?"
              />
            </label>
            <button className="afs-submit" type="submit" disabled={!question.trim() || loading}>
              {loading ? "근거 찾는 중…" : "근거에서 답 찾기"}
            </button>
          </form>
        </div>
        <p className="afs-foot">
          새 사실을 만들지 않습니다. 분석이 성공한 기사의 공개 의역과 근거 위치에서만 답을 구성합니다.
        </p>
      </section>

      {error ? (
        <section className="afs-card afs-alert" role="alert">
          <h3>답변을 가져오지 못했습니다</h3>
          <div className="afs-in">
            <p>{error}</p>
          </div>
        </section>
      ) : null}

      {result ? (
        <section className="afs-card" aria-live="polite">
          <h2>
            {result.status === "answered" ? "근거 연결 답변" : "답변 보류"}
            <small>{result.provider}</small>
          </h2>
          <div className="afs-in afs-prose">
            <p style={{ fontSize: 15 }}>{result.answer}</p>
            {result.limitations.length ? (
              <p className="afs-note" style={{ marginTop: 12 }}>
                {result.limitations.join(" ")}
              </p>
            ) : null}
          </div>
          {result.evidence.length ? (
            <div className="afs-in" style={{ paddingTop: 0 }}>
              <h3 style={{ margin: "0 0 8px", fontSize: 13, fontWeight: 750 }}>근거 기사 {result.evidence.length}건</h3>
              <ul className="afs-cites">
                {result.evidence.map((item) => (
                  <li key={`${item.articleId}-${item.evidenceHash ?? "e"}`}>
                    <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer">
                      <span className="afs-chip afs-chip-brand">{item.source}</span>
                      <b>{item.title}</b>
                      <small>
                        {item.evidenceLocator ?? "근거 위치 미기록"}
                        {item.evidenceHash ? ` · ${item.evidenceHash.slice(0, 12)}…` : ""} · 원문 열기 ↗
                      </small>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <p className="afs-foot">
            <Link className="afs-link" href={`/issues/${encodeURIComponent(issueId)}`}>
              이 의제의 사안 개요로 이동
            </Link>
          </p>
        </section>
      ) : null}
    </>
  );
}
