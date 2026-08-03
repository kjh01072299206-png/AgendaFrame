"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const SCREENS = [
  { tail: "", label: "사안 개요", says: "무슨 일이 있었고 무엇이 공통인가" },
  { tail: "/outlets", label: "언론사 비교", says: "매체가 어디에서 갈라지는가" },
  { tail: "/framing", label: "프레이밍 분석", says: "다섯 층위를 하나씩 본다" },
  { tail: "/report", label: "리포트", says: "읽을 수 있는 한 편의 글로 본다" },
];

export function IssueSubject({
  issueId,
  rank,
  title,
  lead,
  category,
  articleCount,
  outletCount,
  evidenceCount,
  splitDimensions,
}: {
  issueId: string;
  rank: number;
  title: string;
  lead: string | null;
  category: string | null;
  articleCount: number;
  outletCount: number;
  evidenceCount: number;
  splitDimensions: number;
}) {
  const pathname = usePathname() ?? "";
  const base = `/issues/${encodeURIComponent(issueId)}`;
  const active =
    SCREENS.slice().reverse().find((screen) => screen.tail && pathname.endsWith(screen.tail)) ?? SCREENS[0];

  return (
    <>
      <section className="afs-subject">
        <span className="afs-subject-rank" aria-label={`보도량 ${rank}위`}>
          {String(rank).padStart(2, "0")}
        </span>
        <h1>{title}</h1>
        {lead ? <p className="afs-subject-lead">{lead}</p> : null}
        <div className="afs-subject-chips">
          {category ? <span className="afs-chip afs-chip-brand">{category}</span> : null}
          <span className="afs-chip afs-num">기사 {articleCount}건</span>
          <span className="afs-chip afs-num">매체 {outletCount}곳</span>
          <span className="afs-chip afs-num">본문 근거 {evidenceCount}건</span>
          <span className="afs-chip afs-chip-good afs-num">다섯 층위 중 {splitDimensions}곳에서 갈림</span>
        </div>
      </section>

      <nav className="afs-tabs" aria-label="이 의제의 화면">
        {SCREENS.map((screen) => (
          <Link
            key={screen.label}
            href={`${base}${screen.tail}`}
            aria-current={screen.label === active.label ? "page" : undefined}
          >
            <b>{screen.label}</b>
            <small>{screen.says}</small>
          </Link>
        ))}
      </nav>
    </>
  );
}
