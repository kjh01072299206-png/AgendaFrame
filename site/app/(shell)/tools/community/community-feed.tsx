"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useLocal } from "../../client-store";
import { communityFetch } from "../../community-session";
import { TYPES } from "../self-check/reader-type";

type Reply = { id: string; displayName: string; readerType: string | null; body: string; createdAt: number; reactionCount: number };
type Post = { id: string; issueId: string; issueTitle: string | null; issueRank: number | null; displayName: string; readerType: string | null; screen: string | null; body: string; reactionCount: number; reactedByMe: boolean; replyCount: number; createdAt: number; replies: Reply[] };
type Issue = { id: string; title: string; issueDate: string; agendaScore?: number };

const badge = (code: string | null) => {
  if (!code) return <span className="afs-chip">자가점검 전</span>;
  const type = TYPES[code];
  return <span className="afs-badge-type" title={type?.line ?? code}><b className="afs-num">{code}</b>{type?.name ?? "읽기 유형"}</span>;
};

function dateLabel(value: number) { return new Date(value).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" }); }

export function CommunityFeed() {
  const mine = useLocal("afs-reader-type");
  const [issues, setIssues] = useState<Issue[]>([]);
  const [selectedIssue, setSelectedIssue] = useState("");
  const [posts, setPosts] = useState<Post[]>([]);
  const [sort, setSort] = useState<"hot" | "new">("new");
  const [cursor, setCursor] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [displayName, setDisplayName] = useState("익명 독자");
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const mineType = useMemo(() => (mine && TYPES[mine] ? mine : null), [mine]);

  const loadIssues = useCallback(async () => {
    try {
      const response = await fetch("/api/issues?date=2026-07-26&limit=10", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error?.message ?? "의제를 불러오지 못했습니다.");
      const next = Array.isArray(payload.issues) ? payload.issues : [];
      setIssues(next); setSelectedIssue((current) => current || next[0]?.id || "");
    } catch (error) { setNotice(error instanceof Error ? error.message : "의제를 불러오지 못했습니다."); }
  }, []);

  const loadPosts = useCallback(async (nextSort = sort, nextCursor: string | null = null, append = false) => {
    try {
      const query = new URLSearchParams({ sort: nextSort, limit: "20" });
      if (nextCursor) query.set("cursor", nextCursor);
      const response = await communityFetch(`/api/community?${query.toString()}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error?.message ?? "커뮤니티 글을 불러오지 못했습니다.");
      setPosts((current) => append ? [...current, ...(payload.posts ?? [])] : (payload.posts ?? [])); setCursor(payload.nextCursor ?? null);
    } catch (error) { setNotice(error instanceof Error ? error.message : "커뮤니티 글을 불러오지 못했습니다."); }
  }, [sort]);

  // These effects synchronize the client with durable API state.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void loadIssues(); }, [loadIssues]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void loadPosts(sort); }, [loadPosts, sort]);

  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (!selectedIssue || !body.trim() || busy) return;
    setBusy(true); setNotice("");
    try {
      const response = await communityFetch("/api/community", { method: "POST", body: JSON.stringify({ issueId: selectedIssue, body, displayName, readerType: mineType, screen: "커뮤니티" }) });
      const payload = await response.json(); if (!response.ok) throw new Error(payload?.error?.message ?? "글을 등록하지 못했습니다.");
      setBody(""); setNotice(payload.notice ?? "글이 등록되었습니다."); await loadPosts(sort);
    } catch (error) { setNotice(error instanceof Error ? error.message : "글을 등록하지 못했습니다."); }
    finally { setBusy(false); }
  };

  const submitReply = async (post: Post) => {
    if (!replyBody.trim() || busy) return;
    setBusy(true); setNotice("");
    try {
      const response = await communityFetch(`/api/community/${encodeURIComponent(post.id)}/replies`, { method: "POST", body: JSON.stringify({ body: replyBody, displayName, readerType: mineType, screen: "커뮤니티 답글" }) });
      const payload = await response.json(); if (!response.ok) throw new Error(payload?.error?.message ?? "답글을 등록하지 못했습니다.");
      setReplyBody(""); setReplyingTo(null); setNotice(payload.notice ?? "답글이 등록되었습니다."); await loadPosts(sort);
    } catch (error) { setNotice(error instanceof Error ? error.message : "답글을 등록하지 못했습니다."); }
    finally { setBusy(false); }
  };

  const react = async (postId: string) => {
    try {
      const response = await communityFetch(`/api/community/${encodeURIComponent(postId)}/react`, { method: "POST" });
      const payload = await response.json(); if (!response.ok) throw new Error(payload?.error?.message ?? "공감을 처리하지 못했습니다.");
      setPosts((current) => current.map((post) => post.id === postId ? { ...post, reactedByMe: payload.reacted, reactionCount: payload.reactionCount } : post));
    } catch (error) { setNotice(error instanceof Error ? error.message : "공감을 처리하지 못했습니다."); }
  };

  const report = async (postId: string) => {
    try {
      const response = await communityFetch(`/api/community/${encodeURIComponent(postId)}/report`, { method: "POST", body: JSON.stringify({}) });
      const payload = await response.json(); setNotice(response.ok ? "신고가 접수되었습니다. 운영 검토 후 조치합니다." : payload?.error?.message ?? "신고를 접수하지 못했습니다.");
    } catch { setNotice("신고를 접수하지 못했습니다."); }
  };

  return (
    <>
      <section className="afs-card">
        <h2>글 쓰기 <small>근거를 본 의제와 함께 저장됩니다</small></h2>
        <div className="afs-in">
          <form className="afs-compose" onSubmit={submit}>
            <p className="afs-compose-who"><span className="afs-chip">{displayName || "익명 독자"}</span>{badge(mineType)}</p>
            <label>표시 이름<input maxLength={40} value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label>
            <label>의제<select value={selectedIssue} onChange={(event) => setSelectedIssue(event.target.value)} disabled={!issues.length}><option value="">의제를 선택하세요</option>{issues.map((issue) => <option key={issue.id} value={issue.id}>{issue.title}</option>)}</select></label>
            <label>글 내용<textarea id="afs-compose" rows={4} maxLength={1000} value={body} onChange={(event) => setBody(event.target.value)} placeholder="어느 분석 화면에서 무엇을 확인했는지 근거와 함께 적어 주세요." /></label>
            <div className="afs-compose-foot"><span>{mineType ? `${mineType} 유형이 글에 함께 표시됩니다.` : "자가점검을 완료하면 읽기 유형이 함께 표시됩니다."}</span><button type="submit" className="afs-pill" disabled={busy || !selectedIssue || !body.trim()}>{busy ? "등록 중…" : "올리기"}</button></div>
          </form>
        </div>
      </section>

      <section className="afs-card">
        <h2>최근 이야기 <small>{posts.length}개 표시</small></h2>
        <div className="afs-in">
          <div className="afs-sortbar"><button type="button" className="afs-pill" aria-pressed={sort === "hot"} onClick={() => setSort("hot")}>공감순</button><button type="button" className="afs-pill" aria-pressed={sort === "new"} onClick={() => setSort("new")}>최신순</button></div>
          {posts.length ? <ul className="afs-feed">{posts.map((post) => <li key={post.id}>
            <div className="afs-feed-head"><b>{post.displayName}</b>{badge(post.readerType)}{post.issueTitle && <Link className="afs-chip afs-chip-brand" href={`/issues/${encodeURIComponent(post.issueId)}`}>{post.issueRank ? `${post.issueRank}위 · ` : ""}{post.issueTitle}</Link>}<span className="afs-chip">{post.screen ?? "커뮤니티"}</span><time dateTime={new Date(post.createdAt).toISOString()}>{dateLabel(post.createdAt)}</time></div>
            <p className="afs-feed-body">{post.body}</p>
            <div className="afs-feed-foot"><button type="button" className="afs-pill" aria-pressed={post.reactedByMe} onClick={() => void react(post.id)}>공감 {post.reactionCount}</button><button type="button" className="afs-pill" onClick={() => setReplyingTo((current) => current === post.id ? null : post.id)}>답글 {post.replyCount}</button><button type="button" className="afs-pill" onClick={() => void report(post.id)}>신고</button></div>
            {replyingTo === post.id && <div className="afs-reply-form"><textarea rows={2} maxLength={1000} value={replyBody} onChange={(event) => setReplyBody(event.target.value)} placeholder="이 글의 근거에 답해 주세요." /><button type="button" className="afs-pill" disabled={busy || !replyBody.trim()} onClick={() => void submitReply(post)}>답글 등록</button></div>}
            {post.replies.length ? <ul className="afs-feed-replies">{post.replies.map((reply) => <li key={reply.id}><div className="afs-feed-head"><b>{reply.displayName}</b>{badge(reply.readerType)}<time dateTime={new Date(reply.createdAt).toISOString()}>{dateLabel(reply.createdAt)}</time></div><p className="afs-feed-body">{reply.body}</p></li>)}</ul> : null}
          </li>)}</ul> : <p className="afs-note">아직 공개된 글이 없습니다. 첫 글을 남겨 보세요.</p>}
          {cursor && sort === "new" ? <button type="button" className="afs-pill" onClick={() => void loadPosts(sort, cursor, true)}>더 불러오기</button> : null}
        </div>
        <p className="afs-foot">모든 글은 D1에 저장되며, 개인정보로 보일 수 있는 내용은 검토 전까지 공개되지 않습니다. 신고 3회 누적 글은 자동 숨김 처리됩니다.</p>
      </section>
      {notice && <p className="trust-notice" role="status">{notice}</p>}
    </>
  );
}
