# AgendaFrame 현재 스냅샷

작성: 2026-08-14. 이 파일은 히스토리가 아니라 **지금**의 인수인계다.
다음 세션은 이 문서와 `AGENTS.md`를 먼저 읽고, `git status --short`로 기존 수정을 확인한다.
이미 있는 코드를 다시 만들지 말고, 완료/미완료 경계를 지킨다.

관련 문서: `docs/next-session-handoff.md`(이전 체크포인트), `docs/planning/product-backlog.md`, `docs/architecture/cloud-runtime.md`.

## 1. 무엇을 왜 하는가

AgendaFrame은 클릭/추천이 아니라 **언론사 편집 배치와 보도 구성**으로 오늘의 공적 의제를 계산하고, 같은 사건을 매체별로 어떻게 다르게 설명하는지 보여 주는 서비스다.

핵심 루프(수집→상위 5개→스냅샷→세 화면)는 전제다. **제품 목표**는 그 화면이 예시 HTML처럼 민감한 논조 차이를 보여주는 것이다.

```text
기사별 Vertex 프로필
  → 사건 단위 종합 AI (camps / 공통선 / 갈림 / 4기능)
  → locator+hash가 있는 문장만 공개
  → 홈 / 언론사 비교 / 프레이밍이 같은 snapshot을 읽음
```

“A는 진보, B는 보수”는 금지. 목표 문장은 이런 형태다: A는 대통령의 침묵과 정치적 책임을 앞세웠고, B는 제도적 안전장치 약화를 앞세웠으며, C는 정치적 손실을 경고했다.

사람 이중 코딩(PBL-25)은 출시 게이트이지 이 종합 단계의 선행 조건이 아니다.

확정된 운영 범위:

- 기간: `2026-08-13` ~ `2026-10-31` (Asia/Seoul)
- 시각: KST 00/06/12/18
- 매체: 경향·국민·동아·문화·서울·세계·조선·중앙·한겨레·한국일보 + KBS + SBS
- MBC 제외. 원문 공개 금지. 본문 폐기 `2026-10-31T23:59:59+09:00`.

## 2. 지금 어디까지인가

브랜치: `codex/initial-five-complete` (`1b2a483`, origin보다 37 커밋 앞섬).
`origin/main`은 `1c9e34f`. 로컬 `main`은 더 오래된 `1a31f8a`이므로 로컬 main을 기준으로 삼지 않는다.

### 이미 끝난 것 (다시 만들지 말 것)

- 사이트 핵심 화면: 의제 랭킹, 이슈 상세, 언론사 비교, 프레이밍 분석, initial-five 공개 계약, 근거 챗, 설정/찜하기.
- 의미 UI: `site/app/(shell)/semantic-analysis-pages.tsx`. locator + sentence_sha256만 증거로 표시. raw 본문/문장/HTML 비공개. 언론사 의도·성향 단정 금지.
- 수집 정책 fixture: `site/data/discovery-sources.json`, `site/data/collection-schedule.json` (8/13 기준, `eebfdea`).
- GCP **코드·계약**: collect → persist → cluster_rank → top5_semantic → quality_gate → publish. retry/idempotency, exact top5, body-safe, immutable snapshot.
- 릴리스 통합: `9f1f627`에서 live collection + GCP runtime을 합쳤고, 사이트 테스트 185 passed, Python unit/contract 108 passed / 1 skipped.
- 공개 사이트는 Vercel. 배포 절차는 `docs/deploy.md`. 라이브는 아직 **정적/데모·기존 Worker 데이터**다. GCP live라고 말하지 않는다.

### 작업 트리에 이미 있는 미커밋 (버리지 말 것)

이 세션이 남긴 **핵심 슬라이스**다. `git reset --hard` / `git checkout --` / `git add -A` 금지.

의도된 변경:

| 경로 | 역할 |
| --- | --- |
| `src/backend/gcp_snapshot_reader.py` | current pointer + manifest SHA + 본문 차단 검증 |
| `src/backend/gcp_snapshot_reader_service.py` | `GET /healthz`, `GET /active` Cloud Run 경계 |
| `infra/gcp/snapshot-reader-service.yaml` | 계약. 아직 `implementationStatus: contract_only` |
| `tests/unit/test_gcp_snapshot_reader.py` | reader 단위 테스트 |
| `tests/unit/test_gcp_snapshot_reader_service.py` | HTTP 경계 테스트 |
| `tests/contract/test_gcp_snapshot_reader_contract.py` | YAML 계약 테스트 |
| `src/backend/gcp_orchestration.py` | pointer에 `active`, `manifestSha256` 추가 |
| `src/backend/gcp_job_entrypoint.py` | pointer/manifest digest 수렴 검증 |
| `src/backend/gcp_live_dependencies.py` | `read_public_object` |
| `src/backend/gcp_stage_adapters.py` | writer에 read 위임 |
| `site/app/(shell)/active-home.tsx` | live 모드 홈 |
| `site/app/(shell)/page.tsx` | live면 ActiveSnapshotHome |
| `site/app/(shell)/issues/[issueId]/outlets/page.tsx` | live면 semantic outlets |
| `site/app/(shell)/issues/[issueId]/framing/page.tsx` | live면 semantic framing |

건드리지 말 것: `.codex-*` worktree, `docs/feedback/`, `outputs/`, `rank-current-2026-07-26.json`, `site/*.log`.

