# 언론사 비교·프레이밍 릴리스 상태 (2026-10-01)

전체 작업은 아직 완료되지 않았다. 코드와 오프라인 검증은 준비되었지만 실제 AI 결과 생성과 공개 배포가 남아 있다.

## 확인된 문제와 수정

- 공개 rank 2 언론사 비교 화면의 첫 세 대표 카드가 모두 KBS였다. 실제 비교 결과 없이 기존 강조 그룹으로 비교 화면을 구성하던 경로를 제거하고, 증거 연결·매체 대표성·결과 상태를 검증하도록 바꿨다.
- 현재 공개 API에서 확인한 rank 1, 2, 4는 v2.0이며 `comparison_result`가 없었다. rank 3, 5 API 조회는 시간 초과로 확인하지 못했다.
- 현재 표시 데이터 재분석 스크립트가 정적 JSON 대신 현재 `/api/initial-five` 데이터와 의제별 API를 읽도록 수정했다. 날짜와 의제 식별자가 다른 데이터는 거부한다.
- 실제 결과가 없으면 비교 보류로 표시하지만, 다섯 의제 전체가 보류인 상태는 `audit-site.mjs --release`에서 릴리스 실패로 처리한다. 보류 UI 검증 성공을 기능 완료로 취급하지 않는다.
- AI 비용 한도 오류는 재시도하지 않는다. 재실행 가능한 본문 미포함 체크포인트를 저장하고, 재개 시 새로 읽은 본문 해시와 증거 위치를 다시 검증한다.

## 실제 검증 결과

- Python full gate: 단위·계약 테스트 192 passed, 1 skipped; 통합·오프라인 E2E 3 passed. 정적 검사와 평가 데이터 검증 통과. 평가 데이터는 synthetic schema 검증이며 실제 모델 품질 검증이 아니다.
- 사이트: typecheck 통과, lint 오류 0 (기존 경고 4), 분석 테스트 34/34, 계약·릴리스 게이트 테스트 50/50, Next production build 통과.
- 로컬 렌더: 26경로 × 5뷰포트, 첫 화면 검사 10건, 모바일 상호작용 5건; 오류·경고 0. 사용한 기존 데이터의 다섯 의제는 모두 보류이며 publishable=false였다. 정상 비교 결과의 공개 렌더 검증은 아직 아니다.
- 공개 렌더 검사는 78개 데스크톱·태블릿 캡처 이후 모바일 페이지 로드 시간 초과로 중단되었다. 공개 감사 완료/통과를 주장하지 않는다.
- 현재 공개 `/version`: `538a767f5474999039c721f18a0a5256e0f57906`. 이번 변경은 아직 배포하지 않았다.

## 남은 실행 순서와 비용 차단

승인된 실행 한도 $0.50, 최대 시도 2회로 실제 재분석을 실행했지만 공급자 HTTP 403 `spend cap breached`로 실패했다. 결제 연결과 Vertex API 활성화는 확인했다. 월 15,000원 예산 알림이 존재하지만, 이것이 실제 차단 한도라는 증거는 없다. 예산 알림 변경만으로 해결된다고 주장하지 않는다.

1. 결제 권한자가 Google Cloud Billing의 Budgets & alerts / spend cap details에서 실제 적용된 차단 한도와 범위를 확인한다. 계정·프로젝트를 바꾸거나 한도를 우회하지 않는다. 월 한도 해제는 실행당 $0.50 승인과 별개의 비용 위험이 있으므로 자동 수행하지 않는다.
2. 차단이 해소되고 비용 제한이 유지되면 아래 명령으로 실제 결과 후보를 생성한다. 이전 실패 실행에는 완성 후보가 없었다. 새 체크포인트가 생성된 뒤 중단되면 `--resume-checkpoint <path>`를 사용한다. 공개 입력이 바뀌면 체크포인트 재사용은 거부된다.
3. 후보의 receipt, 증거 articleId/locator/hash, 다른 매체 대표 기사, unsupported claim과 전체 보류 여부를 검토한다. 단순 성공 HTTP 응답이나 합성 fixture를 실제 AI 결과로 사용하지 않는다.
4. 검토된 immutable snapshot을 staging reader에 적용하고 건강 상태·활성 snapshot을 확인한 후 production을 전환한다. `docs/deploy.md`의 절차를 따른다.
5. 검토된 commit으로 Vercel을 배포하고 공개 `/version` 일치 및 실제 `/outlets`, `/framing`을 `--release`로 검증한다. 실패하면 기존 production을 유지하거나 이전 검증 버전으로 되돌린다.

```powershell
$env:AGENDAFRAME_LIVE_TESTS = '1'
$env:AGENDAFRAME_NONPROD_PROJECT_ID = 'project-40bc06fc-fb4b-46b6-a10'
$env:PYTHONPATH = Join-Path (Get-Location) 'src'
.venv\Scripts\python.exe scripts/run-current-display-framing-live.py --live --budget-usd 0.50 --max-attempts 2 --gcloud-bin 'C:\Users\강준혁\AppData\Local\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd' --gcloud-config .codex-gcloud-auth --output-root tmp/current-display-batch/candidate-live-20261001 --summary-root tmp/current-display-batch
```

이 문서는 인증 토큰, 기사 원문, 공급자 원본 응답을 포함하지 않는다. 기존 작업 폴더의 변경은 보존했고 별도 `codex/comparison-framing-release-20261001` 브랜치에서 수정했다.
