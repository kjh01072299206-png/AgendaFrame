"use client";

import Link from "next/link";
import { useState } from "react";
import { useLocal } from "../../client-store";
import { TYPES } from "../self-check/reader-type";

/* 예시 화면. 닉네임 옆에 자가점검에서 나온 읽기 유형이 붙는 구조를 보여 준다.
   내 유형은 localStorage 에 저장된 값을 읽어 상단 작성칸에 표시한다. */

interface Post {
  id: string;
  nick: string;
  type: string;
  issueRank: number;
  issueId: string;
  issueTitle: string;
  screen: string;
  body: string;
  agrees: number;
  replies: Array<{ nick: string; type: string; body: string }>;
}

const POSTS: Post[] = [
  {
    id: "p1",
    nick: "느린독자",
    type: "BDCP",
    issueRank: 1,
    issueId: "bigkinds-2026-07-26-top-1",
    issueTitle: "정점식 의원의 특검 보완수사권 주장",
    screen: "언론사 비교",
    body: "쟁점 축에서 왼쪽에 붙은 매체들은 이걸 ‘정치적 갈등’으로 정의했고, 오른쪽은 ‘제도적 견제’로 봤어요. 찬반이 아니라 문제 정의가 다른 거라 같은 기사를 읽어도 결론이 달라질 수밖에 없네요.",
    agrees: 24,
    replies: [
      { nick: "출근길뉴스", type: "HDCR", body: "제목만 봤을 때는 그냥 여야 공방으로 읽혔는데, 본문 층위로 나눠 보니 다르게 보입니다." },
      { nick: "기록자", type: "BDOR", body: "저는 한 매체만 봤어서 이 축의 반대편 설명을 아예 몰랐습니다." },
    ],
  },
  {
    id: "p2",
    nick: "세줄요약",
    type: "BMCR",
    issueRank: 3,
    issueId: "bigkinds-2026-07-26-top-3",
    issueTitle: "경산 아파트 방화·보복범죄 수사",
    screen: "프레이밍 분석",
    body: "‘해법·처방’ 층위가 거의 비어 있는 게 인상적입니다. 사건은 크게 다뤘는데 무엇을 해야 하는지는 아무 매체도 안 썼어요. 갈린 게 아니라 아예 질문이 없었던 층위네요.",
    agrees: 41,
    replies: [
      { nick: "느린독자", type: "BDCP", body: "미관측이 곧 부재는 아니지만, 네 매체가 모두 안 썼다면 그건 편집 관심의 위치를 보여 준다고 생각해요." },
    ],
  },
  {
    id: "p3",
    nick: "헤드라인러",
    type: "HMOR",
    issueRank: 2,
    issueId: "bigkinds-2026-07-26-top-2",
    issueTitle: "권영진 의원의 정점식 의원 멱살 논란",
    screen: "리포트",
    body: "자가점검 해 보니 제 유형이 제일 사각지대가 넓다고 나왔습니다. 실제로 이 사안은 제목만 보고 판단했었는데, 취재원 구성 보니까 한쪽 정당 관계자 인용이 압도적이었네요.",
    agrees: 58,
    replies: [
      { nick: "교차확인", type: "BDCR", body: "저도 같은 경험이요. 직접 인용/간접 전언 비교 화면이 제일 도움이 됐습니다." },
      { nick: "세줄요약", type: "BMCR", body: "유형 결과를 그냥 재미로 봤는데 ‘요약하면 갈린 지점이 지워진다’는 문장이 정확했어요." },
    ],
  },
  {
    id: "p4",
    nick: "야근중",
    type: "HDCP",
    issueRank: 5,
    issueId: "bigkinds-2026-07-26-top-5",
    issueTitle: "음성 외국인 집단 난투 사건",
    screen: "언론사 비교",
    body: "매체별 취재원 표에서 ‘당사자·시민’이 한 명도 없는 매체가 있습니다. 사건 당사자 없이 수사기관 발표만으로 쓴 기사와, 주변 시민 말을 넣은 기사는 같은 사건인데 온도가 다릅니다.",
    agrees: 33,
    replies: [],
  },
];

