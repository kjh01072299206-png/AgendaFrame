import { chooseRollback, DEFAULT_RELEASE_THRESHOLDS, evaluateReleaseGate, evaluateSlo, selectCanary } from "./release-guard.mjs";

function json(body, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

async function readJson(request) {
  try {
    if (Number(request.headers.get("content-length") ?? 0) > 64_000) return null;
    return await request.json();
  } catch {
    return null;
  }
}

export async function handleReleaseAdminRequest(request, env = {}, { isAdmin = false } = {}) {
  void env;
  const url = new URL(request.url);
  if (url.pathname !== "/api/admin/release/evaluate") return null;
  if (!isAdmin) return json({ error: { code: "UNAUTHORIZED", message: "관리자 인증이 필요합니다." } }, 401);
  if (request.method !== "POST") return json({ error: { code: "METHOD_NOT_ALLOWED", message: "POST만 허용됩니다." } }, 405);
  const payload = await readJson(request);
  if (!payload || typeof payload !== "object") return json({ error: { code: "INVALID_REQUEST", message: "출시 평가 입력이 필요합니다." } }, 400);
  const thresholds = payload.thresholds ?? DEFAULT_RELEASE_THRESHOLDS;
  const gate = evaluateReleaseGate({ thresholds, metrics: payload.metrics ?? {}, dataset: payload.dataset ?? {}, holdout: payload.holdout ?? {} });
  const slo = evaluateSlo({ metrics: payload.sloMetrics ?? {}, budgets: payload.sloBudgets ?? {} });
  const canary = selectCanary({ candidates: payload.candidates ?? [], trafficPercent: payload.trafficPercent ?? 5, now: payload.now ?? Date.now() });
  const rollback = chooseRollback({ current: payload.currentVersion ?? null, previous: payload.previousVersion ?? null, releaseGate: gate, slo });
  return json({ environment: "staging-first", gate, slo, canary, rollback, generatedAt: Date.now(), cloudMutation: "none" });
}
