"use client";

import Link from "next/link";
import { useLocal, writeLocal } from "./client-store";

/* 찜한 의제는 이 브라우저에만 둔다. 계정을 만들지 않는 서비스이므로 서버로 보낼 신원이 없고,
   보낼 이유도 없다 — 무엇에 관심이 있는지는 읽기 기록보다 민감하다. */

const KEY = "afs-saved-issues";

type Saved = { id: string; title: string; at: string };

function read(raw: string | null): Saved[] {
  try {
    const parsed = JSON.parse(raw ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (row): row is Saved => Boolean(row) && typeof row.id === "string" && typeof row.title === "string",
    );
  } catch {
    return [];
  }
}

export function useSavedIssues() {
  return read(useLocal(KEY));
}

/** 찜하기 토글. 서버 렌더에서는 useLocal 이 null 이라 항상 '찜하기' 로 그려지고 하이드레이션이 맞는다. */
export function SaveIssueButton({
  issueId,
  title,
  compact = false,
}: {
  issueId: string;
  title: string;
  compact?: boolean;
}) {
  const saved = useSavedIssues();
  const on = saved.some((row) => row.id === issueId);

  const say = on ? "찜 해제" : "찜하기";
  return (
    <button
      type="button"
      className={`afs-save${on ? " on" : ""}${compact ? " compact" : ""}`}
      aria-pressed={on}
      // 화면에서 숨긴 글자 span 은 폭이 부모를 넘어 넘침 검사에 걸린다. 라벨로 준다.
      aria-label={compact ? say : undefined}
      onClick={() => {
        const next = on
          ? saved.filter((row) => row.id !== issueId)
          : // 최근 찜한 것이 위로 오게 앞에 넣는다
            [{ id: issueId, title, at: new Date().toISOString() }, ...saved.filter((row) => row.id !== issueId)];
        writeLocal(KEY, JSON.stringify(next));
      }}
    >
      <span aria-hidden="true">{on ? "★" : "☆"}</span>
      {compact ? null : say}
    </button>
  );
}

/** 찜한 의제 목록. 하나도 없으면 아무것도 그리지 않는다 — 빈 카드는 화면만 늘린다. */
export function SavedIssueList() {
  const saved = useSavedIssues();
  if (!saved.length) return null;
  return (
    <section className="afs-card">
      <h2>
        찜한 의제
        <small className="afs-num">{saved.length}건</small>
      </h2>
      <div className="afs-in">
        <ul className="afs-saved-list">
          {saved.map((row) => (
            <li key={row.id}>
              <Link href={`/issues/${encodeURIComponent(row.id)}/framing`}>{row.title}</Link>
              <SaveIssueButton issueId={row.id} title={row.title} compact />
            </li>
          ))}
        </ul>
      </div>
      <p className="afs-foot">이 브라우저에만 저장됩니다. 서버로 보내지 않습니다.</p>
    </section>
  );
}