const badge = (code: string) => {
  const type = TYPES[code];
  return (
    <span className="afs-badge-type" title={type ? type.line : code}>
      <b className="afs-num">{code}</b>
      {type ? type.name : "유형 미상"}
    </span>
  );
};

export function CommunityFeed() {
  const mine = useLocal("afs-reader-type");
  const [sort, setSort] = useState<"hot" | "new">("hot");

  const posts = sort === "hot" ? POSTS.slice().sort((a, b) => b.agrees - a.agrees) : POSTS;
  const mineType = mine ? TYPES[mine] : null;

  return (
    <>
      <section className="afs-card">
        <h2>
          글 쓰기
          <span className="afs-badge-ex">예시</span>
          <small>근거를 본 화면과 함께 올립니다</small>
        </h2>
        <div className="afs-in">
          <div className="afs-compose">
            <p className="afs-compose-who">
              {mineType ? (
                <>
                  <span className="afs-chip">닉네임 미설정</span>
                  {badge(mineType.code)}
                </>
              ) : (
                <>
                  <span className="afs-chip">닉네임 미설정</span>
                  <span className="afs-chip">
                    읽기 유형 없음 ·{" "}
                    <Link className="afs-link" href="/tools/self-check">
                      자가점검하기
                    </Link>
                  </span>
                </>
              )}
            </p>
            <label className="afs-sr" htmlFor="afs-compose">
              글 내용
            </label>
            <textarea
              id="afs-compose"
              rows={3}
              placeholder="어느 화면에서 무엇을 봤는지 함께 적으면 다른 사람이 확인할 수 있습니다."
            />
            <div className="afs-compose-foot">
              <span>글에는 내가 본 의제와 화면이 자동으로 붙습니다.</span>
              <button type="button" className="afs-pill" disabled>
                올리기
              </button>
            </div>
          </div>
        </div>
        <p className="afs-foot">
          {mineType
            ? `내 유형은 ${mineType.code} ${mineType.name}입니다. 닉네임 옆에 이렇게 붙습니다.`
            : "자가점검을 먼저 하면 닉네임 옆에 읽기 유형이 붙습니다."}
        </p>
      </section>

      <section className="afs-card">
        <h2>
          최근 이야기
          <span className="afs-badge-ex">예시</span>
          <small>{POSTS.length}개</small>
        </h2>
        <div className="afs-in">
          <div className="afs-sortbar">
            <button type="button" className="afs-pill" aria-pressed={sort === "hot"} onClick={() => setSort("hot")}>
              공감순
            </button>
            <button type="button" className="afs-pill" aria-pressed={sort === "new"} onClick={() => setSort("new")}>
              최신순
            </button>
          </div>
          <ul className="afs-feed">
            {posts.map((post) => (
              <li key={post.id}>
                <div className="afs-feed-head">
                  <b>{post.nick}</b>
                  {badge(post.type)}
                  <Link className="afs-chip afs-chip-brand" href={`/issues/${encodeURIComponent(post.issueId)}`}>
                    {post.issueRank}위 {post.issueTitle}
                  </Link>
                  <span className="afs-chip">{post.screen}</span>
                </div>
                <p className="afs-feed-body">{post.body}</p>
                <div className="afs-feed-foot">
                  <span className="afs-num">공감 {post.agrees}</span>
                  <span className="afs-num">답글 {post.replies.length}</span>
                </div>
                {post.replies.length ? (
                  <ul className="afs-feed-replies">
                    {post.replies.map((reply, index) => (
                      <li key={`${post.id}-${index}`}>
                        <div className="afs-feed-head">
                          <b>{reply.nick}</b>
                          {badge(reply.type)}
                        </div>
                        <p className="afs-feed-body">{reply.body}</p>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
        <p className="afs-foot afs-foot-ex">
          <b>이 글과 공감 수는 예시입니다.</b> 실제 이용자 글이 아니라, 닉네임 옆에 읽기 유형이 붙고 본 화면이 함께 표시되는
          구조를 보여 주기 위한 것입니다. 같은 유형끼리 모이면 사각지대도 같아지므로, 다른 유형의 글을 하나씩 읽는 것이 이 탭의
          목적입니다.
        </p>
      </section>
    </>
  );
}
