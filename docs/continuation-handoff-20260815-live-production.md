# 2026-08-15 live production handoff

## 초기 목표

7월 26일 데모로 롤백하지 않고, 2026-08-15 실제 기사로 첫 운영 기준일을 만든 뒤
하루 4회 자동 갱신 경로를 유지한다.

## 발견한 문제

- `cluster_today_issues.mjs`가 EVENT_DEFS·매체 성향·제목 해시로 가짜 Vertex 결과를 만들었다.
- `protoIssue()`가 `live-2026-08-15-top-N`을 2026-07-26 산출물에 매핑해 보완수사권·멱살 설명이 섞였다.
- `ShellChrome`이 hydration 뒤 D1 `/api/issues`로 드롭다운을 바꿔 만료 ID가 생겼다.
- 본문형 제목(200자+)이 title로 공개됐다.
- 점수가 `null`/0.0으로 고정됐다.
- 공개 비교문이 “대통령 침묵 / 제도 안전장치” 템플릿을 모든 의제에 반복했다.

## 수정한 파일

- `site/lib/proto/index.ts` — 7/26 ID만 proto 매핑
- `site/app/(shell)/shell-chrome.tsx` — D1 의제 목록 덮어쓰기 제거
- `site/lib/initial-five/compose-synthesis.mjs` — 8/15 미검증 합성 fail-closed
- `site/app/(shell)/semantic-analysis-pages.tsx` — “분석 검증 중” 표시, 가짜 Vertex 배지 제거
- `site/app/(shell)/active-home.tsx` — 실제 agendaScore 표시
- `site/lib/article-title.mjs`, `site/lib/analysis-verification.mjs`
- `site/worker/analysis.mjs` — 광복절/대통령 일반 토큰, hard-negative 분리
- `site/scripts/build-live-snapshot.mjs` — 운영 스냅샷 생성기
- `scripts/cluster_today_issues.mjs` — synthetic retired
- `site/public/initial-five/manifest.json` 및 `live-2026-08-15-top-*.json`

## 실제 클러스터링

`analyzeArticles()` complete-link v7. 제목 정제 후 당일 전체 재군집화.
최소 기사 3·매체 2. singleton으로 5개를 채우지 않음.
hard-negative: 경축사↔산책/K-컬처/야스쿠니, 이진숙 방통↔의원 5·18, 사면↔당내 선거, 친일재산↔독립유공자 기부.

## 실제 순위 산식

`observed-agenda-v5`: 독립 매체 다양성, 로그 기사 수, 배치, 후속/반복 감점, cohesion.
화면은 `agendaScore`를 그대로 표시한다.

## Vertex / evidence

이번 재생성 스냅샷은 **Vertex 실호출이 아니다.**
`today-articles-2026-08-15.json`에 비공개 본문이 없어 locator 재검증이 불가능하다.
공개 비교·프레이밍 문장은 fail-closed (“분석 검증 중”).
가짜 `gemini-2.5-flash-lite` / `sha256(title+"-1")` 경로는 제거했다.

모델·promptVersion은 검증된 lineage가 생기기 전에는 표시하지 않는다.

## 공개 본문 방지

- 200자 초과·다문장·본문형 title 제거
- 공개 bundle에 bodyText/raw_body/HTML/sentenceText 없음
- 제목 없으면 클러스터 입력에서 제외

## GCP 실행 / 하루 4회

이미 배포됨.

- Job: `agendaframe-collection-analysis`
- Workflow: `agendaframe-collection-analysis`
- Scheduler: `agendaframe-collection-4x-kst` `0 3,9,15,21 * * *` Etc/UTC
- Reader: `https://agendaframe-snapshot-reader-2zut37vwaq-du.a.run.app/active`

Vercel 환경변수 이름만: `AGENDAFRAME_DATA_MODE`, `AGENDAFRAME_ACTIVE_SNAPSHOT_URL`.

Cloudflare cron은 Scheduler 예약 성공 확인 전에는 끄지 않음.

## 배포

```powershell
cd site
npm run typecheck
npm run lint
node --test --test-isolation=none tests/live-2026-08-15-quality.test.mjs tests/initial-five-contract.test.mjs
# 저장소 루트
npx vercel deploy --prod --yes
```

## rollback

- 사이트: 직전 Vercel production redeploy
- 스냅샷: `site/public/initial-five`의 이전 immutable JSON + 직전 commit
- GCP pointer: 바꾸지 않았으면 이전 current pointer 유지

## 테스트

- live-2026-08-15-quality, compose-synthesis, active-snapshot-contract, initial-five-contract 통과
- `tsc --noEmit` 통과

## 공개 URL

배포 후 `/version`과 `/`에서 2026-08-15, 가짜 7/26 설명 없음, 점수 > 0을 확인한다.

## 미완료

- 비공개 본문 확보 후 실제 Vertex framing + locator 재검증
- 5개 미만이 아닌 “최대 5” 빈 칸 UI (현재 적격 군집 5개 발행)
- Cloudflare cron cutover
- Reader `/healthz` 404
- 사람 코더 / `release_eligible`

## 다음 모델 프롬프트

2026-08-15 클러스터는 complete-link로 다시 만들었다. 다음 작업은 비공개 본문을 확보한 뒤 상위 최대 5개만 Vertex로 분석하고, locator/hash를 재검증한 뒤에만 비교문을 열어라. 7월 26일로 롤백하지 마라.
