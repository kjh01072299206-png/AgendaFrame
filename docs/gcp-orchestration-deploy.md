# GCP 오케스트레이션 배포 절차

이 문서는 AgendaFrame의 12개 소스·일 4회 수집 파이프라인을 GCP로 전환할 때
같은 순서로 재사용하는 절차다. 기본 명령은 모두 드라이런이며, 외부 GCP
변경은 명시적 스위치를 붙였을 때만 실행된다.

## 현재 구성

- `infra/gcp/workflow.yaml`: 단계·저장소·품질 게이트 계약
- `infra/gcp/workflow-runtime.yaml`: `gcloud workflows deploy`가 직접 읽는 실행 정의
- `scripts/gcp/deploy-runtime-job.ps1`: `backend.gcp_job_entrypoint` Cloud Run Job 배포
- `scripts/gcp/deploy-orchestration.ps1`: Workflows 배포 및 선택적 Scheduler 생성
- `scripts/gcp/verify-snapshot-reader.ps1`: 공개 전 body-free snapshot canary 검증
- Scheduler 시간: `0 3,9,15,21 * * *` UTC = 00/06/12/18 KST

Workflows는 실행 시 Asia/Seoul 기준일과 고유 execution ID를 만들고, 그 값을
Cloud Run Job 환경변수로 주입한다. Job은 `AGENDAFRAME_PIPELINE_OWNER=gcp`,
Cloudflare/legacy schedule `false` 조건이 아니면 시작하지 않는다. 공개 포인터는
품질 게이트 통과 뒤에만 갱신된다.

## 오프라인 확인

```powershell
powershell -NoProfile -File scripts/gcp/provision.ps1
powershell -NoProfile -File scripts/gcp/deploy-runtime-job.ps1
powershell -NoProfile -File scripts/gcp/deploy-snapshot-reader.ps1
powershell -NoProfile -File scripts/gcp/deploy-orchestration.ps1
powershell -NoProfile -File scripts/gcp/verify-snapshot-reader.ps1
powershell -NoProfile -File scripts/check.ps1 -Mode quick
```

이 단계에서는 API 호출, 이미지 빌드, Scheduler 생성, 뉴스 수집, Vertex 호출이
발생하지 않는다.

## 승인된 비프로덕션 적용 순서

1. 예산 상한·IAM·private bucket lifecycle·BigQuery schema/grants를 확인한다.
2. 검토된 전체 SHA와 full gate 결과를 확보한다.
3. `provision.ps1 -Apply -SpendCapsConfirmed`로 기반 리소스와 service account를
   적용한다. `workflow`에는 Cloud Run 실행 권한, `scheduler`에는 Workflows Invoker
   권한만 부여한다.
4. Cloud Run Job과 snapshot-reader를 배포한다. reader는 먼저 `--no-traffic`으로
   배포하고 `/healthz`, `/active`를 검증한다.
5. unique `run_id`로 collector canary를 한 번 실행해 lease, idempotency, 12개
   source 제한, 날짜 범위, quality gate, immutable pointer rollback을 확인한다.
6. 아래 명령으로 Workflows만 배포한다.

```powershell
powershell -NoProfile -File scripts/gcp/deploy-orchestration.ps1 `
  -Apply -FullGatePassed -CommitSha <40-character-reviewed-sha>
```

7. canary가 통과한 뒤에만 Scheduler를 생성한다.

```powershell
powershell -NoProfile -File scripts/gcp/deploy-orchestration.ps1 `
  -Apply -FullGatePassed -CreateScheduler -CommitSha <40-character-reviewed-sha>
```

8. 마지막으로 Cloudflare cron을 끄고 GCP 단독 소유로 전환한다. 두 scheduler를
   동시에 켜지 않는다. 장애 시 GCP Scheduler/Job을 먼저 끈 뒤 Cloudflare를
   복구하고, 이전 snapshot pointer를 유지한다.

## 완료 판정

배포 완료라고 부르려면 다음 실측 증거가 모두 있어야 한다.

- Cloud Run Job/Workflows/Scheduler 리소스가 같은 reviewed SHA와 project에 존재
- Scheduler가 실제 4회 KST 스케줄과 `workflow`/`scheduler` service account를 사용
- canary run의 source count=12, top issues=5, quality gate=pass
- active pointer와 manifest SHA가 일치하고 public payload에 raw body/HTML/sentence text가 없음
- reader `/healthz`, `/active`와 Vercel `/version`, `/`, `/outlets`, `/framing` 확인
- 이전 pointer와 rollback 경로 보존

현재 저장소 상태에서는 위 적용을 실행하지 않았으며, 실제 GCP/Vercel 배포는
아직 완료로 표시하지 않는다.
