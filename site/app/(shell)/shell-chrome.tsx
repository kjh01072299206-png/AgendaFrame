"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { safeDecode } from "../../lib/initial-five/derive";
import { setTheme, useTheme } from "./client-store";
import { ScrollTop } from "./scroll-top";

export interface ShellIssue {
  issueId: string;
  rank: number;
  title: string;
  category: string | null;
}

export interface ShellMeta {
  basisDate: string;
  articleCount: number;
  outletCount: number;
  issueCount: number;
}

const ICON: Record<string, string> = {
  home: "M3 10.4 12 3l9 7.4V21H3zM9 21v-7h6v7",
  compass: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18m3.5 5.5-2.1 5.4-5.4 2.1 2.1-5.4z",
  outlets: "M4 5h6v14H4zM14 5h6v6h-6zM14 13h6v6h-6z",
  layers: "M12 3 3 8l9 5 9-5zM3 13l9 5 9-5",
  check: "M9 12.5 11.5 15 16 9.5M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18",
  chat: "M4 5h16v10H9l-5 4z",
  people: "M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6m9 0a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5M2.5 19v-1.5C2.5 15 5 13.5 8 13.5s5.5 1.5 5.5 4V19m4 0v-1.2c0-1.7-1.2-3-3-3.4",
  report: "M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h5",
  book: "M4 5.5C4 4.7 4.7 4 5.5 4H11v16H5.5C4.7 20 4 19.3 4 18.5zM20 5.5c0-.8-.7-1.5-1.5-1.5H13v16h5.5c.8 0 1.5-.7 1.5-1.5z",
  sun: "M12 5.5v-2m0 17v-2m6.5-6.5h2m-17 0h2m11.1-4.6 1.4-1.4M6 18l1.4-1.4m9.2 0L18 18M6 6l1.4 1.4M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7",
  moon: "M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5",
  gear: "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6m7.4 3c0-.5 0-1-.1-1.4l2-1.5-2-3.4-2.3 1a7.4 7.4 0 0 0-2.4-1.4L14.2 2.8H9.8l-.4 2.5c-.9.3-1.7.8-2.4 1.4l-2.3-1-2 3.4 2 1.5a8 8 0 0 0 0 2.8l-2 1.5 2 3.4 2.3-1c.7.6 1.5 1.1 2.4 1.4l.4 2.5h4.4l.4-2.5c.9-.3 1.7-.8 2.4-1.4l2.3 1 2-3.4-2-1.5c.1-.4.1-.9.1-1.4",
};

function Icon({ name }: { name: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICON[name]} />
    </svg>
  );
}

