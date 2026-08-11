"use client";

import Link from "next/link";
import { clearLocal, setTheme, useLocal, useTheme } from "../../client-store";
import { useSavedIssues } from "../../saved-issues";

/* 이 브라우저에 쌓인 것만 다룬다. 찜한 의제·읽기 유형·응답·커뮤니티 임시 글은 서버로 보내지
   않으므로, 지우는 버튼도 여기에 있어야 한다 — 계정이 없어 다른 곳에서 지울 방법이 없다. */

const STORES: Array<{ key: string; label: string; describe: (raw: string | null) => string }> = [
  {
    key: "afs-reader-type",
    label: "읽기 유형 결과",
    describe: (raw) => (raw ? `저장됨 (${raw.slice(0, 4)})` : "없음"),
  },
  {
    key: "afs-reader-answers",
    label: "자가점검 응답",
    describe: (raw) => {
      if (!raw) return "없음";
      try {
        const parsed = JSON.parse(raw);
        const count = Object.values(parsed ?? {}).filter((value) => value !== null && value !== undefined).length;
        return `${count}문항`;
      } catch {
        return "저장됨";
      }
    },
  },
  {
    key: "afs-community-local-v1",
    label: "이 브라우저에 남은 커뮤니티 글",
    describe: (raw) => {
      if (!raw) return "없음";
      try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? `${parsed.length}건` : "저장됨";
      } catch {
        return "저장됨";
      }
    },
  },
];

function Row({ store }: { store: (typeof STORES)[number] }) {
  const raw = useLocal(store.key);
  return (
    <div className="afs-set-row">
      <span>{store.label}</span>
      <span className="afs-num">{store.describe(raw)}</span>
      <button type="button" className="afs-btn afs-btn-ghost" disabled={!raw} onClick={() => clearLocal(store.key)}>
        지우기
      </button>
    </div>
  );
}

export function SettingsClient() {
  const theme = useTheme();
  const saved = useSavedIssues();

  return (
    <>
      <section className="afs-card">
        <h2>화면</h2>
        <div className="afs-in">
          <div className="afs-set-row">
            <span>밝기</span>
            <span>{theme === "dark" ? "어둡게" : theme === "light" ? "밝게" : "기기 설정"}</span>
            <button type="button" className="afs-btn" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
              {theme === "dark" ? "밝게 보기" : "어둡게 보기"}
            </button>
          </div>
          <div className="afs-set-row">
            <span>밝기 저장값</span>
            <span className="afs-num">{theme ? "저장됨" : "없음"}</span>
            <button type="button" className="afs-btn afs-btn-ghost" onClick={() => clearLocal("afs-theme")}>
              기기 설정 따르기
            </button>
          </div>
        </div>
      </section>

      <section className="afs-card">
        <h2>
          찜한 의제
          <small className="afs-num">{saved.length}건</small>
        </h2>
        <div className="afs-in">
          {saved.length ? (
            <ul className="afs-saved-list">
              {saved.map((row) => (
                <li key={row.id}>
                  <Link href={`/issues/${encodeURIComponent(row.id)}`}>{row.title}</Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="afs-hold">의제 화면의 ☆ 를 누르면 여기 모입니다.</p>
          )}
          {saved.length ? (
            <div className="afs-set-row">
              <span>전부 지우기</span>
              <span />
              <button type="button" className="afs-btn afs-btn-ghost" onClick={() => clearLocal("afs-saved-issues")}>
                지우기
              </button>
            </div>
          ) : null}
        </div>
      </section>

      <section className="afs-card">
        <h2>이 브라우저에 저장된 것</h2>
        <div className="afs-in">
          {STORES.map((store) => (
            <Row key={store.key} store={store} />
          ))}
        </div>
        <p className="afs-foot">찜한 의제 · 읽기 유형 · 자가점검 응답은 서버로 보내지 않습니다.</p>
      </section>
    </>
  );
}
