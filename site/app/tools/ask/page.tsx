"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import type { InitialFiveManifest } from "../../../lib/initial-five/types";
import SiteHeader from "../../site-header";

type AskEvidence = {
  articleId: string;
  source: string;
  sourceUrl: string;
  title: string;
  evidenceLocator: string | null;
  evidenceHash: string | null;
};

type AskResult = {
  status: "answered" | "withheld";
  answer: string;
  evidence: AskEvidence[];
  limitations: string[];
  provider: string;
};

const suggestions = [
  "매체별 설명이 갈린 지점은 무엇인가요?",
  "기사에 등장한 취재원과 화자는 누구인가요?",
  "책임 귀속을 어떻게 다르게 설명했나요?",
];

export default function AskToolPage() {
  const [manifest, setManifest] = useState<InitialFiveManifest | null>(null);
  const [issueId, setIssueId] = useState("");
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<AskResult | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const loadManifest = async () => {
      for (const endpoint of ["/api/initial-five", "/initial-five/manifest.json"]) {
        const response = await fetch(endpoint, { signal: controller.signal, headers: { Accept: "application/json" } });
        if (response.ok) return response.json() as Promise<InitialFiveManifest>;
      }
      throw new Error("초기 5개 의제를 불러오지 못했습니다.");
    };
    loadManifest()
      .then((data) => {
        setManifest(data);
        setIssueId(data.issues[0]?.issueId ?? "");
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "초기 5개 의제를 불러오지 못했습니다.");
      });
    return () => controller.abort();
  }, []);

  const ask = async (event?: FormEvent<HTMLFormElement>, suggestedQuestion = question) => {
    event?.preventDefault();
    const normalized = suggestedQuestion.trim();
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
      const payload = await response.json() as AskResult & { error?: string };
      if (!response.ok) throw new Error(payload.error === "rate_limited" ? "질문 요청이 많습니다. 잠시 뒤 다시 시도해 주세요." : "근거 답변을 불러오지 못했습니다.");
      setResult(payload);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "근거 답변을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="af-page af-tool-page">
      <SiteHeader active="tools" />
      <div className="af-tool-shell">
        <Link className="af-back-link" href="/tools">← 도구로 돌아가기</Link>
        <header className="af-tool-intro"><span className="af-section-label">AI 분석에서 묻기</span><h1>근거가 있는 범위에서만 답합니다.</h1><p>초기 5개 의제의 성공한 Claude 본문 분석에서 공개 paraphrase와 근거 위치를 찾아 답합니다. 새 사실을 추측하지 않습니다.</p></header>
        <div className="af-chip-row" aria-label="추천 질문">{suggestions.map((item) => <button type="button" key={item} onClick={() => void ask(undefined, item)} disabled={!issueId || loading}>{item}</button>)}</div>
        <form className="af-tool-form" onSubmit={ask}>
          <label>의제<select value={issueId} onChange={(event) => { setIssueId(event.target.value); setResult(null); }} disabled={!manifest}>{manifest?.issues.map((issue) => <option value={issue.issueId} key={issue.issueId}>{issue.rank}. {issue.title}</option>)}</select></label>
          <label>질문<textarea value={question} maxLength={500} onChange={(event) => setQuestion(event.target.value)} placeholder="예: 이 의제에서 직접 인용된 취재원은 누구인가요?" rows={4} /></label>
          <button className="af-primary-button" type="submit" disabled={!issueId || !question.trim() || loading}>{loading ? "근거 찾는 중…" : "근거에서 답 찾기"}</button>
        </form>
        {error && <div className="af-error-state" role="alert"><strong>답변을 가져오지 못했습니다.</strong><span>{error}</span></div>}
        {result && <section className={result.status === "answered" ? "af-ai-banner" : "af-hold-banner"} aria-live="polite"><div><span className="af-section-label">{result.status === "answered" ? "근거 연결 답변" : "답변 보류"}</span><h3>{result.answer}</h3><p>{result.limitations.join(" ")}</p></div></section>}
        {result?.evidence.length ? <div className="af-evidence-list">{result.evidence.map((item) => <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer" key={`${item.articleId}-${item.evidenceHash ?? "evidence"}`}><span>{item.source}</span><strong>{item.title}</strong><small>{item.evidenceLocator ?? "근거 위치 미기록"}{item.evidenceHash ? ` · ${item.evidenceHash.slice(0, 12)}…` : ""}<br />원문 열기</small></a>)}</div> : null}
        {issueId && <p className="af-form-message"><Link href={`/issues/${encodeURIComponent(issueId)}?view=evidence`}>선택 의제의 근거 기사 전체 보기</Link></p>}
      </div>
    </main>
  );
}
