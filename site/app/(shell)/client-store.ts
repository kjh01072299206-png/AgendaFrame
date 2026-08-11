"use client";

import { useSyncExternalStore } from "react";

/* localStorage 는 React 밖의 상태다. 효과 안에서 setState 로 끌어오면 렌더가 한 번 더
   돌고(react-hooks/set-state-in-effect) 서버 렌더와도 어긋난다. 외부 저장소로 읽는다. */

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  window.addEventListener("storage", onChange);
  // 저장값이 없으면 OS 설정을 따르므로 그 변화도 구독해야 버튼 라벨이 맞는다
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
    media.removeEventListener("change", onChange);
  };
}

/** 사이트 데이터 차단·프라이빗 모드에서는 게터 자체가 던진다. 렌더 중 호출되므로 반드시 감싼다. */
function readLocal(key: string) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeLocal(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* 저장이 막혀도 화면 상태는 갱신한다 */
  }
  emit();
}

export function clearLocal(key: string) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* 무시 */
  }
  emit();
}

/** 서버 렌더에서는 null 을 돌려주므로 하이드레이션이 어긋나지 않는다. */
export function useLocal(key: string) {
  return useSyncExternalStore(
    subscribe,
    () => readLocal(key),
    () => null,
  );
}

export type Theme = "light" | "dark";

export function useTheme(): Theme | null {
  return useSyncExternalStore(
    subscribe,
    () => {
      const stored = readLocal("afs-theme");
      if (stored === "light" || stored === "dark") return stored;
      try {
        return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
      } catch {
        return "light";
      }
    },
    () => null,
  );
}

export function setTheme(next: Theme) {
  // writeLocal 이 emit 까지 하므로 먼저 부른다 — 순서가 뒤면 저장 실패 때 화면만 바뀌고 상태가 안 바뀐다
  writeLocal("afs-theme", next);
  document.documentElement.dataset.theme = next;
}
