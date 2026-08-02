# AgendaFrame 출시·운영 기준

이 문서는 목표 운영 기준이다. 아직 운영 측정으로 달성됐다고 검증된 수치가 아니다.

## 스냅샷 게시 원칙

분석 실행은 새 `runId` 아래에 이슈·소속 기사·프레임·리포트를 추가한다. 공개 조회는 `status = success`인 최신 실행만 선택한다. 쓰기 도중 실패하면 일부 행이 남더라도 해당 실행은 `failed`가 되어 공개되지 않는다. 성공 상태 변경이 게시 포인터 역할을 하므로 기존 성공 스냅샷은 덮어쓰지 않는다.

운영 롤백은 잘못된 성공 실행을 `rolled_back`으로 전환하고 같은 기준일의 직전 성공 실행을 다시 노출하는 방식이어야 한다. 직전 성공 실행이 없으면 롤백하지 않는다. 데이터 삭제로 롤백하지 않는다.

## 출시 차단 조건

다음 중 하나라도 해당하면 새 분석 버전을 운영 기본값으로 게시하지 않는다.

- `evals/thresholds.yaml`의 locked holdout 기준을 충족하지 못했거나 평가 데이터셋 버전이 `not_configured`다.
- 독립 라벨러 2명, 불일치 adjudication, agreement report가 없다.
- 실제 과병합 사례 fixture와 hard-negative 회귀 테스트가 실패한다.
- 프레임별 recall, evidence precision/recall, citation support precision 중 하나가 기준 미달이다.
- 숫자 신뢰도를 노출하면서 별도의 calibration 평가가 없다.
- 공개 API 계약, 전체 프로덕션 빌드, 390/768/1440 반응형, 키보드 탐색, 404/500/빈 결과/오래된 데이터 상태 검증이 실패한다.
- 수집 성공률 저하 또는 부분 수집 상태를 정상 스냅샷으로 표시한다.

제목 메타데이터만 사용하는 현재 v2는 보정되지 않은 신뢰도를 숨기고, 본문 근거가 필요한 일반 사용자 비교·취재원·기사 추천을 보류하는 조건으로만 공개할 수 있다.

## 초기 SLO와 오류 예산

30일 창에서 아래 목표를 사용하되, 모니터링이 연결되기 전에는 모두 `측정 전`이다.

| 지표 | 목표 | 월 오류 예산 |
| --- | ---: | ---: |
| 공개 API 성공률 | 99.5% 이상 | 약 3시간 39분 |
| 예정 수집 완료율 | 99% 이상 | 예정 실행의 1% |
| 성공 수집 후 분석 게시 지연 | p95 30분 이하 | 초과 실행 5% |
| 캐시 응답 | p95 150ms 이하 | 초과 요청 5% |
| API 캐시 미스 | p95 500ms 이하 | 초과 요청 5% |
| LCP | p75 2.5초 이하 | 초과 세션 25% |
| INP | p75 200ms 이하 | 초과 세션 25% |
| CLS | p75 0.1 이하 | 초과 세션 25% |

오류 예산을 절반 이상 소진하면 기능 출시보다 수집·게시 신뢰성 작업을 우선한다. 전부 소진하면 새 분석 버전 게시를 중단한다.

## 필수 알림

- 매체별 수집 성공/실패, 수집 건수 급감, 부분 수집
- 마지막 성공 수집·분석·게시 시각과 예정 시각 초과
- 분석 실패율, `unavailable` API 비율, 5xx 비율과 지연 p95
- 최신 성공 스냅샷의 기준일이 KST 오늘보다 늦어지는 상태
- 클러스터 규모 급증, 단일 이슈 내 행위자 수 급증, hard-negative 오탐
- 사람 검수의 overmerge·undermerge·unsupported claim 비율

알림에는 기사 본문, 개인 정보, 관리자 토큰을 넣지 않는다. `runId`, `snapshotId`, 버전, 집계값, `requestId`만 사용한다.

## 장애 대응

1. `/api/health`에서 `runtimeMode`, 최신성, 수집·분석·게시 시각을 확인한다.
2. 영향을 받은 `runId`와 버전을 고정하고 새 분석 게시를 중단한다.
3. 부분 수집이면 직전 성공 스냅샷을 유지한다. 실패 직전 결과를 정상으로 승격하지 않는다.
4. 잘못 게시된 실행은 삭제하지 않고 승인된 롤백 절차로 `rolled_back` 처리한다.
5. hard-negative와 문제 입력을 개인 정보 없이 fixture로 만들고 회귀 테스트를 추가한다.
6. 전체 오프라인 게이트와 staging health check를 통과한 검토 커밋만 재게시한다.

## 배포 전 체크리스트

- 변경 범위와 사용자 소유 파일 보존 확인
- 비밀·본문·개인 정보가 코드, fixture, 로그, 이미지에 없는지 확인
- `npm run typecheck`, `npm run lint`, `npm test`
- 저장소에 `scripts/check.ps1`이 있는 경우 quick 및 production frontend용 full gate
- staging에서 CSP/HSTS/COOP/CORP/Referrer-Policy/Permissions-Policy 확인
- canonical, Open Graph, Twitter Card, JSON-LD, favicon, theme-color 확인
- 이전 immutable 배포와 데이터 스냅샷 롤백 경로 확인
- 별도 운영 승인 후에만 실제 배포
