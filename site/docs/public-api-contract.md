# AgendaFrame 공개 API 계약 v3

기계 판독 가능한 단일 계약 원본은 [`public-api.schema.json`](public-api.schema.json)이다. 런타임은 이 파일의 `x-api-version` 값을 읽어 모든 공개 응답의 `meta.schemaVersion`으로 사용한다.

## 공통 원칙

- `demo`와 `live_metadata`는 같은 응답 구조를 사용한다. 데이터 출처만 `meta.runtimeMode`로 구분한다.
- 저장소 오류가 발생한 live 환경은 데모 데이터로 조용히 대체하지 않고 `503`, `runtimeMode: unavailable`을 반환한다.
- 모든 분석 응답은 `snapshotId`, `runId`, 기준일, 게시 시각, 출처 정책·클러스터링·점수·프레임·모델·프롬프트·평가 데이터셋 버전을 포함한다.
- 공개 읽기 응답은 `ETag`와 `Cache-Control`을 사용한다. 클라이언트는 `If-None-Match`로 `304`를 받을 수 있다.
- 오류는 `{ "error": { "code", "message" }, "requestId" }` 구조다. 서버 로그와 사용자 문의는 본문이 아니라 `requestId`로 연결한다.
- 기사 목록은 `cursor`를 우선 사용한다. 기존 `offset`은 하위 호환을 위해 유지한다.

## 근거와 보류 상태

기본 수집 범위는 제목·원문 URL·매체·섹션·게시/수집 시각·반복 관측된 홈페이지 배치다. 기사 본문은 이용 권한과 분석 허용을 관리자가 확인한 자료만 비공개 객체 저장소에 분리 보관한다. 공개 API는 전문이나 비공개 근거 문장을 반환하지 않는다.

따라서 `comparison`은 다음 조건을 만족하기 전까지 `withheld_insufficient_evidence`다.

1. 공통 사실마다 서로 독립적인 출처의 본문 근거 문장과 기사 ID·원문 URL이 연결돼 있다.
2. 설명 차이마다 문제 정의, 원인·책임, 평가, 해법 중 어느 요소인지와 상반된 답변 그룹의 근거 문장이 있다.
3. 취재원은 실제 인용문과 화자 정보를 통해 분류된다.
4. 추천 기사 두 건의 상호보완성이 근거 범위와 함께 검증된다.

제목만으로 위 내용을 추정하지 않는다. 승인 본문이 있어도 현재 규칙 공급자는 표현 단서만 검출하며, 구조화 비교와 사람 검토가 끝나기 전에는 원인·책임·해법·취재원 비교를 보류한다. 제목 또는 승인 본문에서 검출되지 않은 프레임 요소는 0점과 `not_detected`로 기록하며, 확률이나 신뢰도처럼 표시하지 않는다.

## 공개 경로

| 경로 | 설명 | 캐시 |
| --- | --- | --- |
| `GET /api/health` | 수집·분석·게시 시각과 최신성 상태 | `no-store` |
| `GET /api/sources` | 활성 매체 표본과 정책 버전 | 5분 |
| `GET /api/articles` | 기사 메타데이터 탐색, cursor 페이지네이션 | 1분 |
| `GET /api/issues` | 최신 성공 스냅샷의 상위 이슈 | 5분, immutable |
| `GET /api/issues/:id` | 이슈·기사·근거·보류 상태 상세 | 5분, immutable |

쓰기·품질 검수 API는 관리자 토큰이 필요하며 공개 스키마의 범위가 아니다.

- `POST /api/observations/homepage`: 고정 뷰포트의 홈페이지 배치 관측과 좌표·순위 저장
- `POST /api/content`: 이용 근거가 확인된 기사 전문을 비공개 객체 저장소에 등록

운영 롤백은 `POST /api/analysis/runs/:id/rollback`으로 수행한다. 관리자 토큰과 같은 출처 요청이 필요하고, 같은 기준일의 직전 성공 스냅샷이 있을 때만 대상 실행을 `rolled_back`으로 바꾼다. 행을 삭제하지 않으며 이미 롤백되거나 실패한 실행은 다시 롤백할 수 없다.

## 호환성 규칙

- 필드 삭제·의미 변경은 새 `schemaVersion`에서만 한다.
- 필드를 추가할 때도 클라이언트가 모르는 필드를 무시할 수 있어야 한다.
- 과거 `agenda-rules-v1` 스냅샷은 잘못 보정된 신뢰도와 배치 점수를 공개하지 않는다. `agendaScore: null`, `legacy_reanalysis_required`로 반환한다.
- 새 분석이 실패하면 `running` 또는 `failed` 실행은 공개 선택 대상이 아니다. 마지막 `success` 스냅샷만 유지된다.
