import AgendaDashboard from "./agenda-dashboard";
import Link from "next/link";

export default function Home() {
  return (
    <>
      <Link className="top5-home-banner" href="/top5-2026-07-26">
        <span><b>7월 26일 상위 5개 의제</b> 본문 기반 구조화 분석을 확인하세요</span>
        <span>분석 보기 →</span>
      </Link>
      <AgendaDashboard />
    </>
  );
}
