"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SaveIssueButton } from "./saved-issues";

const SCREENS = [
  { tail: "", label: "무슨 일이었나", says: "사실과 갈린 지점" },
  { tail: "/outlets", label: "언론사 비교", says: "인용원 · 낱말" },
  { tail: "/framing", label: "프레이밍 분석", says: "프레임 이론 여섯 층위" },
  { tail: "/report", label: "리포트", says: "한 편의 글로 읽는다" },
];

export function IssueSubject({
  issueId,
  rank,
  title,
  lead,
  category,
  articleCount,
  outletCount,
  splitDimensions,
  splitDimensionsWithSources = 0,
  analysisPending = false,
}: {
  issueId: string;
  rank: number;
  title: string;
  lead: string | null;
  category: string | null;
  articleCount: number;
  outletCount: number;
  splitDimensions: number;
  splitDimensionsWithSources?: number;
  analysisPending?: boolean;
}) {
  const pathname = usePathname() ?? "";
  const base = `/issues/${encodeURIComponent(issueId)}`;
  const compact = pathname.endsWith("/outlets") || pathname.endsWith("/framing");
  const active =
    SCREENS.slice().reverse().find((screen) => screen.tail && pathname.endsWith(screen.tail)) ?? SCREENS[0];

  return (
    <>
      <section className={`afs-subject${compact ? " afs-subject-context" : ""}`}>
        <span className="afs-subject-rank" aria-label={`보도량 ${rank}위`}>
          {String(rank).padStart(2, "0")}
        </span>
        <h1>{title}</h1>
        {lead ? <p className="afs-subject-lead">{lead}</p> : null}
        <div className="afs-subject-chips">
          {category ? <span className="afs-chip afs-chip-brand">{category}</span> : null}
          <span className="afs-chip afs-num">기사 {articleCount}건</span>
          <span className="afs-chip afs-num">매체 {outletCount}곳</span>
          <span className="afs-chip afs-chip-good afs-num">
            {analysisPending
              ? "본문 근거 부족 · 비교 보류"
              : compact
                ? splitDimensions > 0
                  ? `기자 서술 ${splitDimensions}축에서 갈림`
                  : splitDimensionsWithSources > 0
                    ? `취재원 포함 ${splitDimensionsWithSources}축 관측`
                    : "매체 서술 갈림 미확정"
                : `다섯 층위 중 ${splitDimensions}곳에서 갈림`}
          </span>
          <SaveIssueButton issueId={issueId} title={title} />
        </div>
      </section>

      <nav className={`afs-tabs${compact ? " afs-tabs-context" : ""}`} aria-label="이 의제의 화면">
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
