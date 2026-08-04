"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

/* 셸이 공유 레이아웃이라, 홈에서 의제 카드를 누르면 스크롤 위치가 그대로 남는다.
   모바일(390px)에서는 그 탓에 착지 지점이 y≈980 이고, 59px 고정 바가 섹션 제목을
   완전히 덮어 "무엇을 보고 있는 화면인지"가 사라진다. 경로가 바뀌면 위로 올린다.
   해시 이동(층위 레일)은 건드리지 않는다. */
export function ScrollTop() {
  const pathname = usePathname();
  useEffect(() => {
    if (window.location.hash) return;
    window.scrollTo({ top: 0, left: 0 });
  }, [pathname]);
  return null;
}
