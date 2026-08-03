# 배포 사이트를 app.html 시안 구조로 바꾸는 변경 계획

작성 2026-08-04 · 대상 배포 <https://agendaframe-capstone.vercel.app/> · 기준 시안
`tmp/claude-framing-2026-07-26/prototype/app.html`

## 1. 배경과 목표

시안 `app.html`은 사이드바 앱 셸 + 화면 8개로 구성된 구현 밑그림이다. 배포 사이트는
같은 데이터를 쓰면서도 정보 구조가 다르다 — 한 페이지에 의제 셀렉터와 30초 요약이
있고, 상세는 라우트 하나에 탭 4개, 분석 패널 28개는 `/dashboard` 한 장에 쌓여 있다.

목표는 **내용을 새로 만드는 것이 아니라 이미 있는 내용을 시안의 구조와 표현으로
재배치하는 것**이다. 색·간격·서체 토큰은 이미 양쪽이 동일하므로(`app/globals.css`의
`:root` 값이 시안과 같다) 바뀌는 것은 셸, 라우팅, 그리고 시각화 형식이다.

## 2. 현재 상태 실측

### 배포 경로

- 호스트는 Vercel, 빌드는 `next build` (`site/vercel.json`).
- `next build` 기준선은 통과한다(정적 20개, `/issues/[issueId]` 는 SSG 5경로,
  `/` 는 `searchParams` 때문에 동적).
- `/api/initial-five/{ask,issues/[id]}` 는 **Vercel 자체 라우트 핸들러로 잡힌다**
  (빌드 결과 `ƒ`). `next.config.ts` 의 fallback rewrite 는 매칭되는 라우트가 없을 때만
  발동하므로, 워커로 프록시되는 것은 `/api/chat` `/api/analyze` 같은 나머지 레거시
  경로다.
- **AI 대화는 외부 모델을 호출하지 않는다.** `app/api/initial-five/ask/route.ts` 는
  환경변수도 외부 fetch 도 쓰지 않고, 정적 아티팩트에 이미 코딩된 항목에서 질문에
  맞는 것을 골라 근거 위치와 함께 돌려준다(`provider:
  claude_analysis_grounded_retrieval_v1`). 같은 질문에 항상 같은 답이 오고, API 장애나
  키 만료로 죽지 않으며, 없는 사실을 만들 수 없다. 프로덕션에서 추천 질문 4개 중 3개가
  근거 2건과 함께 답하는 것을 확인했다(나머지 하나는 공통 사실 분기를 추가해 해결).
- 데이터는 빌드 시 `scripts/build-initial-five.mjs` 가 `public/initial-five/` 로
  구워 넣는다(매니페스트 + 의제 5개 JSON). 런타임 DB 의존이 없다.

### 정보 구조

| 라우트 | 파일 | 내용 |
| --- | --- | --- |
| `/` | `app/page.tsx` → `app/initial-five.tsx` | 의제 셀렉터 5개 + 30초 핵심 + 묶은 이유 |
| `/issues/[issueId]` | `app/issues/[issueId]/page.tsx` → `IssueDetailExperience` | 탭 4개 (`?view=summary\|framing\|outlets\|evidence`) |
| `/dashboard` | `app/agenda-dashboard.tsx` (107KB) | 분석 패널 28개 — 쟁점 구도, 두 개의 서사, 누구의 목소리, 매체별 프레임 구성, 분석축별 매체 비교, 이렇게 읽어 보세요 등 |
| `/tools` | `app/tools/page.tsx` | 도구 4개 목록 |
| `/tools/ask` | `app/evidence-chat.tsx` + `worker/evidence-chat.mjs` | **실제 RAG 대화** |
| `/tools/self-check` | `app/self-check.tsx` | 읽기 자기점검 |
| `/tools/method`, `/method` | | 방법론 |
| `/community`, `/tools/community` | `app/community-panel.tsx` | 의견 |
| `/admin` | `app/admin/admin-client.tsx` | 품질 검토 |
| `/agenda-prototype/*` (정적) | `public/agenda-prototype/` | 팀원이 올린 같은 시안의 별도 정적 프로토타입 |

### 시안과의 실제 격차

1. **셸이 없다.** 사이트는 상단 헤더 + 링크 3개. 시안은 236px 사이드바(화면 8개) +
   sticky 상단바(의제 셀렉터 + 예시 토글).
