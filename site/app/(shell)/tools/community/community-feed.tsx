"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useLocal } from "../../client-store";
import { COMMUNITY_API_ENABLED, communityFetch } from "../../community-session";
import { TYPES } from "../self-check/reader-type";
import "./community.css";

type Reply = { id: string; displayName: string; readerType: string | null; body: string; createdAt: number; reactionCount: number };
type Post = { id: string; issueId: string; issueTitle: string | null; issueRank: number | null; displayName: string; readerType: string | null; screen: string | null; body: string; reactionCount: number; reactedByMe: boolean; replyCount: number; createdAt: number; replies: Reply[]; demo?: boolean };
export type CommunityIssue = { id: string; rank: number; title: string };

/* 공용 저장소(워커 + D1)가 붙어 있으면 그쪽이 진짜다. 붙어 있지 않은 배포에서는
   화면을 비우고 오류 문구를 띄우는 대신 예시 글로 내려앉는다 — 무엇을 보여 주려는
   화면인지가 먼저 전달돼야 하고, 저장 위치는 숨기지 않고 그대로 적는다. */
type Mode = "checking" | "server" | "local";
const LOCAL_KEY = "afs-community-local-v1";

function readStored(): Post[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(LOCAL_KEY) ?? "null");
    return Array.isArray(parsed) ? (parsed as Post[]) : [];
  } catch {
    return [];
  }
}

function writeStored(posts: Post[]) {
  try {
    window.localStorage.setItem(LOCAL_KEY, JSON.stringify(posts.filter((post) => !post.demo)));
  } catch {
    /* 저장이 막혀도 화면은 돈다 */
  }
}

function seedPosts(issues: CommunityIssue[], basisDate: string): Post[] {
  const at = (rank: number) => issues.find((issue) => issue.rank === rank) ?? issues[0];
  const base = Date.parse(`${basisDate}T02:00:00Z`);
  const rows: Array<{ issue: CommunityIssue | undefined; name: string; type: string; screen: string; body: string; minutes: number; reactions: number; reply?: { name: string; type: string; body: string; minutes: number } }> = [
    {
      issue: at(1),
      name: "가로등",
      type: "BDCP",
      screen: "프레이밍 분석",
      body: "같은 사건을 다룬 기사라도 문제 삼는 지점과 대응을 바라보는 관점이 다르네요. 여러분은 어느 부분이 가장 눈에 띄었나요?",
      minutes: 0,
      reactions: 4,
      reply: { name: "밑줄", type: "HMOR", body: "저는 먼저 제목을 비교하고, 본문에서 누가 어떤 말을 했는지 다시 읽어봤어요. 같은 사실을 어디에 배치했는지도 살펴보면 좋겠네요.", minutes: 46 },
    },
    {
      issue: at(2),
      name: "창가자리",
      type: "BDOP",
      screen: "언론사 비교",
      body: "기사에 등장한 취재원을 나란히 보니 설명의 출발점이 다르게 느껴졌어요. 어떤 발언을 앞세웠는지 비교해 보는 것도 도움이 되네요.",
      minutes: 95,
      reactions: 2,
    },
    {
      issue: at(3),
      name: "야근중",
      type: "HMCR",
      screen: "AI 대화",
      body: "처음에는 제목의 표현에 눈길이 갔는데, 기사 내용과 함께 읽으니 다른 질문이 생겼어요. 원인과 책임을 어떻게 설명했는지 더 이야기해 보고 싶습니다.",
      minutes: 210,
      reactions: 3,
    },
  ];
  return rows.map((row, index) => ({
    id: `demo-${index}`,
    issueId: row.issue?.id ?? "",
    issueTitle: row.issue?.title ?? null,
    issueRank: row.issue?.rank ?? null,
    displayName: row.name,
    readerType: row.type,
    screen: row.screen,
    body: row.body,
    reactionCount: row.reactions,
    reactedByMe: false,
    replyCount: row.reply ? 1 : 0,
    createdAt: base + row.minutes * 60_000,
    demo: true,
    replies: row.reply
      ? [{ id: `demo-${index}-r`, displayName: row.reply.name, readerType: row.reply.type, body: row.reply.body, createdAt: base + row.reply.minutes * 60_000, reactionCount: 0 }]
      : [],
  }));
}
type ApiComment = Partial<Post> & { parentId?: string | null };

const badge = (code: string | null) => {
  if (!code || !TYPES[code]) return null;
  const type = TYPES[code];
  return <span className="afs-badge-type" title={type.line}>{type.name}</span>;
};

