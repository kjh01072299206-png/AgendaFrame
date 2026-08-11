const WINDOW_MS = 15 * 60 * 1000;
const MAX_COMMENT_LENGTH = 1000;
const MAX_DISPLAY_NAME_LENGTH = 40;
const MAX_REPORT_REASON_LENGTH = 200;
const MAX_SCREEN_LENGTH = 60;
const VALID_READER_TYPES = new Set([
  "BDCP", "BDCR", "BDOP", "BDOR", "BMCP", "BMCR", "BMOP", "BMOR",
  "HDCP", "HDCR", "HDOP", "HDOR", "HMCP", "HMCR", "HMOP", "HMOR",
]);

const SELF_CHECK_QUESTIONS = [
  ["focus", "a"], ["focus", "b"], ["focus", "a"],
  ["voice", "a"], ["voice", "b"], ["voice", "b"],
  ["range", "a"], ["range", "b"], ["range", "b"],
  ["aim", "a"], ["aim", "b"], ["aim", "b"],
];

function json(body, status = 200, extraHeaders = {}) {
  return Response.json(body, { status, headers: { "cache-control": "no-store", ...extraHeaders } });
}

function dbReady(env) {
  return env?.DB && typeof env.DB.prepare === "function" && typeof env.DB.batch === "function";
}

function rows(result) {
  return Array.isArray(result?.results) ? result.results : [];
}

function safeId(value, maximum = 128) {
  let decoded;
  try { decoded = decodeURIComponent(String(value ?? "")); } catch { return null; }
  const id = decoded.trim();
  return id && id.length <= maximum && /^[A-Za-z0-9._:-]+$/.test(id) ? id : null;
}

function safeCursor(value) {
  if (!value) return null;
  try {
    const decoded = atob(String(value).replace(/-/g, "+").replace(/_/g, "/"));
    const parsed = JSON.parse(decoded);
    if (!Number.isSafeInteger(parsed.createdAt) || typeof parsed.id !== "string" || !safeId(parsed.id)) return null;
    return { createdAt: parsed.createdAt, id: parsed.id };
  } catch { return null; }
}

function cursorFor(row) {
  const encoded = btoa(JSON.stringify({ createdAt: Number(row.createdAt), id: row.id }));
  return encoded.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function needsModeration(body) {
  return /[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|\b\d{2,3}[- .]\d{3,4}[- .]\d{4}\b/u.test(body);
}

export function validateCommentPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return { ok: false, error: "댓글 형식이 올바르지 않습니다." };
  const body = String(payload.body ?? "").trim();
  const displayName = String(payload.displayName ?? "익명 독자").trim();
  const parentId = payload.parentId == null ? null : safeId(payload.parentId);
  const readerType = String(payload.readerType ?? "").trim().toUpperCase() || null;
  const screen = String(payload.screen ?? "").trim().slice(0, MAX_SCREEN_LENGTH) || null;
  if (!body || body.length > MAX_COMMENT_LENGTH) return { ok: false, error: `댓글은 1~${MAX_COMMENT_LENGTH}자로 작성해 주세요.` };
  if (!displayName || displayName.length > MAX_DISPLAY_NAME_LENGTH) return { ok: false, error: `표시 이름은 1~${MAX_DISPLAY_NAME_LENGTH}자로 입력해 주세요.` };
  if (payload.parentId != null && !parentId) return { ok: false, error: "답글 대상을 확인해 주세요." };
  if (readerType && !VALID_READER_TYPES.has(readerType)) return { ok: false, error: "읽기 유형을 확인해 주세요." };
  return { ok: true, value: { body, displayName, parentId, readerType, screen } };
}

export function validateReportPayload(payload) {
  const reason = String(payload?.reason ?? "스팸·모욕·개인정보 등 부적절한 내용").trim();
  if (!reason || reason.length > MAX_REPORT_REASON_LENGTH) return { ok: false, error: `신고 사유는 1~${MAX_REPORT_REASON_LENGTH}자로 입력해 주세요.` };
  return { ok: true, value: { reason } };
}

export function validateSelfCheckPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || !Array.isArray(payload.answers)) {
    return { ok: false, error: "자가점검 답변 형식이 올바르지 않습니다." };
  }
  if (payload.answers.length !== SELF_CHECK_QUESTIONS.length || !payload.answers.every((answer) => answer === "a" || answer === "b")) {
    return { ok: false, error: "자가점검 문항을 모두 선택해 주세요." };
  }
  return { ok: true, value: { answers: [...payload.answers] } };
}

