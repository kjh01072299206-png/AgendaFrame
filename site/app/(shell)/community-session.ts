"use client";

/* 커뮤니티·자가점검 API 는 워커(+D1) 쪽에 있다. 그 오리진이 아직 새 경로를 모르는
   배포에서는 요청이 전부 404 로 떨어져 콘솔 오류만 남기므로, 배포에서 켜 줄 때만
   호출한다. 워커를 올린 뒤 NEXT_PUBLIC_COMMUNITY_API=1 을 넣으면 실데이터로 붙는다. */
export const COMMUNITY_API_ENABLED = process.env.NEXT_PUBLIC_COMMUNITY_API === "1";

let sessionReady: Promise<void> | null = null;

function localSessionId() {
  const key = "agendaframe-community-session";
  try {
    const current = window.localStorage.getItem(key);
    if (current) return current;
    const created = crypto.randomUUID();
    window.localStorage.setItem(key, created);
    return created;
  } catch {
    return crypto.randomUUID();
  }
}

async function ensureSession() {
  if (!sessionReady) {
    sessionReady = fetch("/api/community/session", { credentials: "same-origin", cache: "no-store" })
      .then(() => undefined)
      .catch(() => undefined);
  }
  await sessionReady;
}

export async function communityFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  await ensureSession();
  const headers = new Headers(init.headers);
  headers.set("x-af-session", localSessionId());
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  return fetch(input, { ...init, headers, credentials: "same-origin" });
}
