# AgendaFrame 다음 세션 인수인계

작성일: 2026-08-13 (KST)
현재 브랜치: `codex/initial-five-complete`
배포 문서 커밋: `c4e6ad9 docs: record Vercel main deployment procedure`
최근 체크포인트: `790e53f fix: satisfy GCP dependency lint gate`

## 사용 목적

다음 세션은 이 문서를 먼저 읽고, 아래의 “계속 실행할 프롬프트”를 기준으로 작업한다. 이미 구현한 코드를 다시 만들지 말고, 완료/미완료 경계를 유지한다. 특히 계약 파일과 실제 GCP 리소스는 다르므로, 외부 서비스에 적용되지 않은 것을 배포 완료라고 보고하지 않는다.

## 이번 체크포인트에 저장된 작업

### 1. 사이트의 두 분석 화면

- `site/app/(shell)/semantic-analysis-pages.tsx`에 예시 HTML의 구조를 따라 언론사 비교와 프레이밍 분석 화면을 구현했다.
- 사건 30초 요약, 공통으로 본 것과 갈린 지점, 기사 단위 증거, 프레임 4기능 비교, 다섯 핵심 차원, 범위·취재원·표현 장치 섹션을 포함한다.
- `locator`와 `sentence_sha256`가 모두 있는 항목만 기사 증거로 표시한다. 검증되지 않은 paraphrase는 숨기고 상태/사유를 표시한다.
- `unknown`/`uncertain` 음성은 취재원 귀속으로 세지 않는다. `direct_quote`/`indirect_source`만 귀속 집계한다.
- `not_observed`, `explicit_not_stated`, `insufficient_evidence`, `analysis_failed`, `review_needed`, `conflicting`, `missing_dimension`, `automatic_draft`를 구분한다.
- `requiresHumanReview`, profile review, model status를 화면에 노출한다.
- 원문 본문, 문장 원문, `raw_body`, `sentence_text`, HTML을 공개 화면에 넣지 않는다.
- 중복 FrameMatrix 렌더링을 제거했고, reference parity 계약 테스트를 추가했다.

### 2. 실시간 데이터 경계

- `site/lib/active-snapshot.ts`가 live 모드에서 active snapshot을 읽고, 정확히 5개 의제·금지 본문 필드·스냅샷 envelope를 검증한다.
- 기본 화면은 아직 정적 initial-five 데이터가 아니라는 주장을 하지 말고, live 환경 변수와 active snapshot reader가 연결되기 전에는 demo/static 경계를 표시해야 한다.
- 현재 route/loader에는 active snapshot 주입 경계가 들어갔지만, GCS private bucket을 Vercel이 읽을 공개 snapshot reader 서비스는 아직 외부 배포되지 않았다.

### 3. 수집 정책

- 12개 언론사: 10개 전국종합일간 + KBS + SBS.
- 수집 횟수: KST 00, 06, 12, 18 (일 4회).
- 운영 수집 시작일: `2026-08-13`.
- 종료일: `2026-10-31`.
- 원문/임시 본문 삭제 시점: `2026-10-31T23:59:59+09:00`.
- MBC는 현재 차단/정책 제외이며 12개 명단에 포함하지 않는다.
- 정책 파일: `site/data/discovery-sources.json`, `site/data/collection-schedule.json`.
- 기존 2026-08-10 fixture는 `eebfdea`에서 2026-08-13 기준으로 갱신했다. 명시적인 out-of-window 회귀 케이스(8월 12일 이전)는 보존했다.

### 4. GCP 코드/계약

추가된 주요 파일:

- `src/backend/gcp_orchestration.py`: collect → persist → cluster_rank → top5_semantic → quality_gate → publish, retry/idempotency, raw-body 차단, exact top5/evidence gate, immutable snapshot/pointer.
- `src/backend/gcp_job_entrypoint.py`: 12-source policy, run ownership, lease, active manifest/pointer validation.
- `src/backend/gcp_production_adapters.py`: Google SDK lazy import 및 production adapter 경계.
- `src/backend/gcp_live_dependencies.py`: sequential HTTPS feed fetcher, strict publication-date parser, body vault, GCS immutable snapshot writer/pointer store, Vertex/BigQuery/Storage factory.
- `src/backend/gcp_stage_adapters.py`: 수집·메타데이터 저장·클러스터/순위·Vertex 프레이밍·사이트 bundle·snapshot adapter.
- `src/backend/gcp_store.py`: BigQuery/Storage client 주입 가능하도록 변경.
- `infra/gcp/*.yaml`, `infra/gcp/cloud-sql-schema.sql`: Scheduler/Workflows/Pub/Sub/DLQ/Monitoring/Secret/Cloud Run/ownership 계약과 Cloud SQL 미래 스키마.