function dateLabel(value: number) { return new Date(value).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" }); }

function Avatar({ name }: { name: string }) {
  return <span className="community-avatar" aria-hidden="true">{name.trim().slice(0, 1) || "익"}</span>;
}

function ActionIcon({ reply = false }: { reply?: boolean }) {
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">{reply ? <path d="M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 4v-4H3V6a2 2 0 0 1 2-2Z" /> : <path d="M12 21 3.7 13a5.5 5.5 0 0 1 0-7.8 5.5 5.5 0 0 1 7.8 0l.5.5.5-.5a5.5 5.5 0 0 1 7.8 7.8Z" />}</svg>;
}

function issueCommentsToPosts(comments: ApiComment[], issue: CommunityIssue | undefined): Post[] {
  const normalized = comments.map((comment) => ({
    id: String(comment.id ?? crypto.randomUUID()),
    issueId: String(comment.issueId ?? issue?.id ?? ""),
    issueTitle: comment.issueTitle ?? issue?.title ?? null,
    issueRank: comment.issueRank == null ? (issue?.rank ?? null) : Number(comment.issueRank),
    parentId: comment.parentId ?? null,
    displayName: String(comment.displayName ?? "익명 독자"),
    readerType: comment.readerType ?? null,
    screen: comment.screen ?? null,
    body: String(comment.body ?? ""),
    reactionCount: Number(comment.reactionCount ?? 0),
    reactedByMe: Boolean(comment.reactedByMe),
    replyCount: Number(comment.replyCount ?? 0),
    createdAt: Number(comment.createdAt ?? Date.now()),
  }));
  const repliesByParent = new Map<string, Reply[]>();
  normalized.filter((comment) => comment.parentId).forEach((comment) => {
    const replies = repliesByParent.get(comment.parentId!) ?? [];
    replies.push({ id: comment.id, displayName: comment.displayName, readerType: comment.readerType, body: comment.body, createdAt: comment.createdAt, reactionCount: comment.reactionCount });
    repliesByParent.set(comment.parentId!, replies);
  });
  return normalized.filter((comment) => !comment.parentId).map((comment) => ({
    id: comment.id,
    issueId: comment.issueId,
    issueTitle: comment.issueTitle,
    issueRank: comment.issueRank,
    displayName: comment.displayName,
    readerType: comment.readerType,
    screen: comment.screen,
    body: comment.body,
    reactionCount: comment.reactionCount,
    reactedByMe: comment.reactedByMe,
    replyCount: comment.replyCount || (repliesByParent.get(comment.id)?.length ?? 0),
    createdAt: comment.createdAt,
    replies: repliesByParent.get(comment.id) ?? [],
  }));
}

function sortPosts(posts: Post[], sort: "hot" | "new") {
  return posts.slice().sort((a, b) => (sort === "hot" ? b.reactionCount - a.reactionCount || b.createdAt - a.createdAt : b.createdAt - a.createdAt));
}

export function CommunityFeed({ issues, basisDate }: { issues: CommunityIssue[]; basisDate: string }) {
  const mine = useLocal("afs-reader-type");
  const [selectedIssue, setSelectedIssue] = useState(issues[0]?.id ?? "");
  const [posts, setPosts] = useState<Post[]>([]);
  const [mode, setMode] = useState<Mode>("checking");
  const [sort, setSort] = useState<"hot" | "new">("new");
  const [cursor, setCursor] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [displayName, setDisplayName] = useState("익명 독자");
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const mineType = useMemo(() => (mine && TYPES[mine] ? mine : null), [mine]);

  useEffect(() => {
    if (replyingTo) document.getElementById(`reply-${replyingTo}`)?.focus();
  }, [replyingTo]);

  const loadLocal = useCallback((nextSort: "hot" | "new") => {
    const stored = readStored();
    setPosts(sortPosts([...stored, ...seedPosts(issues, basisDate)], nextSort));
    setCursor(null);
  }, [issues, basisDate]);

  const loadPosts = useCallback(async (nextSort = sort, nextCursor: string | null = null, append = false) => {
    if (mode === "local") { loadLocal(nextSort); return; }
    if (!COMMUNITY_API_ENABLED) { setMode("local"); loadLocal(nextSort); return; }
    try {
      const query = new URLSearchParams({ sort: nextSort, limit: "20" });
      if (nextCursor) query.set("cursor", nextCursor);
      /* 전역 라우트가 아직 배포되지 않은 환경에서는 요청 자체를 보내지 않는다.
         보내면 404 가 콘솔 오류로 남아 렌더 점검(JS-ERROR)에 걸리고, 사용자에게도
         내부 오류가 스쳐 지나간다. 의제 단위 라우트는 지금 배포에 이미 있다. */
      let response: Response | null = null;
      let payload: { posts?: Post[]; nextCursor?: string | null; error?: { message?: string } } | null = null;
      if (COMMUNITY_API_ENABLED) {
        response = await communityFetch(`/api/community?${query.toString()}`, { cache: "no-store" });
        payload = await response.json();
        if (response.ok) {
          setMode("server");
          setPosts((current) => append ? [...current, ...(payload?.posts ?? [])] : (payload?.posts ?? [])); setCursor(payload?.nextCursor ?? null); return;
        }
      }
      // The current Vercel project can be linked to the older worker while the
      // global community route is being rolled out. Its issue-scoped route is
      // durable and already available, so use it as a backwards-compatible
      // fallback instead of leaving the feed unusable.
      if ((response && response.status !== 404) || !selectedIssue) throw new Error(payload?.error?.message ?? "커뮤니티 글을 불러오지 못했습니다.");
      const issueResponse = await communityFetch(`/api/issues/${encodeURIComponent(selectedIssue)}/community`, { cache: "no-store" });
      const issuePayload = await issueResponse.json();
      if (!issueResponse.ok) throw new Error(issuePayload?.error?.message ?? "커뮤니티 글을 불러오지 못했습니다.");
      const fallbackPosts = issueCommentsToPosts(Array.isArray(issuePayload.comments) ? issuePayload.comments : [], issues.find((issue) => issue.id === selectedIssue));
      setMode("server");
      setPosts(fallbackPosts); setCursor(null);
      setNotice("현재 배포 환경에서는 선택한 의제의 글을 표시합니다.");
    } catch { setMode("local"); loadLocal(nextSort); }
  }, [issues, selectedIssue, sort, mode, loadLocal]);

  // These effects synchronize the client with durable API state.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void loadPosts(sort); }, [loadPosts, sort]);

  const appendLocal = (post: Post) => {
    const stored = [post, ...readStored()];
    writeStored(stored);
    setPosts(sortPosts([...stored, ...seedPosts(issues, basisDate)], sort));
  };

  /* 목록 GET 은 되는데 등록 POST 는 404 인 배포가 있다 — 워커는 살아 있고 D1 에 그 의제가
     없는 상태다. 그러면 화면은 '서버 모드' 로 판단해 놓고 등록만 실패해, 글이 그대로 사라진다.
     쓴 글을 잃지 않게 로컬로 받아 두고 무엇이 일어났는지 알린다. */
  const fallbackToLocal = (write: () => void, why: string) => {
    setMode("local");
    write();
    setNotice(why);
  };

  const localPost = (): Post => {
    const issue = issues.find((row) => row.id === selectedIssue);
    return {
      id: `local-${crypto.randomUUID()}`,
      issueId: selectedIssue,
      issueTitle: issue?.title ?? null,
      issueRank: issue?.rank ?? null,
      displayName: displayName || "익명 독자",
      readerType: mineType,
      screen: "커뮤니티",
      body: body.trim(),
      reactionCount: 0,
      reactedByMe: false,
      replyCount: 0,
      createdAt: Date.now(),
      replies: [],
    };
  };

  const localReply = (replyBody: string): Reply => ({
    id: `local-${crypto.randomUUID()}`,
    displayName: displayName || "익명 독자",
    readerType: mineType,
    body: replyBody.trim(),
    createdAt: Date.now(),
    reactionCount: 0,
  });

  const attachReply = (post: Post, reply: Reply) => {
    const stored = readStored().map((row) =>
      row.id === post.id ? { ...row, replies: [...row.replies, reply], replyCount: row.replyCount + 1 } : row,
    );
    writeStored(stored);
    setPosts(
      sortPosts([...stored, ...seedPosts(issues, basisDate)], sort).map((row) =>
        row.id === post.id && row.demo ? { ...row, replies: [...row.replies, reply], replyCount: row.replyCount + 1 } : row,
      ),
    );
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (!selectedIssue || !body.trim() || busy) return;
    setBusy(true); setNotice("");
    if (mode === "local") {
      appendLocal(localPost());
      setBody(""); setNotice("이 브라우저에 저장했습니다."); setBusy(false); return;
    }
    try {
      let response = COMMUNITY_API_ENABLED
        ? await communityFetch("/api/community", { method: "POST", body: JSON.stringify({ issueId: selectedIssue, body, displayName, readerType: mineType, screen: "커뮤니티" }) })
        : new Response(JSON.stringify({}), { status: 404 });
      let payload = await response.json();
      if (response.status === 404) {
        response = await communityFetch(`/api/issues/${encodeURIComponent(selectedIssue)}/community`, { method: "POST", body: JSON.stringify({ body, displayName, readerType: mineType, screen: "커뮤니티" }) });
        payload = await response.json();
      }
      if (!response.ok) {
        const draft = localPost();
        fallbackToLocal(
          () => appendLocal(draft),
          "공개 등록이 되지 않아 나에게만 저장했습니다.",
        );
        setBody("");
        return;
      }
      setBody(""); setNotice(payload.notice ?? "글이 등록되었습니다."); await loadPosts(sort);
    } catch {
      const draft = localPost();
      fallbackToLocal(() => appendLocal(draft), "공용 저장소에 닿지 못해 이 브라우저에 저장했습니다.");
      setBody("");
    }
    finally { setBusy(false); }
  };

  const submitReply = async (post: Post) => {
    const replyBody = replyDrafts[post.id] ?? "";
    const clearReply = () => { setReplyDrafts(current => ({ ...current, [post.id]: "" })); setReplyingTo(null); };
    if (!replyBody.trim() || busy) return;
    setBusy(true); setNotice("");
    if (mode === "local") {
      attachReply(post, localReply(replyBody));
      clearReply(); setNotice("이 브라우저에 저장했습니다."); setBusy(false); return;
    }
    try {
      let response = await communityFetch(`/api/community/${encodeURIComponent(post.id)}/replies`, { method: "POST", body: JSON.stringify({ body: replyBody, displayName, readerType: mineType, screen: "커뮤니티 답글" }) });
      let payload = await response.json();
      if (response.status === 404) {
        response = await communityFetch(`/api/issues/${encodeURIComponent(post.issueId)}/community`, { method: "POST", body: JSON.stringify({ parentId: post.id, body: replyBody, displayName, readerType: mineType, screen: "커뮤니티 답글" }) });
        payload = await response.json();
      }
      if (!response.ok) {
        const draft = localReply(replyBody);
        fallbackToLocal(
          () => attachReply(post, draft),
          "공용 저장소가 이 답글을 받지 못해 이 브라우저에 저장했습니다.",
        );
        clearReply();
        return;
      }
      clearReply(); setNotice(payload.notice ?? "답글이 등록되었습니다."); await loadPosts(sort);
    } catch {
      const draft = localReply(replyBody);
      fallbackToLocal(() => attachReply(post, draft), "공용 저장소에 닿지 못해 이 답글을 이 브라우저에 저장했습니다.");
      clearReply();
    }
    finally { setBusy(false); }
  };

  const react = async (postId: string) => {
    if (mode === "local") {
      const toggle = (row: Post) => row.id === postId ? { ...row, reactedByMe: !row.reactedByMe, reactionCount: row.reactionCount + (row.reactedByMe ? -1 : 1) } : row;
      writeStored(readStored().map(toggle));
      setPosts((current) => current.map(toggle));
      return;
    }
    try {
      const response = await communityFetch(`/api/community/${encodeURIComponent(postId)}/react`, { method: "POST" });
      const payload = await response.json(); if (!response.ok) throw new Error(payload?.error?.message ?? "공감을 처리하지 못했습니다.");
      setPosts((current) => current.map((post) => post.id === postId ? { ...post, reactedByMe: payload.reacted, reactionCount: payload.reactionCount } : post));
    } catch (error) { setNotice(error instanceof Error ? error.message : "공감을 처리하지 못했습니다."); }
  };

  const report = async (postId: string) => {
    if (mode === "local") { setNotice("이 글은 예시이거나 나에게만 저장된 글입니다."); return; }
    try {
      const response = await communityFetch(`/api/community/${encodeURIComponent(postId)}/report`, { method: "POST", body: JSON.stringify({}) });
      const payload = await response.json(); setNotice(response.ok ? "신고가 접수되었습니다. 운영 검토 후 조치합니다." : payload?.error?.message ?? "신고를 접수하지 못했습니다.");
    } catch { setNotice("신고를 접수하지 못했습니다."); }
  };

  return (
    <div className="community-participation">
      <section className="afs-card community-composer" aria-label="의견 쓰기">
        <form className="afs-compose" onSubmit={submit}>
          <div className="community-identity"><Avatar name={displayName || "익명 독자"} /><details className="community-name"><summary>{displayName || "익명 독자"}<span aria-hidden="true">⌄</span></summary><label>표시 이름<input maxLength={40} value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label></details>{badge(mineType)}</div>
          <textarea id="afs-compose" aria-label="글 내용" rows={2} maxLength={1000} value={body} onChange={(event) => setBody(event.target.value)} placeholder="이 의제에서 무엇이 눈에 띄었나요?" />
          <div className="community-compose-bottom"><select aria-label="글 의제" value={selectedIssue} onChange={(event) => setSelectedIssue(event.target.value)} disabled={!issues.length}><option value="">의제를 선택하세요</option>{issues.map((issue) => <option key={issue.id} value={issue.id}>{issue.rank}위 · {issue.title}</option>)}</select><span className="community-storage">{mode === "local" ? "나에게만 저장" : ""}</span><button type="submit" className="community-primary" disabled={busy || mode === "checking" || !selectedIssue || !body.trim()}>{busy ? "등록 중…" : "의견 남기기"}</button></div>
        </form>
      </section>
      <section className="community-conversations" aria-labelledby="community-conversations-title">
        <div className="community-list-heading"><h2 id="community-conversations-title">대화가 이어지고 있어요</h2><div className="afs-sortbar" aria-label="글 정렬"><button type="button" className="afs-pill" aria-pressed={sort === "new"} onClick={() => setSort("new")}>최신순</button><button type="button" className="afs-pill" aria-pressed={sort === "hot"} onClick={() => setSort("hot")}>공감순</button></div></div>
        {posts.length ? <ul className="afs-feed">{posts.map((post) => <li key={post.id} data-post-id={post.id}>
          <div className="community-post-top"><Avatar name={post.displayName} /><div className="community-post-content"><div className="afs-feed-head"><b>{post.displayName}</b>{badge(post.readerType)}<time dateTime={new Date(post.createdAt).toISOString()}>{dateLabel(post.createdAt)}</time>{post.demo && <span className="community-example">예시</span>}</div><p className="afs-feed-body">{post.body}</p><div className="community-post-context">{post.issueTitle && <Link href={`/issues/${encodeURIComponent(post.issueId)}`}>{post.issueTitle}</Link>}</div><div className="afs-feed-foot"><button type="button" aria-pressed={post.reactedByMe} onClick={() => void react(post.id)}><ActionIcon />공감 {post.reactionCount}</button><button type="button" aria-expanded={post.replies.length > 0 || replyingTo === post.id} aria-controls={`replies-${post.id}`} onClick={() => { setReplyingTo(post.id); document.getElementById(`reply-${post.id}`)?.focus(); }}><ActionIcon reply />답글 {post.replyCount}</button></div></div><details className="community-more"><summary aria-label={`${post.displayName} 글 더보기`}>···</summary><button type="button" onClick={() => void report(post.id)}>신고</button></details></div>
          <div id={`replies-${post.id}`} className="community-thread" hidden={!post.replies.length && replyingTo !== post.id}>
            {post.replies.length ? <ul className="afs-feed-replies">{post.replies.map((reply) => <li key={reply.id}><Avatar name={reply.displayName} /><div className="community-post-content"><div className="afs-feed-head"><b>{reply.displayName}</b>{badge(reply.readerType)}<time dateTime={new Date(reply.createdAt).toISOString()}>{dateLabel(reply.createdAt)}</time></div><p className="afs-feed-body">{reply.body}</p></div></li>)}</ul> : null}
            <form className="community-inline-reply" onSubmit={event => { event.preventDefault(); void submitReply(post); }}><Avatar name={displayName || "익명 독자"} /><textarea id={`reply-${post.id}`} aria-label={`${post.displayName}에게 답글`} rows={1} maxLength={1000} value={replyDrafts[post.id] ?? ""} onChange={event => setReplyDrafts(current => ({ ...current, [post.id]: event.target.value }))} placeholder="답글을 남겨보세요" /><button type="submit" disabled={busy || !(replyDrafts[post.id] ?? "").trim()}>등록</button></form>
          </div>
        </li>)}</ul> : <p className="afs-note">{mode === "checking" ? "이야기를 불러오고 있습니다…" : "첫 이야기를 남겨보세요."}</p>}
        {cursor && sort === "new" ? <button type="button" className="afs-pill" onClick={() => void loadPosts(sort, cursor, true)}>더 불러오기</button> : null}
        {mode === "local" && <p className="community-local-note">예시 글이 포함되어 있습니다. 작성한 글은 이 브라우저에서만 볼 수 있습니다.</p>}
      </section>
      {notice && <p className="trust-notice" role="status">{notice}</p>}
    </div>
  );
}
