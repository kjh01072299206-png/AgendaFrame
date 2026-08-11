"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useLocal } from "../../client-store";
import { COMMUNITY_API_ENABLED, communityFetch } from "../../community-session";
import { TYPES } from "../self-check/reader-type";

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

function seedPosts(issues: CommunityIssue[]): Post[] {
  const at = (rank: number) => issues.find((issue) => issue.rank === rank) ?? issues[0];
  const base = Date.UTC(2026, 6, 27, 2, 0);
  const rows: Array<{ issue: CommunityIssue | undefined; name: string; type: string; screen: string; body: string; minutes: number; reactions: number; reply?: { name: string; type: string; body: string; minutes: number } }> = [
    {
      issue: at(1),
      name: "가로등",
      type: "BDCP",
      screen: "프레이밍 분석",
      body: "다섯 층위가 전부 한 계열로 모였다는 표를 보고 좀 놀랐습니다. 저는 이 사안이 찬반으로 갈린 줄 알았는데, 갈린 건 해법 문장이지 문제 정의가 아니었네요.",
      minutes: 0,
      reactions: 4,
      reply: { name: "밑줄", type: "HMOR", body: "저도 제목만 봤을 때는 정반대로 읽었습니다. 본문 근거를 나란히 놓으니 제목 차이가 과장으로 보이네요.", minutes: 46 },
    },
    {
      issue: at(2),
      name: "창가자리",
      type: "BDOP",
      screen: "언론사 비교",
      body: "취재원 표에서 한 곳만 안전 문제로 평가한 게 눈에 띕니다. 같은 사건인데 평가 층위에서만 갈리는 경우가 생각보다 흔한가요?",
      minutes: 95,
      reactions: 2,
    },
    {
      issue: at(3),
      name: "야근중",
      type: "HMCR",
      screen: "AI 대화",
      body: "‘무엇이 갈렸나’로 물었더니 갈리지 않았다고 답하더군요. 근거 없으면 없다고 답하는 쪽이 오히려 믿음이 갑니다.",
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
  if (!code) return <span className="afs-chip">자가점검 전</span>;
  const type = TYPES[code];
  return <span className="afs-badge-type" title={type?.line ?? code}><b className="afs-num">{code}</b>{type?.name ?? "읽기 유형"}</span>;
};

function dateLabel(value: number) { return new Date(value).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" }); }

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

export function CommunityFeed({ issues }: { issues: CommunityIssue[] }) {
  const mine = useLocal("afs-reader-type");
  const [selectedIssue, setSelectedIssue] = useState(issues[0]?.id ?? "");
  const [posts, setPosts] = useState<Post[]>([]);
  const [mode, setMode] = useState<Mode>("checking");
  const [sort, setSort] = useState<"hot" | "new">("new");
  const [cursor, setCursor] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [displayName, setDisplayName] = useState("익명 독자");
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const mineType = useMemo(() => (mine && TYPES[mine] ? mine : null), [mine]);

  const loadLocal = useCallback((nextSort: "hot" | "new") => {
    const stored = readStored();
    setPosts(sortPosts([...stored, ...seedPosts(issues)], nextSort));
    setCursor(null);
  }, [issues]);

  const loadPosts = useCallback(async (nextSort = sort, nextCursor: string | null = null, append = false) => {
    if (mode === "local") { loadLocal(nextSort); return; }
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
    setPosts(sortPosts([...stored, ...seedPosts(issues)], sort));
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

  const localReply = (): Reply => ({
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
      sortPosts([...stored, ...seedPosts(issues)], sort).map((row) =>
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
          "공용 저장소가 이 글을 받지 못해 이 브라우저에 저장했습니다. 저장소가 연결되면 함께 올라갑니다.",
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
    if (!replyBody.trim() || busy) return;
    setBusy(true); setNotice("");
    if (mode === "local") {
      attachReply(post, localReply());
      setReplyBody(""); setReplyingTo(null); setNotice("이 브라우저에 저장했습니다."); setBusy(false); return;
    }
    try {
      let response = await communityFetch(`/api/community/${encodeURIComponent(post.id)}/replies`, { method: "POST", body: JSON.stringify({ body: replyBody, displayName, readerType: mineType, screen: "커뮤니티 답글" }) });
      let payload = await response.json();
      if (response.status === 404) {
        response = await communityFetch(`/api/issues/${encodeURIComponent(post.issueId)}/community`, { method: "POST", body: JSON.stringify({ parentId: post.id, body: replyBody, displayName, readerType: mineType, screen: "커뮤니티 답글" }) });
        payload = await response.json();
      }
      if (!response.ok) {
        const draft = localReply();
        fallbackToLocal(
          () => attachReply(post, draft),
          "공용 저장소가 이 답글을 받지 못해 이 브라우저에 저장했습니다.",
        );
        setReplyBody(""); setReplyingTo(null);
        return;
      }
      setReplyBody(""); setReplyingTo(null); setNotice(payload.notice ?? "답글이 등록되었습니다."); await loadPosts(sort);
    } catch {
      const draft = localReply();
      fallbackToLocal(() => attachReply(post, draft), "공용 저장소에 닿지 못해 이 답글을 이 브라우저에 저장했습니다.");
      setReplyBody(""); setReplyingTo(null);
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
    if (mode === "local") { setNotice("공용 저장소가 연결되면 신고가 접수됩니다."); return; }
    try {
      const response = await communityFetch(`/api/community/${encodeURIComponent(postId)}/report`, { method: "POST", body: JSON.stringify({}) });
      const payload = await response.json(); setNotice(response.ok ? "신고가 접수되었습니다. 운영 검토 후 조치합니다." : payload?.error?.message ?? "신고를 접수하지 못했습니다.");
    } catch { setNotice("신고를 접수하지 못했습니다."); }
  };

  return (
    <>
      <section className="afs-card">
        <h2>글 쓰기 <small>{mode === "local" ? "이 브라우저에 저장됩니다" : "근거를 본 의제와 함께 저장됩니다"}</small></h2>
        <div className="afs-in">
          <form className="afs-compose" onSubmit={submit}>
            <p className="afs-compose-who"><span className="afs-chip">{displayName || "익명 독자"}</span>{badge(mineType)}</p>
            <label>표시 이름<input maxLength={40} value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label>
            <label>의제<select value={selectedIssue} onChange={(event) => setSelectedIssue(event.target.value)} disabled={!issues.length}><option value="">의제를 선택하세요</option>{issues.map((issue) => <option key={issue.id} value={issue.id}>{issue.rank}위 · {issue.title}</option>)}</select></label>
            <label>글 내용<textarea id="afs-compose" rows={4} maxLength={1000} value={body} onChange={(event) => setBody(event.target.value)} placeholder="어느 분석 화면에서 무엇을 확인했는지 근거와 함께 적어 주세요." /></label>
            <div className="afs-compose-foot"><span>{mineType ? `${mineType} 유형이 글에 함께 표시됩니다.` : "자가점검을 완료하면 읽기 유형이 함께 표시됩니다."}</span><button type="submit" className="afs-pill" disabled={busy || !selectedIssue || !body.trim()}>{busy ? "등록 중…" : "올리기"}</button></div>
          </form>
        </div>
      </section>

      <section className="afs-card">
        <h2>최근 이야기 {mode === "local" ? <span className="afs-chip">예시</span> : null}<small>{posts.length}개 표시</small></h2>
        <div className="afs-in">
          <div className="afs-sortbar"><button type="button" className="afs-pill" aria-pressed={sort === "hot"} onClick={() => setSort("hot")}>공감순</button><button type="button" className="afs-pill" aria-pressed={sort === "new"} onClick={() => setSort("new")}>최신순</button></div>
          {posts.length ? <ul className="afs-feed">{posts.map((post) => <li key={post.id}>
            <div className="afs-feed-head"><b>{post.displayName}</b>{badge(post.readerType)}{post.issueTitle && <Link className="afs-chip afs-chip-brand" href={`/issues/${encodeURIComponent(post.issueId)}`}>{post.issueRank ? `${post.issueRank}위 · ` : ""}{post.issueTitle}</Link>}<span className="afs-chip">{post.screen ?? "커뮤니티"}</span>{post.demo ? <span className="afs-chip">예시</span> : null}<time dateTime={new Date(post.createdAt).toISOString()}>{dateLabel(post.createdAt)}</time></div>
            <p className="afs-feed-body">{post.body}</p>
            <div className="afs-feed-foot"><button type="button" className="afs-pill" aria-pressed={post.reactedByMe} onClick={() => void react(post.id)}>공감 {post.reactionCount}</button><button type="button" className="afs-pill" onClick={() => setReplyingTo((current) => current === post.id ? null : post.id)}>답글 {post.replyCount}</button><button type="button" className="afs-pill" onClick={() => void report(post.id)}>신고</button></div>
            {replyingTo === post.id && <div className="afs-reply-form"><textarea rows={2} maxLength={1000} value={replyBody} onChange={(event) => setReplyBody(event.target.value)} placeholder="이 글의 근거에 답해 주세요." /><button type="button" className="afs-pill" disabled={busy || !replyBody.trim()} onClick={() => void submitReply(post)}>답글 등록</button></div>}
            {post.replies.length ? <ul className="afs-feed-replies">{post.replies.map((reply) => <li key={reply.id}><div className="afs-feed-head"><b>{reply.displayName}</b>{badge(reply.readerType)}<time dateTime={new Date(reply.createdAt).toISOString()}>{dateLabel(reply.createdAt)}</time></div><p className="afs-feed-body">{reply.body}</p></li>)}</ul> : null}
          </li>)}</ul> : <p className="afs-note">아직 공개된 글이 없습니다. 첫 글을 남겨 보세요.</p>}
          {cursor && sort === "new" ? <button type="button" className="afs-pill" onClick={() => void loadPosts(sort, cursor, true)}>더 불러오기</button> : null}
        </div>
        <p className="afs-foot">
          {mode === "local"
            ? "‘예시’ 표시가 붙은 글은 화면 설명을 위해 넣어 둔 것입니다. 여기서 쓴 글은 공용 저장소가 연결될 때까지 이 브라우저에만 저장되며, 다른 사람에게는 보이지 않습니다."
            : "글은 익명 세션 단위로 저장되며, 개인정보로 보일 수 있는 내용은 검토 전까지 공개되지 않습니다. 신고 3회 누적 글은 자동 숨김 처리됩니다."}
        </p>
      </section>
      {notice && <p className="trust-notice" role="status">{notice}</p>}
    </>
  );
}