2. **`<svg>` 차트가 0개다.** `grep -c '<svg'` → `agenda-dashboard.tsx:0`,
   `initial-five.tsx:0`. 모든 시각화가 div 폭 기반 막대다. 시안의 7종(꺾은선·수평
   막대·히트맵·누적·산점도·도넛·의미연결망)은 전부 순증이다.
3. **다크 모드가 꺼져 있다.** `app/layout.tsx` 의 `viewport.colorScheme: "light"`.
4. **예시/실측 구분 장치가 없다.** 사이트는 데이터가 부족하면 섹션을 비우거나
   보류 문구를 띄운다. 시안은 예시로 채우고 배지·「실데이터 조건」 각주로 표시한다.

## 3. 화면 매핑

라우트 그룹은 URL 에 나타나지 않으므로 기존 링크·OG·정적 생성 경로가 그대로 살아 있다.

| 시안 화면 | 목적지 라우트 | 처리 |
| --- | --- | --- |
| 홈 | `/` | KPI 카드 행 신설 + 기존 30초 핵심·묶은 이유 재배치 |
| 이슈 탐색 | `/issues` (신규 목록) | 현재 홈의 셀렉터를 독립 화면으로. 필터는 예시 유지 |
| 언론사 비교 | `/issues/[id]/outlets` | 기존 `OutletsTab` + `source_lens` 막대·히트맵 |
| 프레이밍 분석 | `/issues/[id]/framing` | 기존 `SemanticFraming` + 군집·의미연결망 |
| 리포트 | `/issues/[id]/report` | `agenda-dashboard.tsx` 의 서술 패널을 의제 단위로 이동 |
| 자가점검 | `/tools/self-check` | 그대로, 셸만 적용 |
| AI 대화 | `/tools/ask` | 그대로 (실제 API). 시안의 근거 chip·추천 질문·답변 제한 표현을 채택 |
| 구현 명세 | — | 사이트에 넣지 않는다. 내부 문서로만 유지 |

기존 `?view=` 쿼리 탭은 새 경로로 301 없이 유지한다(`/issues/[id]?view=framing` →
`/issues/[id]/framing` 로 클라이언트에서 대체, 북마크 보호).

## 4. 데이터 3계층

공개 아티팩트(`public/initial-five/issues/*.json`)를 실측한 결과, 시안 패널을 세 층으로
나눌 수 있다. **이 표가 이번 변경의 범위를 결정한다.**

### A. 지금 데이터로 바로 렌더 가능

| 필요한 것 | 아티팩트 경로 |
| --- | --- |
| 6차원 프레이밍 항목(의역·frame_family·voice.kind·근거 locator/해시) | `semanticProfiles[].profile.dimensions.*.items[]` |
| 취재원 역할·인원수·직접/간접 인용 건수 | `semanticProfiles[].profile.actors_and_sources[]` |
| 쟁점 축과 패턴별 기사 수·기사 ID | `comparison.data.comparison_axes[]` |
| 매체별 취재원 역할 건수 | `comparison.data.source_lens.by_outlet[]` |
| 정책·일반 프레임 건수(**의제 단위**) | `comparison.data.secondary_descriptors` |
| 서사 군집·공통 소재 | `clusterAi.narrativeVariants`, `clusterAi.commonSubjects` |
| 기사 제목·매체·발행시각·원문 URL | `articles[]` |
| KPI(기사 수·매체 수·성공 건수)·상태 배지 | `manifest`, `analysisStatus` |

### B. tmp 산출물엔 있으나 공개 계약엔 없음 — 빌더 확장 필요

공개 아티팩트에서 **기사 단위** 확장 필드는 전부 비어 있다:
`genre: {code:"unknown"}`, `scope: {code:"unknown"}`,
`secondary_descriptors: {generic_frames:[], policy_frames:[], controlled_associations:[]}`,
`framing_devices: []`. 형태소 특징어는 공개 계약에 아예 없다.

| 필요한 것 | 어디에 있나 | 없으면 |
| --- | --- | --- |
| 기사 단위 정책·일반 프레임 | `tmp/claude-framing-2026-07-26/framing-plus/*.json` | 매체별 프레임 비중이 예시로 남는다 |
| Iyengar 시야(일화/주제) | 같음 | 「보도 방식」 패널이 예시로 남는다 |
| 형태소 특징어·지칭어 + 근거 | `worker/framing-engine.mjs:562` 의 `morphologyTermEvidence` 가 생성하지만 공개 계약에 실리지 않음 | 의미연결망·특징어 표를 못 만든다 |
| 층위별 변별력 (5개 사안 횡단) | 로컬 계산 (`build_report.py`) | 홈의 핵심 패널이 빠진다 |
| 자가점검 문항 | `build_app.py:32 options_for` 가 생성 | 문항을 사람이 써야 한다 |

