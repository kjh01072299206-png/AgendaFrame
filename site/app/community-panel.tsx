"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

type Comment = { id: string; parentId: string | null; displayName: string; body: string; createdAt: number; status: string };

function sessionId() {
  if (typeof window === "undefined") return "";
  const key = "agendaframe-community-session";
  const current = window.localStorage.getItem(key);
  if (current) return current;
  const created = crypto.randomUUID();
  window.localStorage.setItem(key, created);
  return created;
}

export function CommunityPanel({ issueId }: { issueId: string }) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [body, setBody] = useState("");
  const [displayName, setDisplayName] = useState("익명 독자");
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const load = useCallback(async () => {
    try { const response = await fetch(`/api/issues/${encodeURIComponent(issueId)}/community`, { cache: "no-store" }); const payload = await response.json(); if (response.ok) setComments(payload.comments ?? []); else setNotice(payload?.error?.message ?? "댓글을 불러오지 못했습니다."); } catch { setNotice("댓글을 불러오지 못했습니다."); }
  }, [issueId]);
  // The fetch is an external synchronization for the selected issue.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (!body.trim() || loading) return; setLoading(true); setNotice("");
    try { const response = await fetch(`/api/issues/${encodeURIComponent(issueId)}/community`, { method: "POST", headers: { "content-type": "application/json", "x-af-session": sessionId() }, body: JSON.stringify({ body, displayName }) }); const payload = await response.json(); if (!response.ok) throw new Error(payload?.error?.message ?? "댓글을 등록하지 못했습니다."); setComments((current) => [...current, payload.comment]); setBody(""); } catch (error) { setNotice(error instanceof Error ? error.message : "댓글을 등록하지 못했습니다."); } finally { setLoading(false); }
  };
  const report = async (id: string) => { try { const response = await fetch(`/api/comments/${encodeURIComponent(id)}/report`, { method: "POST", headers: { "content-type": "application/json", "x-af-session": sessionId() }, body: JSON.stringify({}) }); const payload = await response.json(); setNotice(response.ok ? "신고가 접수되었습니다. 검토 후 조치합니다." : payload?.error?.message ?? "신고를 접수하지 못했습니다."); } catch { setNotice("신고를 접수하지 못했습니다."); } };
  return (
    <section className="trust-card community-panel" aria-labelledby="community-title">
      <div className="trust-card-heading"><div><p className="context-label">독자 참여</p><h3 id="community-title">근거를 읽고 의견 나누기</h3><p>사람을 공격하지 않고 기사와 근거에 대해 의견을 남겨 주세요. 신고된 댓글은 운영 검토 대상이 됩니다.</p></div></div>
      <div className="community-comments">{comments.length ? comments.map((comment) => <article key={comment.id}><div><strong>{comment.displayName}</strong><time dateTime={new Date(comment.createdAt).toISOString()}>{new Date(comment.createdAt).toLocaleString("ko-KR")}</time></div><p>{comment.body}</p><button type="button" onClick={() => void report(comment.id)}>신고</button></article>) : <p className="withheld">아직 공개 댓글이 없습니다.</p>}</div>
      <form className="community-form" onSubmit={submit}><div><label>표시 이름<input maxLength={40} value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label><label>의견<textarea maxLength={1000} value={body} onChange={(event) => setBody(event.target.value)} placeholder="근거 문장이나 비교 결과에 대한 의견을 남겨 주세요." /></label></div><button type="submit" disabled={loading || !body.trim()}>{loading ? "등록 중…" : "댓글 등록"}</button></form>
      {notice && <p className="trust-notice" role="status">{notice}</p>}
    </section>
  );
}
