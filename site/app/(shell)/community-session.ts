"use client";

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