export function calculateReaderType(answers) {
  const scores = { focus: { a: 0, b: 0 }, voice: { a: 0, b: 0 }, range: { a: 0, b: 0 }, aim: { a: 0, b: 0 } };
  answers.forEach((answer, index) => { const [axis] = SELF_CHECK_QUESTIONS[index]; scores[axis][answer] += 1; });
  const code = [
    scores.focus.a >= scores.focus.b ? "H" : "B",
    scores.voice.a >= scores.voice.b ? "M" : "D",
    scores.range.a >= scores.range.b ? "O" : "C",
    scores.aim.a >= scores.aim.b ? "R" : "P",
  ].join("");
  return { code, scores };
}

function cookieValue(request, name) {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

async function actorHash(request, env) {
  const identity = String(
    request.headers.get("oai-authenticated-user-id")
      || request.headers.get("oai-authenticated-user-email")
      || cookieValue(request, "af_session")
      || request.headers.get("x-af-session")
      || "",
  ).trim().slice(0, 240);
  if (!identity) return null;
  const salt = String(env?.COMMUNITY_HASH_SALT ?? "agenda-community-session");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${salt}:${identity}`));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function sameOrigin(request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try { return origin === new URL(request.url).origin; } catch { return false; }
}

async function readJson(request) {
  try {
    const length = Number(request.headers.get("content-length") ?? 0);
    if (length > 32_000) return null;
    return await request.json();
  } catch { return null; }
}

async function consumeRateLimit(env, hash, field, now = Date.now()) {
  if (!hash) return { ok: false, reason: "session_required" };
  const windowStart = Math.floor(now / WINDOW_MS) * WINDOW_MS;
  const limit = field === "comment_count" ? 5 : field === "report_count" ? 10 : 30;
  const existing = await env.DB.prepare("SELECT comment_count, report_count, reaction_count FROM community_rate_limits WHERE actor_hash = ? AND window_start = ?").bind(hash, windowStart).first();
  const count = Number(existing?.[field] ?? 0);
  if (count >= limit) return { ok: false, reason: "rate_limited" };
  const next = {
    comment_count: Number(existing?.comment_count ?? 0),
    report_count: Number(existing?.report_count ?? 0),
    reaction_count: Number(existing?.reaction_count ?? 0),
  };
  next[field] += 1;
  await env.DB.prepare(`
    INSERT INTO community_rate_limits (actor_hash, window_start, comment_count, report_count, reaction_count, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(actor_hash, window_start) DO UPDATE SET
      comment_count = excluded.comment_count,
      report_count = excluded.report_count,
      reaction_count = excluded.reaction_count,
      updated_at = excluded.updated_at
  `).bind(hash, windowStart, next.comment_count, next.report_count, next.reaction_count, now).run();
  return { ok: true };
}

function publicComment(row) {
  return {
    id: row.id,
    issueId: row.issueId,
    issueTitle: row.issueTitle ?? null,
    issueRank: row.issueRank == null ? null : Number(row.issueRank),
    parentId: row.parentId ?? null,
    displayName: row.displayName,
    readerType: row.readerType ?? null,
    screen: row.screen ?? null,
    body: row.body,
    status: row.status,
    reactionCount: Number(row.reactionCount ?? 0),
    reactedByMe: Boolean(row.reactedByMe),
    replyCount: Number(row.replyCount ?? 0),
    createdAt: Number(row.createdAt),
    updatedAt: Number(row.updatedAt),
  };
}

async function loadCommentsByIssue(env, issueId, hash) {
  const result = await env.DB.prepare(`
    SELECT c.id, c.issue_id AS issueId, i.title AS issueTitle, c.parent_id AS parentId,
      c.display_name AS displayName, c.reader_type AS readerType, c.screen, c.body, c.status,
      c.created_at AS createdAt, c.updated_at AS updatedAt,
      (SELECT COUNT(*) FROM community_reactions r WHERE r.comment_id = c.id) AS reactionCount,
      EXISTS(SELECT 1 FROM community_reactions mine WHERE mine.comment_id = c.id AND mine.actor_hash = ?) AS reactedByMe,
      (SELECT COUNT(*) FROM community_comments replies WHERE replies.parent_id = c.id AND replies.status = 'published') AS replyCount
    FROM community_comments c JOIN issues i ON i.id = c.issue_id
    WHERE c.issue_id = ? AND c.status = 'published'
    ORDER BY c.created_at ASC, c.id ASC LIMIT 200
  `).bind(hash ?? "", issueId).all();
  return rows(result).map(publicComment);
}

async function loadCommunity(env, request, sort, cursor, limit) {
  const hash = await actorHash(request, env);
  const params = [hash ?? ""];
  const cursorClause = sort === "new" && cursor ? " AND (c.created_at < ? OR (c.created_at = ? AND c.id < ?))" : "";
  if (cursorClause) params.push(cursor.createdAt, cursor.createdAt, cursor.id);
  const order = sort === "hot" ? "reactionCount DESC, c.created_at DESC, c.id DESC" : "c.created_at DESC, c.id DESC";
  const result = await env.DB.prepare(`
    SELECT c.id, c.issue_id AS issueId, i.title AS issueTitle,
      (SELECT COUNT(*) + 1 FROM issues ranked WHERE ranked.run_id = i.run_id AND ranked.agenda_score > i.agenda_score) AS issueRank,
      c.parent_id AS parentId,
      c.display_name AS displayName, c.reader_type AS readerType, c.screen, c.body, c.status,
      c.created_at AS createdAt, c.updated_at AS updatedAt,
      (SELECT COUNT(*) FROM community_reactions r WHERE r.comment_id = c.id) AS reactionCount,
      EXISTS(SELECT 1 FROM community_reactions mine WHERE mine.comment_id = c.id AND mine.actor_hash = ?) AS reactedByMe,
      (SELECT COUNT(*) FROM community_comments replies WHERE replies.parent_id = c.id AND replies.status = 'published') AS replyCount
    FROM community_comments c JOIN issues i ON i.id = c.issue_id
    WHERE c.parent_id IS NULL AND c.status = 'published'${cursorClause}
    ORDER BY ${order} LIMIT ?
  `).bind(...params, limit + 1).all();
  const roots = rows(result);
  const hasMore = roots.length > limit;
  const page = roots.slice(0, limit);
  const replies = [];
  if (page.length) {
    const placeholders = page.map(() => "?").join(",");
    const replyResult = await env.DB.prepare(`
      SELECT c.id, c.issue_id AS issueId, i.title AS issueTitle,
        (SELECT COUNT(*) + 1 FROM issues ranked WHERE ranked.run_id = i.run_id AND ranked.agenda_score > i.agenda_score) AS issueRank,
        c.parent_id AS parentId,
        c.display_name AS displayName, c.reader_type AS readerType, c.screen, c.body, c.status,
        c.created_at AS createdAt, c.updated_at AS updatedAt,
        (SELECT COUNT(*) FROM community_reactions r WHERE r.comment_id = c.id) AS reactionCount,
        EXISTS(SELECT 1 FROM community_reactions mine WHERE mine.comment_id = c.id AND mine.actor_hash = ?) AS reactedByMe,
        0 AS replyCount
      FROM community_comments c JOIN issues i ON i.id = c.issue_id
      WHERE c.parent_id IN (${placeholders}) AND c.status = 'published'
      ORDER BY c.created_at ASC, c.id ASC
    `).bind(hash ?? "", ...page.map((row) => row.id)).all();
    replies.push(...rows(replyResult));
  }
  const grouped = new Map(page.map((row) => [row.id, []]));
  replies.forEach((reply) => grouped.get(reply.parentId)?.push(publicComment(reply)));
  const posts = page.map((row) => ({ ...publicComment(row), replies: grouped.get(row.id) ?? [] }));
  return { posts, nextCursor: hasMore && page.length ? cursorFor(page[page.length - 1]) : null };
}

async function createComment(request, env, issueId, parentId = null, payloadOverride = undefined) {
  const payload = payloadOverride === undefined ? await readJson(request) : payloadOverride;
  const parsed = validateCommentPayload({ ...(payload ?? {}), parentId: parentId ?? payload?.parentId });
  if (!parsed.ok) return json({ error: { code: "INVALID_REQUEST", message: parsed.error } }, 400);
  const hash = await actorHash(request, env);
  const rate = await consumeRateLimit(env, hash, "comment_count");
  if (!rate.ok) return json({ error: { code: rate.reason === "rate_limited" ? "RATE_LIMITED" : "SESSION_REQUIRED", message: rate.reason === "rate_limited" ? "글 작성 한도를 초과했습니다. 잠시 후 다시 시도해 주세요." : "글을 작성하려면 익명 세션이 필요합니다." } }, rate.reason === "rate_limited" ? 429 : 400);
  const issue = await env.DB.prepare("SELECT id FROM issues WHERE id = ? LIMIT 1").bind(issueId).first();
  if (!issue) return json({ error: { code: "NOT_FOUND", message: "이슈를 찾을 수 없습니다." } }, 404);
  if (parsed.value.parentId) {
    const parent = await env.DB.prepare("SELECT id FROM community_comments WHERE id = ? AND issue_id = ? AND parent_id IS NULL AND status = 'published'").bind(parsed.value.parentId, issueId).first();
    if (!parent) return json({ error: { code: "INVALID_REQUEST", message: "답글 대상을 찾을 수 없습니다." } }, 400);
  }
  const readerType = (await env.DB.prepare("SELECT type_code AS typeCode FROM self_check_results WHERE actor_hash = ?").bind(hash ?? "").first())?.typeCode ?? parsed.value.readerType;
  const id = crypto.randomUUID();
  const now = Date.now();
  const status = needsModeration(parsed.value.body) ? "pending" : "published";
  await env.DB.prepare(`
    INSERT INTO community_comments (id, issue_id, parent_id, actor_hash, display_name, body, reader_type, screen, status, report_count, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
  `).bind(id, issueId, parsed.value.parentId, hash, parsed.value.displayName, parsed.value.body, readerType, parsed.value.screen, status, now, now).run();
  return json({ comment: publicComment({ id, issueId, parentId: parsed.value.parentId, displayName: parsed.value.displayName, readerType, screen: parsed.value.screen, body: parsed.value.body, status, reactionCount: 0, replyCount: 0, createdAt: now, updatedAt: now }), notice: status === "pending" ? "개인정보로 보일 수 있는 내용이 있어 검토 후 공개됩니다." : null }, 201);
}

async function reportComment(request, env, commentId) {
  const payload = await readJson(request);
  const parsed = validateReportPayload(payload);
  if (!parsed.ok) return json({ error: { code: "INVALID_REQUEST", message: parsed.error } }, 400);
  const hash = await actorHash(request, env);
  const rate = await consumeRateLimit(env, hash, "report_count");
  if (!rate.ok) return json({ error: { code: rate.reason === "rate_limited" ? "RATE_LIMITED" : "SESSION_REQUIRED", message: rate.reason === "rate_limited" ? "신고 한도를 초과했습니다." : "신고하려면 익명 세션이 필요합니다." } }, rate.reason === "rate_limited" ? 429 : 400);
  const comment = await env.DB.prepare("SELECT id FROM community_comments WHERE id = ? AND status <> 'hidden'").bind(commentId).first();
  if (!comment) return json({ error: { code: "NOT_FOUND", message: "글을 찾을 수 없습니다." } }, 404);
  try {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO community_reports (id, comment_id, reporter_hash, reason, status, created_at) VALUES (?, ?, ?, ?, 'open', ?)").bind(crypto.randomUUID(), commentId, hash, parsed.value.reason, Date.now()),
      env.DB.prepare("UPDATE community_comments SET report_count = report_count + 1, status = CASE WHEN report_count + 1 >= 3 THEN 'hidden' ELSE status END, updated_at = ? WHERE id = ?").bind(Date.now(), commentId),
    ]);
  } catch { return json({ error: { code: "CONFLICT", message: "이미 신고했거나 신고를 처리하지 못했습니다." } }, 409); }
  return json({ reported: true });
}

async function reactToComment(request, env, commentId) {
  const hash = await actorHash(request, env);
  const rate = await consumeRateLimit(env, hash, "reaction_count");
  if (!rate.ok) return json({ error: { code: rate.reason === "rate_limited" ? "RATE_LIMITED" : "SESSION_REQUIRED", message: rate.reason === "rate_limited" ? "공감 한도를 초과했습니다." : "공감을 누르려면 익명 세션이 필요합니다." } }, rate.reason === "rate_limited" ? 429 : 400);
  const comment = await env.DB.prepare("SELECT id FROM community_comments WHERE id = ? AND status = 'published'").bind(commentId).first();
  if (!comment) return json({ error: { code: "NOT_FOUND", message: "글을 찾을 수 없습니다." } }, 404);
  const existing = await env.DB.prepare("SELECT comment_id FROM community_reactions WHERE comment_id = ? AND actor_hash = ?").bind(commentId, hash).first();
  if (existing) await env.DB.prepare("DELETE FROM community_reactions WHERE comment_id = ? AND actor_hash = ?").bind(commentId, hash).run();
  else await env.DB.prepare("INSERT INTO community_reactions (comment_id, actor_hash, created_at) VALUES (?, ?, ?)").bind(commentId, hash, Date.now()).run();
  const count = await env.DB.prepare("SELECT COUNT(*) AS count FROM community_reactions WHERE comment_id = ?").bind(commentId).first();
  return json({ reacted: !existing, reactionCount: Number(count?.count ?? 0) });
}

async function handleSelfCheck(request, env) {
  const hash = await actorHash(request, env);
  if (!hash) return json({ error: { code: "SESSION_REQUIRED", message: "자가점검 결과를 저장하려면 익명 세션이 필요합니다." } }, 400);
  if (request.method === "GET") {
    const saved = await env.DB.prepare("SELECT answers_json AS answers, type_code AS typeCode, scores_json AS scores, updated_at AS updatedAt FROM self_check_results WHERE actor_hash = ?").bind(hash).first();
    if (!saved) return json({ result: null });
    try { return json({ result: { answers: JSON.parse(saved.answers), typeCode: saved.typeCode, scores: JSON.parse(saved.scores), updatedAt: Number(saved.updatedAt) } }); }
    catch { return json({ result: null }); }
  }
  if (request.method !== "POST") return json({ error: { code: "METHOD_NOT_ALLOWED", message: "GET 또는 POST만 허용됩니다." } }, 405);
  const parsed = validateSelfCheckPayload(await readJson(request));
  if (!parsed.ok) return json({ error: { code: "INVALID_REQUEST", message: parsed.error } }, 400);
  const result = calculateReaderType(parsed.value.answers);
  const now = Date.now();
  await env.DB.prepare(`
    INSERT INTO self_check_results (actor_hash, answers_json, type_code, scores_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(actor_hash) DO UPDATE SET answers_json = excluded.answers_json, type_code = excluded.type_code, scores_json = excluded.scores_json, updated_at = excluded.updated_at
  `).bind(hash, JSON.stringify(parsed.value.answers), result.code, JSON.stringify(result.scores), now, now).run();
  return json({ result: { answers: parsed.value.answers, typeCode: result.code, scores: result.scores, updatedAt: now } });
}

async function adminRequest(request, env, path, isAdmin) {
  if (!isAdmin) return json({ error: { code: "UNAUTHORIZED", message: "관리자 인증이 필요합니다." } }, 401);
  if (path === "/api/admin/community/reports" && request.method === "GET") {
    const result = await env.DB.prepare("SELECT id, comment_id AS commentId, reason, status, created_at AS createdAt FROM community_reports WHERE status = 'open' ORDER BY created_at ASC LIMIT 100").all();
    return json({ reports: rows(result) });
  }
  const match = path.match(/^\/api\/admin\/community\/comments\/([^/]+)$/);
  if (match && request.method === "PUT") {
    const id = safeId(match[1]);
    const payload = await readJson(request);
    const status = String(payload?.status ?? "");
    if (!id || !["published", "hidden"].includes(status)) return json({ error: { code: "INVALID_REQUEST", message: "상태는 published 또는 hidden이어야 합니다." } }, 400);
    const result = await env.DB.prepare("UPDATE community_comments SET status = ?, updated_at = ? WHERE id = ?").bind(status, Date.now(), id).run();
    return json({ updated: Number(result?.meta?.changes ?? 0) > 0 });
  }
  return json({ error: { code: "NOT_FOUND", message: "커뮤니티 관리 경로를 찾을 수 없습니다." } }, 404);
}

export async function handleCommunityRequest(request, env = {}, { isAdmin = false } = {}) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/")) return null;
  if (!dbReady(env)) return json({ error: { code: "UNAVAILABLE", message: "커뮤니티 저장소가 아직 준비되지 않았습니다." } }, 503);
  if (!sameOrigin(request)) return json({ error: { code: "FORBIDDEN", message: "허용된 사이트에서 보낸 요청만 처리합니다." } }, 403);
  if (url.pathname.startsWith("/api/admin/community/")) return adminRequest(request, env, url.pathname, isAdmin);
  if (url.pathname === "/api/community/session" && request.method === "GET") {
    const existing = cookieValue(request, "af_session");
    const session = existing && /^[A-Za-z0-9-]{20,80}$/.test(existing) ? existing : crypto.randomUUID();
    return json({ ready: true }, 200, { "set-cookie": `af_session=${encodeURIComponent(session)}; Max-Age=31536000; Path=/; SameSite=Lax; Secure; HttpOnly` });
  }
  if (url.pathname === "/api/self-check") return handleSelfCheck(request, env);
  if (url.pathname === "/api/community" && request.method === "GET") {
    const sort = url.searchParams.get("sort") === "hot" ? "hot" : "new";
    const limitValue = Number(url.searchParams.get("limit") ?? 20);
    const limit = Number.isInteger(limitValue) ? Math.min(Math.max(limitValue, 1), 50) : 20;
    const cursor = sort === "new" ? safeCursor(url.searchParams.get("cursor")) : null;
    return json(await loadCommunity(env, request, sort, cursor, limit));
  }
  if (url.pathname === "/api/community" && request.method === "POST") {
    const payload = await readJson(request);
    const issueId = safeId(payload?.issueId);
    if (!issueId) return json({ error: { code: "INVALID_REQUEST", message: "글을 연결할 의제를 선택해 주세요." } }, 400);
    return createComment(request, env, issueId, null, payload);
  }
  const replyMatch = url.pathname.match(/^\/api\/community\/([^/]+)\/replies$/);
  if (replyMatch && request.method === "POST") {
    const parentId = safeId(replyMatch[1]);
    if (!parentId) return json({ error: { code: "INVALID_REQUEST", message: "답글 대상을 확인해 주세요." } }, 400);
    const parent = await env.DB.prepare("SELECT issue_id AS issueId FROM community_comments WHERE id = ? AND parent_id IS NULL AND status = 'published'").bind(parentId).first();
    if (!parent) return json({ error: { code: "NOT_FOUND", message: "답글 대상을 찾을 수 없습니다." } }, 404);
    const payload = await readJson(request);
    return createComment(request, env, parent.issueId, parentId, { ...(payload ?? {}), parentId });
  }
  const reactionMatch = url.pathname.match(/^\/api\/community\/([^/]+)\/react$/);
  if (reactionMatch && request.method === "POST") {
    const id = safeId(reactionMatch[1]);
    return id ? reactToComment(request, env, id) : json({ error: { code: "INVALID_REQUEST", message: "글 ID를 확인해 주세요." } }, 400);
  }
  const issueMatch = url.pathname.match(/^\/api\/issues\/([^/]+)\/community$/);
  if (issueMatch) {
    const issueId = safeId(issueMatch[1]);
    if (!issueId) return json({ error: { code: "INVALID_REQUEST", message: "이슈 ID를 확인해 주세요." } }, 400);
    if (request.method === "GET") return json({ comments: await loadCommentsByIssue(env, issueId, await actorHash(request, env)) });
    if (request.method === "POST") return createComment(request, env, issueId);
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "GET 또는 POST만 허용됩니다." } }, 405);
  }
  const reportMatch = url.pathname.match(/^\/api\/(?:comments|community)\/([^/]+)\/report$/);
  if (reportMatch && request.method === "POST") {
    const commentId = safeId(reportMatch[1]);
    if (!commentId) return json({ error: { code: "INVALID_REQUEST", message: "글 ID를 확인해 주세요." } }, 400);
    return reportComment(request, env, commentId);
  }
  return null;
}