function currentIssueId(pathname: string, issues: ShellIssue[]) {
  const match = pathname.match(/\/issues\/([^/?#]+)/);
  const decoded = match ? safeDecode(match[1]) : null;
  if (decoded && issues.some((issue) => issue.issueId === decoded)) return decoded;
  return issues[0]?.issueId ?? "";
}

export function ShellChrome({
  fallbackIssues,
  fallbackMeta,
  children,
}: {
  fallbackIssues: ShellIssue[];
  fallbackMeta: ShellMeta;
  children: ReactNode;
}) {
  const issues = fallbackIssues;
  const meta = fallbackMeta;

  return (
    <div className="afs-shell">
      <ScrollTop />
      <a className="afs-skip" href="#afs-main">본문으로 건너뛰기</a>
      <ShellSide issues={issues} meta={meta} />
      <div className="afs-main">
        <ShellTop issues={issues} />
        <main id="afs-main" className="afs-body">{children}</main>
      </div>
    </div>
  );
}

/** 화면 안에서 의제를 바꿀 때 같은 화면에 머무르게 하려고 경로 꼬리를 보존한다. */
function issueTail(pathname: string) {
  const match = pathname.match(/\/issues\/[^/?#]+\/([a-z-]+)/);
  return match ? `/${match[1]}` : "";
}

export function ShellSide({
  issues,
  meta,
}: {
  issues: ShellIssue[];
  meta: ShellMeta;
}) {
  const pathname = usePathname() ?? "/";
  const issueId = currentIssueId(pathname, issues);
  const scoped = (tail: string) => `/issues/${encodeURIComponent(issueId)}${tail}`;

  const groups: Array<{ label: string | null; items: Array<{ href: string; label: string; icon: string; match: (p: string) => boolean }> }> = [
    {
      label: null,
      items: [{ href: "/", label: "오늘의 의제", icon: "home", match: (p) => p === "/" || p === "/issues" }],
    },
    /* 무슨 일이었나 → 언론사 비교 → 프레이밍 분석 → 리포트 는 한 의제를 읽는 순서다.
       언론사 비교는 세는 것(인용원·인용 방식·형태소), 프레이밍 분석은 이론에 붙은 층위를 맡는다.
       두 화면이 같아 보였던 것은 같은 행렬을 두 번 그렸기 때문이고, 이제 하는 일이 다르다. */
    {
      label: "이 의제 안에서",
      items: [
        { href: scoped(""), label: "무슨 일이었나", icon: "layers", match: (p) => /^\/issues\/[^/]+$/.test(p) },
        { href: scoped("/outlets"), label: "언론사 비교", icon: "outlets", match: (p) => p.endsWith("/outlets") },
        { href: scoped("/framing"), label: "프레이밍 분석", icon: "compass", match: (p) => p.endsWith("/framing") },
        { href: scoped("/report"), label: "리포트", icon: "report", match: (p) => p.endsWith("/report") },
      ],
    },
    {
      label: "도구",
      items: [
        { href: "/tools/self-check", label: "내 읽기 유형", icon: "check", match: (p) => p.startsWith("/tools/self-check") },
        { href: "/tools/ask", label: "AI 대화", icon: "chat", match: (p) => p.startsWith("/tools/ask") },
        { href: "/tools/community", label: "커뮤니티", icon: "people", match: (p) => p.startsWith("/tools/community") },
        { href: "/tools/method", label: "방법론", icon: "book", match: (p) => p.startsWith("/tools/method") },
        { href: "/tools/settings", label: "설정", icon: "gear", match: (p) => p.startsWith("/tools/settings") },
      ],
    },
  ];

  return (
    <aside className="afs-side">
      <Link className="afs-brand" href="/">
        <i aria-hidden="true">AF</i>
        <b>
          AgendaFrame
          <small>같은 사건, 다른 설명</small>
        </b>
      </Link>
      <nav className="afs-nav" aria-label="주요 화면">
        {groups.map((group, gi) => (
          <div
            key={group.label ?? `g${gi}`}
            className="afs-nav-sec"
            role="group"
            aria-labelledby={group.label ? `afs-grp-${gi}` : undefined}
          >
            {group.label ? (
              <h2 className="afs-nav-group" id={`afs-grp-${gi}`}>
                {group.label}
              </h2>
            ) : null}
            {group.items.map((item) => (
              <Link key={item.href + item.label} href={item.href} aria-current={item.match(pathname) ? "page" : undefined}>
                <Icon name={item.icon} />
                {item.label}
              </Link>
            ))}
          </div>
        ))}
      </nav>
      <div className="afs-side-foot">
        <dl>
          <dt>기준일</dt>
          <dd className="afs-num">{meta.basisDate}</dd>
          <dt>의제</dt>
          <dd className="afs-num">{meta.issueCount}건</dd>
          <dt>기사</dt>
          <dd className="afs-num">{meta.articleCount}건</dd>
          <dt>매체</dt>
          <dd className="afs-num">{meta.outletCount}곳</dd>
        </dl>
      </div>
    </aside>
  );
}

export function ShellTop({ issues }: { issues: ShellIssue[] }) {
  const pathname = usePathname() ?? "/";
  const router = useRouter();
  const issueId = currentIssueId(pathname, issues);
  const tail = issueTail(pathname);
  const theme = useTheme();
  const [picked, setPicked] = useState(issueId);
  // 경로로 의제가 바뀌면 선택도 따라간다 — 초기값만 받으면 Link 이동 뒤 낡은 값이 남아
  // '이 의제 보기'가 이전 의제로 되돌린다 (렌더 중 상태 재조정 패턴, useEffect 불필요)
  const [prevIssueId, setPrevIssueId] = useState(issueId);
  if (prevIssueId !== issueId) {
    setPrevIssueId(issueId);
    setPicked(issueId);
  }
  const flip = () => setTheme(theme === "dark" ? "light" : "dark");

  return (
    <div className="afs-top">
      <label className="afs-top-label" htmlFor="afs-issue">
        의제
      </label>
      <select
        id="afs-issue"
        value={picked}
        onChange={(event) => {
          const next = event.target.value;
          setPicked(next);
          router.push(`/issues/${encodeURIComponent(next)}${tail || ""}`);
        }}
      >
        {issues.map((issue) => (
          <option key={issue.issueId} value={issue.issueId}>
            {issue.rank}위 · {issue.title}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="afs-pill afs-pill-go"
        onClick={() => router.push(`/issues/${encodeURIComponent(picked)}${tail || ""}`)}
      >
        이 의제 보기
      </button>
      <button type="button" className="afs-pill" onClick={flip}>
        <Icon name={theme === "dark" ? "sun" : "moon"} />
        {theme === "dark" ? "밝게 보기" : "어둡게 보기"}
      </button>
    </div>
  );
}