### C. 데이터가 어디에도 없음 — 예시 유지

일별 기사량 추이, 매체별 보도량(매체당 30건 이상 필요), 톤/감정, 2축 산점도,
편집 현저성·매체 확산도. 시안과 같은 방식으로 배지 + 「실데이터 조건」 각주를 달아
채워 둔다.

## 5. 파일별 변경

### 신규

| 파일 | 역할 |
| --- | --- |
| `site/app/(shell)/layout.tsx` | 사이드바 + sticky 상단바. 서버 컴포넌트, 의제 목록은 `initialFiveManifest` 에서 |
| `site/app/(shell)/shell-nav.tsx` | 클라이언트. `usePathname()` → `aria-current="page"` |
| `site/app/(shell)/issue-switcher.tsx` | 클라이언트. `<select>` → `router.push`. 현재 화면 유지 |
| `site/app/app-shell.css` | 셸·카드·KPI·차트 CSS. **`globals.css`(141KB)를 건드리지 않는다.** 클래스 접두어 `afs-` 로 고정해 기존 `.initial-five-*` 140개 규칙과 충돌을 막는다 |
| `site/app/charts/` | `LineChart` `HBars` `Heat` `Stack` `Scatter` `Donut` `WordNet` — `build_app.py` 의 SVG 프리미티브 포팅. `niceMax()` 축 스냅, 히트맵 농도 상한 1.3, 산점도 단색·오른쪽 라벨 반전, 도넛 라벨은 건수 규칙을 그대로 옮긴다 |
| `site/app/(shell)/issues/page.tsx` | 이슈 탐색 화면 |
| `site/app/(shell)/issues/[issueId]/{outlets,framing,report}/page.tsx` | 탭 → 라우트 분리 |
| `site/lib/initial-five/derive.ts` | bundle → 뷰 모델. voice 구성, 정책 프레임 조합, 취재원 가시성, 층위별 변별력, 확산도 |

### 수정

| 파일 | 변경 |
| --- | --- |
| `site/app/layout.tsx` | `viewport.colorScheme` 를 `"light dark"` 로. `themeColor` 를 라이트/다크 두 값으로. `app-shell.css` import |
| `site/app/globals.css` | `:root` 에 차트 계열색 4종(`--n1 #2856c8` `--n2 #0d9488` `--n3 #ea580c` `--n0 #94a3b8`)과 다크 값(`--n1 #6b92e2` `--n2 #0d9184` `--n3 #c9762a`) 추가. **기존 규칙은 지우지 않는다.** 상태색 4종(accent·green·amber·critical)은 색약에서 초록↔자주가 ΔE 4.3으로 붙어 계열색으로 쓸 수 없다(검증기 확인) |
| `site/app/initial-five.tsx` | `IssueDetailExperience` 의 탭 상태 제거, 각 탭 본문(`SummaryTab` `SemanticFraming` `OutletsTab` `EvidenceTab`)을 export 해 새 라우트가 재사용. **내용 수정 없음** |
| `site/app/agenda-dashboard.tsx` | 서술 패널을 의제 단위 리포트로 옮기되 파일은 유지. `tests/mvp.test.mjs` 가 빌드 산출물에 `agenda-dashboard` 청크가 있는지 고정하고 있다 |
| `site/app/site-header.tsx` | 셸이 내비를 맡으므로 셸 밖 라우트(`/admin` 등)에서만 쓰도록 축소 |
| `site/lib/initial-five/builder.mjs` | B계층 필드 통과. 기존 필드 제거·개명 금지(계약 테스트가 model/promptVersion/schemaVersion 을 고정) |
| `site/tests/initial-five-contract.test.mjs` | B계층 필드에 대한 어서션 추가 |

### 옮기는 것 (URL 불변)

`app/page.tsx`, `app/issues/`, `app/tools/`, `app/method/`, `app/community/` 를
`app/(shell)/` 아래로 이동. `/admin` 은 자체 셸이 있으므로 그룹 밖에 둔다.

## 6. 단계