현재 저장소 선택은 실제 adapter가 BigQuery를 사용한다. `workflow.yaml`에 Cloud SQL을 현재 transactional store처럼 적어두면 실제 구현과 어긋나므로, 다음 세션에 “현재 BigQuery + Cloud Storage, Cloud SQL은 명시적 future migration”으로 정리한다. DB를 Cloud SQL로 옮겼다고 말하지 않는다.

## 검증된 것

- 문서 커밋 `c4e6ad9`가 Vercel 배포 방법을 저장했다.
- Python GCP 계약/단위 테스트(직전 실행): 관련 suite 36개 통과.
- `gcp_live_dependencies.py`, stage/production adapter import/compile smoke 통과.
- 사이트 `npm run typecheck` 통과.
- 사이트 `npm run lint`는 오류 0개, 기존 warning 4개.
- 사이트 `npm test`: 빌드 성공, 170개 테스트 전부 통과.
- 루트 `scripts/check.ps1 -Mode quick`: Python lint/format 및 unit·contract 109개 전부 통과.
- semantic page/framing/initial-five 계약 테스트 31개 통과.

## 아직 완료되지 않은 것

1. `gcp_live_dependencies.py`의 RSS/HTML strict date/body parser offline 회귀 테스트 추가.
2. GCP workflow의 저장소 표기를 실제 BigQuery adapter와 일치시킴(Cloud SQL은 future migration으로 명시).
3. private GCS active snapshot을 Vercel이 안전하게 읽도록 Cloud Run snapshot-reader 또는 동등한 public read boundary 구현.
4. Dockerfile/Cloud Run Job의 실제 production entrypoint 연결. 현재 contract command만 있고 실제 배포 이미지 전환은 미완료.
5. 실제 RSS/article parser, BigQuery sink, Vertex Gemini adapter, GCS snapshot writer의 injected dependency를 GCP 리소스에 연결.
6. GCP Scheduler/Workflows/Pub/Sub/DLQ/Monitoring/Secret Manager 실제 생성. `infra/gcp`는 현재 `implementationStatus: contract_only`, `externalCalls: false`다.
7. GCP apply 전 non-production project, budget/spend cap, service account, Workflows API, IAM을 명시적으로 확인한다. `scripts/gcp/provision.ps1 -Apply`는 안전 승인 없이는 실행하지 않는다.
8. GCP canary 1회 → duplicate/lease 확인 → Cloudflare cron 중복 비활성화 → rollback pointer 확인.
9. GCP active snapshot이 실제 main page, outlets, framing 모두 동일하게 갱신되는지 확인.
10. 검토 커밋을 `origin/main`의 최신 이력과 안전하게 합친 뒤 Vercel production 배포.
11. 공개 `/version`의 commit SHA가 배포 커밋과 일치하는지, `/`, `/issues`, 실제 issue `/outlets`, `/framing`을 브라우저로 확인.

## 기록된 Vercel 배포 방법

상세 절차는 `docs/deploy.md`에 있다.

1. 저장소 루트에서 release commit을 만든다.
2. 검증된 commit을 `main`에 push한다. Vercel Git Integration이 `main` push를 production deployment로 처리한다.
3. Vercel 프로젝트 Root Directory는 `site`이며 Framework는 Next.js다.
4. 최대 10분 안에 `https://agendaframe-capstone.vercel.app/version`의 `commit`/`shortCommit`이 push한 SHA와 일치하는지 확인한다.
5. `/`, `/issues`, 실제 issue의 `/outlets`, `/framing`을 확인한다.
6. Git deployment가 막힐 때만 저장소 루트에서 `npx vercel deploy --prod --yes`를 수동 fallback으로 사용한다. `site/` 안에서 실행하면 Root Directory가 `site/site`가 될 수 있으므로 실행하지 않는다.

## 작업 시 지켜야 할 경계

- 현재 working tree에는 사용자 기존 파일, 출력물, 여러 `.codex-*` worktree가 있다. `git reset --hard`, `git checkout --`, broad `git add -A`를 사용하지 않는다.
- 이번 체크포인트의 의도 파일만 stage한다. `docs/feedback`, `outputs`, `rank-current-2026-07-26.json`, `site/*.log`, `.codex-*`는 별도 검토 전 커밋하지 않는다.
- 외부 news site, Vertex, BigQuery, GCS, Scheduler, Workflows에 ordinary test로 접속하지 않는다. 실제 호출/생성은 non-production과 비용 제한을 확인한 뒤 별도 live opt-in으로 한다.
- 규칙 기반 화면 눈속임으로 완료 처리하지 않는다. 화면은 semantic bundle의 model/provider/review/evidence lineage를 표시하고, 근거 없는 의도·성향 추론을 하지 않는다.
- “배포 완료”, “GCP 자동화 완료”, “실시간 기사 수집 완료”는 공개 endpoint와 실제 리소스 증거가 있을 때만 말한다.

## 계속 실행할 프롬프트

아래 내용을 다음 세션의 첫 작업 지시로 사용한다.

