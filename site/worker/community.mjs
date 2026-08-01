const WINDOW_MS = 15 * 60 * 1000;
const MAX_COMMENT_LENGTH = 1000;
const MAX_DISPLAY_NAME_LENGTH = 40;
const MAX_REPORT_REASON_LENGTH = 200;

function json(body, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

function dbReady(env) {
  return env?.DB && typeof env.DB.prepare === "function" && typeof env.DB.batch === "function";
}

function rows(result) {
  return Array.isArray(result?.results) ? result.results : [];
}

function safeId(value, maximum = 128) {
  const id = decodeURIComponent(String(value ?? "")).trim();
  return id && id.length <= maximum && /^[A-Za-z0-9._:-]+$/.test(id) ? id : null;
}

function needsModeration(body) {
  return /[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|\b\d{2,3}[- .]\d{3,4}[- .]\d{4}\b/u.test(body);
}

export function validateCommentPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return { ok: false, error: "댓글 형식이 올바르지 않습니다." };
  const body = String(payload.body ?? "").trim();
  const displayName = String(payload.displayName ?? "익명 독자").trim();
  const parentId = payload.parentId == null ? null : safeId(payload.parentId);
  if (!body || body.length > MAX_COMMENT_LENGTH) return { ok: false, error: `댓글은 1~${MAX_COMMENT_LENGTH}자로 작성해 주세요.` };
  if (!displayName || displayName.length > MAX_DISPLAY_NAME_LENGTH) return { ok: false, error: `표시 이름은 1~${MAX_DISPLAY_NAME_LENGTH}자로 입력해 주세요.` };
  if (payload.parentId != null && !parentId) return { ok: false, error: "답글 대상을 확인해 주세요." };
  return { ok: true, value: { body, displayName, parentId } };
}

export function validateReportPayload(payload) {
  const reason = String(payload?.reason ?? "스팸·모욕·개인정보 등 부적절한 내용").trim();
  if (!reason || reason.length > MAX_REPORT_REASON_LENGTH) return { ok: false, error: `신고 사유는 1~${MAX_REPORT_REASON_LENGTH}자로 입력해 주세요.` };
  return { ok: true, value: { reason } };
}

async function actorHash(request, env) {
  const raw = String(request.headers.get("x-af-session") ?? "").trim().slice(0, 160);
  if (!raw) return null;
  const salt = String(env?.COMMUNITY_HASH_SALT ?? "agenda-community-session");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${salt}:${raw}`));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function sameOrigin(request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

async function readJson(request) {
  try {
    const length = Number(request.headers.get("content-length") ?? 0);
    if (length > 32_000) return null;
    return await request.json();
  } catch {
    return null;
  }
}

async function consumeRateLimit(env, hash, field, now = Date.now()) {
  if (!hash) return { ok: false, reason: "session_required" };
  const windowStart = Math.floor(now / WINDOW_MS) * WINDOW_MS;
  const limit = field === "comment_count" ? 5 : 10;
  const existing = await env.DB.prepare("SELECT comment_count, report_count FROM community_rate_limits WHERE actor_hash = ? AND window_start = ?").bind(hash, windowStart).first();
  const count = Number(existing?.[field] ?? 0);
  if (count >= limit) return { ok: false, reason: "rate_limited" };
  const next = field === "comment_count" ? [count + 1, Number(existing?.report_count ?? 0)] : [Number(existing?.comment_count ?? 0), count + 1];
  await env.DB.prepare(`
    INSERT INTO community_rate_limits (actor_hash, window_start, comment_count, report_count, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(actor_hash, window_start) DO UPDATE SET
      comment_count = excluded.comment_count,
      report_count = excluded.report_count,
      updated_at = excluded.updated_at
  `).bind(hash, windowStart, next[0], next[1], now).run();
  return { ok: true };
}

async function listComments(env, issueId) {
  const result = await env.DB.prepare(`
    SELECT id, issue_id AS issueId, parent_id AS parentId, display_name AS displayName,
      body, status, report_count AS reportCount, created_at AS createdAt, updated_at AS updatedAt
    FROM community_comments
    WHERE issue_id = ? AND status = 'published'
    ORDER BY created_at ASC, id ASC
    LIMIT 200
  `).bind(issueId).all();
  return rows(result).map((row) => ({ ...row, reportCount: undefined }));
}

async function createComment(request, env, issueId) {
  const payload = await readJson(request);
  const parsed = validateCommentPayload(payload);
  if (!parsed.ok) return json({ error: { code: "INVALID_REQUEST", message: parsed.error } }, 400);
  const hash = await actorHash(request, env);
  const rate = await consumeRateLimit(env, hash, "comment_count");
  if (!rate.ok) return json({ error: { code: rate.reason === "rate_limited" ? "RATE_LIMITED" : "SESSION_REQUIRED", message: rate.reason === "rate_limited" ? "댓글 작성 한도를 초과했습니다. 잠시 후 다시 시도해 주세요." : "댓글을 작성하려면 익명 세션이 필요합니다." } }, rate.reason === "rate_limited" ? 429 : 400);
  const issue = await env.DB.prepare("SELECT id FROM issues WHERE id = ? LIMIT 1").bind(issueId).first();
  if (!issue) return json({ error: { code: "NOT_FOUND", message: "이슈를 찾을 수 없습니다." } }, 404);
  if (parsed.value.parentId) {
    const parent = await env.DB.prepare("SELECT id FROM community_comments WHERE id = ? AND issue_id = ? AND status = 'published'").bind(parsed.value.parentId, issueId).first();
    if (!parent) return json({ error: { code: "INVALID_REQUEST", message: "답글 대상을 찾을 수 없습니다." } }, 400);
  }
  const id = crypto.randomUUID();
  const now = Date.now();
  const status = needsModeration(parsed.value.body) ? "pending" : "published";
  await env.DB.prepare(`
    INSERT INTO community_comments (id, issue_id, parent_id, actor_hash, display_name, body, status, report_count, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
  `).bind(id, issueId, parsed.value.parentId, hash, parsed.value.displayName, parsed.value.body, status, now, now).run();
  return json({ comment: { id, issueId, parentId: parsed.value.parentId, displayName: parsed.value.displayName, body: parsed.value.body, status, createdAt: now, updatedAt: now }, notice: status === "pending" ? "개인정보로 보일 수 있는 내용이 있어 검토 후 공개됩니다." : null }, 201);
}

async function reportComment(request, env, commentId) {
  const payload = await readJson(request);
  const parsed = validateReportPayload(payload);
  if (!parsed.ok) return json({ error: { code: "INVALID_REQUEST", message: parsed.error } }, 400);
  const hash = await actorHash(request, env);
  const rate = await consumeRateLimit(env, hash, "report_count");
  if (!rate.ok) return json({ error: { code: rate.reason === "rate_limited" ? "RATE_LIMITED" : "SESSION_REQUIRED", message: rate.reason === "rate_limited" ? "신고 한도를 초과했습니다." : "신고하려면 익명 세션이 필요합니다." } }, rate.reason === "rate_limited" ? 429 : 400);
  const comment = await env.DB.prepare("SELECT id FROM community_comments WHERE id = ? AND status <> 'hidden'").bind(commentId).first();
  if (!comment) return json({ error: { code: "NOT_FOUND", message: "댓글을 찾을 수 없습니다." } }, 404);
  try {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO community_reports (id, comment_id, reporter_hash, reason, status, created_at) VALUES (?, ?, ?, ?, 'open', ?)").bind(crypto.randomUUID(), commentId, hash, parsed.value.reason, Date.now()),
      env.DB.prepare("UPDATE community_comments SET report_count = report_count + 1, status = CASE WHEN report_count + 1 >= 3 THEN 'hidden' ELSE status END, updated_at = ? WHERE id = ?").bind(Date.now(), commentId),
    ]);
  } catch {
    return json({ error: { code: "CONFLICT", message: "이미 신고했거나 신고를 처리하지 못했습니다." } }, 409);
  }
  return json({ reported: true });
}

async function adminRequest(request, env, path, isAdmin) {
  if (!isAdmin) return json({ error: { code: "UNAUTHORIZED", message: "관리자 인증이 필요합니다." } }, 401);
  if (path === "/api/admin/community/reports" && request.method === "GET") {
    const result = await env.DB.prepare(`SELECT id, comment_id AS commentId, reason, status, created_at AS createdAt FROM community_reports WHERE status = 'open' ORDER BY created_at ASC LIMIT 100`).all();
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
  const issueMatch = url.pathname.match(/^\/api\/issues\/([^/]+)\/community$/);
  if (issueMatch) {
    const issueId = safeId(issueMatch[1]);
    if (!issueId) return json({ error: { code: "INVALID_REQUEST", message: "이슈 ID를 확인해 주세요." } }, 400);
    if (request.method === "GET") return json({ comments: await listComments(env, issueId) });
    if (request.method === "POST") return createComment(request, env, issueId);
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "GET 또는 POST만 허용됩니다." } }, 405);
  }
  const reportMatch = url.pathname.match(/^\/api\/comments\/([^/]+)\/report$/);
  if (reportMatch && request.method === "POST") {
    const commentId = safeId(reportMatch[1]);
    if (!commentId) return json({ error: { code: "INVALID_REQUEST", message: "댓글 ID를 확인해 주세요." } }, 400);
    return reportComment(request, env, commentId);
  }
  return null;
}
