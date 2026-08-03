"use client";

import { useSyncExternalStore } from "react";

/* localStorage 는 React 밖의 상태다. 효과 안에서 setState 로 끌어오면 렌더가 한 번 더
   돌고(react-hooks/set-state-in-effect) 서버 렌더와도 어긋난다. 외부 저장소로 읽는다. */

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function writeLocal(key: string, value: string) {
  window.localStorage.setItem(key, value);
  emit();
}

/** 서버 렌더에서는 null 을 돌려주므로 하이드레이션이 어긋나지 않는다. */
export function useLocal(key: string) {
  return useSyncExternalStore(
    subscribe,
    () => window.localStorage.getItem(key),
    () => null,
  );
}

export type Theme = "light" | "dark";

export function useTheme(): Theme | null {
  return useSyncExternalStore(
    subscribe,
    () => {
      const stored = window.localStorage.getItem("afs-theme");
      if (stored === "light" || stored === "dark") return stored;
      return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    },
    () => null,
  );
}

export function setTheme(next: Theme) {
  document.documentElement.dataset.theme = next;
  writeLocal("afs-theme", next);
}