```text
AgendaFrame 작업을 이전 상태에서 이어간다. 먼저 C:\\Users\\강준혁\\Desktop\\구글캡디_문서\\docs\\next-session-handoff.md와 AGENTS.md를 읽고, git status --short 및 현재 HEAD를 확인한다. 이미 구현된 내용을 다시 만들지 말고, 완료/미완료 경계를 지킨다.

목표는 다음 네 가지를 실제로 끝내는 것이다.
1) 2026-08-13부터 2026-10-31까지 12개 언론사(10개 전국종합일간+KBS+SBS)를 KST 00/06/12/18에 수집하고, 본문은 private storage에 임시 보관 후 2026-10-31 23:59:59 KST에 폐기한다.
2) collect→persist→cluster/rank→상위 5개 Vertex Gemini 프레이밍→quality gate→immutable snapshot publish를 GCP에서 실제 실행한다.
3) active snapshot 하나를 메인, 언론사 비교, 프레이밍 분석 화면이 공통으로 읽도록 한다. 예시 파일 C:\\Users\\강준혁\\Desktop\\구글캡디_문서\\tmp\\claude-framing-2026-07-26\\prototype\\app.html의 구조를 유지하되, 실제 semantic evidence만 표시하고 raw 본문/문장/HTML을 공개하지 않는다. 관찰된 편집 선택과 근거를 비교하며 언론사 의도·성향을 단정하지 않는다.
4) 검증된 release commit을 origin/main에 반영하고 Vercel production을 배포한 뒤 /version SHA와 실제 브라우저 화면을 확인한다.

순서:
A. 이미 `eebfdea`에서 site fixture를 2026-08-13으로 갱신했다. `cd site; npm run typecheck; npm run lint; npm test; npx next build`를 재확인하고, fixture를 다시 8월 10일로 되돌리지 않는다.
B. gcp_live_dependencies parser에 RSS publication date, article JSON-LD datePublished, canonical/domain, body 최소 길이, date-less 거부 회귀 테스트를 추가한다. Python GCP contract/unit suite와 `powershell -NoProfile -File scripts/check.ps1 -Mode quick`를 실행한다.
C. infra/gcp/workflow.yaml와 테스트에서 현재 저장소를 BigQuery+Cloud Storage로 일치시킨다. Cloud SQL은 future migration으로만 표시하고 runtime이 Cloud SQL을 쓴다고 주장하지 않는다.
D. private GCS active snapshot을 읽는 최소 Cloud Run snapshot-reader 경계를 구현하고, response가 public bundle only인지(본문 필드 없음), current pointer와 manifest SHA가 일치하는지 계약 테스트한다. Vercel live 환경 변수 연결 전에는 static/demo 경계를 계속 표시한다.
E. Dockerfile/Cloud Run Job command가 실제 gcp_job_entrypoint를 실행하도록 연결하고, production adapter factory가 주입 의존성 없이 fail-closed인지 테스트한다. 외부 API는 호출하지 않는다.
F. GCP non-production 프로젝트와 비용 제한을 확인한 뒤에만 실제 apply를 요청한다. Scheduler 0/6/12/18 KST, Workflows, Pub/Sub/DLQ, Secret Manager, Monitoring, Cloud Run Job을 만들고, canary 1회와 lease/duplicate/rollback을 확인한다. 안전 승인이나 비용 제한이 없으면 코드/계약까지만 하고 정확한 blocker를 보고한다.
G. Cloudflare 4회 cron과 GCP scheduler가 동시에 돌지 않도록 ownership flag를 확인한 뒤 cutover한다. 실패하면 previous snapshot pointer를 유지하고 Cloudflare fallback을 복구한다.
H. origin/main의 최신 이력과 현재 release 변경을 안전하게 통합한다. broad reset/checkout을 하지 말고, 의도 파일만 commit한다. `docs/deploy.md`의 Vercel 방법대로 main push 또는 저장소 루트의 `npx vercel deploy --prod --yes`를 사용한다. 배포 후 공개 /version SHA와 /, /issues, 실제 issue /outlets, /framing을 브라우저로 확인한다.

각 단계마다 사용자에게 짧게 “이번 단계에서 실제로 바뀐 것 / 테스트 결과 / 아직 외부 적용 전인 것 / 다음 작업”을 보고한다. 사용자가 이미 승인한 범위 안에서는 반복해서 확인하지 말고 진행하되, 실제 GCP 비용 발생·외부 리소스 생성·production push가 안전 정책상 막히면 우회하지 말고 그 한 가지 blocker와 필요한 승인을 명확히 적는다. 완료라고 말하려면 실제 public evidence가 있어야 한다.
```

## 체크포인트 저장 상태

이 문서와 현재 의도된 staged 변경을 함께 별도 커밋으로 저장한다. 커밋 후에도 남는 `??` 파일은 기존 사용자 작업/출력물로 보존하며 건드리지 않는다.