기본 모드는 여전히 demo다. `AGENDAFRAME_DATA_MODE=live`와 `AGENDAFRAME_ACTIVE_SNAPSHOT_URL`이 없으면 live라고 표시하지 않는다. live인데 snapshot이 깨지면 데모로 조용히 떨어지지 않고 fail-closed다.

### 아직 코드로도 안 끝난 것

1. `src/backend/Dockerfile` CMD가 아직 `backend.main validate-config`. 계약(`infra/gcp/cloud-run-job.yaml`)은 `python -m backend.gcp_job_entrypoint`.
2. `infra/gcp/workflow.yaml`의 `stores.transactionalMetadata: cloud_sql`은 현재 런타임과 어긋난다. 지금은 BigQuery + Cloud Storage. Cloud SQL은 future migration.
3. RSS/`datePublished`/본문 최소 길이/날짜 없는 기사 거부 회귀 테스트가 없다.
4. snapshot-reader 파일은 있지만 커밋되지 않았고, Cloud Run 서비스도 없다.
5. `infra/gcp/*` 전부 `implementationStatus: contract_only`, `externalCalls: false`.

### 외부에 없는 것 (완료라고 말하지 말 것)

- GCP Scheduler / Workflows / Pub/Sub DLQ / Secret Manager / Monitoring 실자원
- Cloud Run Job이 `gcp_job_entrypoint`로 도는 운영 이미지
- private GCS current pointer를 읽는 배포된 snapshot-reader
- Vercel live env
- Cloudflare cron과 GCP scheduler의 ownership cutover
- `origin/main` + Vercel production에 이번 브랜치 반영
- 사람 코더 실측, `release_eligible: true`

Cloudflare 수집 스테이징은 별도 경로로 이미 1회 돌아 본 적 있다(2026-08-10, 기사 2,186건). GCP와 동시에 켜지 않는다. ownership flag를 확인하기 전에 cron을 켜지 않는다.

## 3. 다음에 할 일

한 번에 하나만. **제품 다음 작업은 사건 종합 AI를 실제 Vertex 출력에 연결해 예시 HTML 밀도를 만드는 것**이다. 인프라 canary는 그 출력이 빈 문장이 아닐 때 의미가 있다.

2026-08-15에 `src/ai/event_synthesis.py`와 `FrameSemanticAdapter` 연결, 근거 바인딩 테스트, 화면 `SynthesisNarrative`를 추가했다. 아직 산 종합 모델 호출 성공 사례는 없다.

### 지금 할 일 (비용 0, 외부 호출 0)

목표: “한 active snapshot을 홈·비교·프레이밍이 같이 읽는다”가 **코드·테스트로** 참이 되게 만든다.

1. 위 미커밋 파일을 유지한 채 빠진 구멍을 메운다.
   - Dockerfile CMD를 `python -m backend.gcp_job_entrypoint`에 맞추고, factory 없으면 fail-closed인지 테스트.
   - `workflow.yaml`에서 현재 저장소를 BigQuery+GCS로 맞추고 Cloud SQL은 future로만 표기.
   - parser 회귀: RSS pubDate, JSON-LD `datePublished`, canonical/domain, 본문 최소 길이, 날짜 없는 기사 거부.
2. 오프라인 검증.
   - `powershell -NoProfile -File scripts/check.ps1 -Mode quick`
   - 사이트: `npm run typecheck && npm run lint` 그리고 `tests/active-snapshot-contract.test.mjs` 포함 테스트.
3. 의도 파일만 커밋. 사용자 출력물·worktree·로그는 넣지 않는다.
4. 배포했다고 쓰지 않는다. 코드 경계가 닫힌 것이다.

실행 워크플로: `/workflow core-loop-next-slice` (`args.mode`는 `implement` 또는 `audit`).

### 그다음 (승인 필요)

비운영 프로젝트, 월 지출 상한, 서비스 계정, Workflows API를 확인한 뒤에만:

1. snapshot-reader Cloud Run 1개 배포. Vercel이 `GET /active`만 보게 한다.
2. Job 이미지 1회 canary. lease/duplicate/rollback pointer 확인.
3. Cloudflare cron과 GCP가 겹치지 않게 ownership 확인 후 cutover.
4. 검증된 커밋을 `origin/main`에 안전하게 합친 뒤 Vercel 배포. `/version` SHA와 `/`, `/issues`, `/outlets`, `/framing`을 브라우저로 확인.

`scripts/gcp/provision.ps1 -Apply`는 안전 승인 없이 실행하지 않는다.

### 나중 (SOTA / 발표)

- PBL-25 사람 이중 코딩과 `release_gate.py`
- PBL-26 카나리 리허설 기록
- PBL-29 워커 v6
- PBL-30 옛 경로 정리, PBL-10 정렬 토글
- 최신 분석일 갱신, 발표 스크립트

## 4. 작업 규칙

- 외부 뉴스 사이트, Vertex, BigQuery, GCS, Scheduler, Workflows에 ordinary test로 접속하지 않는다.
- “배포 완료”, “GCP 자동화 완료”, “실시간 수집 완료”는 공개 endpoint와 실자원 증거가 있을 때만 말한다.
- 화면 눈속임으로 완료 처리하지 않는다. 근거 없는 의도·성향 추론을 만들지 않는다.
- 비밀, `.env`, 서비스 계정 파일을 커밋하지 않는다.
- 충돌 났던 `origin/main` 병합은 파일별 수동 결합. live-data 변경과 semantic/GCP 변경을 덮어쓰지 않는다.