각 단계 끝에서 아래 게이트가 통과해야 다음으로 넘어간다. **게이트는 두 빌드를 모두
돈다** — `npm test` 는 `vite build`(Workers 대상)로 빌드하지만 Vercel 은 `next build` 로
빌드하므로, `next build` 만 깨지는 변경은 테스트가 잡지 못한다. `scripts/check.ps1
-Mode quick` 은 파이썬 검사(pytest `tests/unit` `tests/contract`)만 돌고 사이트를 건드리지
않는다.

```
cd site
npm run typecheck
npm run lint
npm test          # vite build + node --test
npx next build    # Vercel 과 같은 경로. npm test 가 대신하지 못한다
cd .. && powershell -NoProfile -File scripts/check.ps1 -Mode quick
```

- **P-1 관문 먼저** — 화면을 바꾸기 전에 `audit-site.mjs` 를 만들고 현재 사이트의
  기준선을 기록한다. 관문을 마지막에 두면 P0~P3 의 결함이 구분 없이 쌓여서, 어느
  단계가 무엇을 깼는지 알 수 없게 된다.
- **P0 셸** — 라우트 그룹, 사이드바, 상단바, 의제 셀렉터, 다크 모드 활성화.
  화면 내용은 손대지 않는다. 이 단계만으로 사이트가 시안처럼 보이기 시작한다.
- **P1 차트** — `app/charts/` 7종 + 계열색 토큰. A계층 데이터로 그릴 수 있는
  패널(취재원 막대, 정책 프레임 도넛, 쟁점 축)부터 교체한다.
- **P2 화면 재편** — 탭을 라우트로 분리하고 홈에 KPI 행을, 이슈 탐색을 신설한다.
  기존 컴포넌트를 재사용하므로 새로 쓰는 코드는 배치 코드다.
- **P3 데이터 계약 확장** — B계층. `builder.mjs` 통과 필드 추가 → 공개 아티팩트
  재생성 → 계약 테스트 추가. 이 단계가 예시 패널 5개를 실측으로 바꾼다.
- **P4 수렴** — 누적된 결함을 error 0 까지 내린다. P-1 부터 관문이 돌고 있었으므로
  이 단계에 남는 것은 P3 데이터 확장이 새로 만든 결함뿐이어야 한다.

관문 스크립트는 `tmp/claude-framing-2026-07-26/prototype/audit.mjs` 를 옮겨
`site/scripts/audit-site.mjs` 로 둔다. 규칙 22개 × (5의제 × 7화면 × 폭3 × 테마2)로
대비·넘침·겹침·터치 크기·초점 링·계열색을 기계 판정하고, error 가 남으면 exit 1 이다.
시안용 선택자(`.card` `.kpi` `.scroll`)를 사이트 클래스로 바꾸고, 파일 경로 대신
`--url` 로 dev 서버를 받게 고친다.

## 7. 주의

- **`--ink-3` 를 사이트로 옮기지 않는다.** 시안이 새로 만든 3단계 잉크
  `#6f7c8d` 는 흰 배경에서 4.25:1 로 WCAG AA 미달이다. 사이트의 `--muted #596579`
  는 5.81:1 로 통과한다. 잉크는 2단계로 유지한다.
- `globals.css` 는 141KB 에 `.initial-five-*` 140개를 포함한 손으로 쓴 CSS 다.
  새 셸 CSS 를 여기에 섞으면 선택자 특이도 충돌을 추적할 수 없다. 별 파일 + 접두어.
- `app/agenda-dashboard.tsx`(107KB)와 `app/initial-five.tsx`(40KB)는 재작성하지 않는다.
  둘 다 근거 locator·해시·상태 배지 같은 계약 코드를 품고 있고, 계약 테스트가
  이를 검증한다.
- 원문 비저장 원칙 유지 — 화면에는 의역·근거 건수·원문 링크만, 본문 문장은 싣지 않는다.
- `public/agenda-prototype/` 는 P2 이후 중복이 된다. 삭제 여부는 팀원 확인 후 별건.

## 8. 검증

1. `cd site && npm run build && npm test`
2. `powershell -NoProfile -File scripts/check.ps1 -Mode quick`
3. `audit.mjs` 를 dev 서버에 돌려 error 0 (P4)
4. 5개 의제 × 7화면 × (1280 라이트 / 1280 다크 / 390) 스크린샷 확인
5. 기존 URL 회귀: `/`, `/issues/bigkinds-2026-07-26-top-1`, `?view=framing`,
   `/dashboard`, `/tools/ask`, `/admin` 이 모두 200 이고 내용이 유지되는지
6. `/api/initial-five/ask` 프록시가 Vercel 프리뷰에서 살아 있는지 (AI 대화)
