# AgendaFrame 공개 API 계약 v4

기계 판독 가능한 단일 계약 원본은 [`public-api.schema.json`](public-api.schema.json)이다. 런타임은 이 파일의 `x-api-version` 값을 읽어 모든 공개 응답의 `meta.schemaVersion`으로 사용한다.

## 공통 원칙

- `demo`와 `live_metadata`는 같은 응답 구조를 사용한다. 데이터 출처만 `meta.runtimeMode`로 구분한다.
- 저장소 오류가 발생한 live 환경은 데모 데이터로 조용히 대체하지 않고 `503`, `runtimeMode: unavailable`을 반환한다.
- 모든 분석 응답은 `snapshotId`, `runId`, 기준일, 게시 시각, 출처 정책·클러스터링·점수·프레임·모델·프롬프트·평가 데이터셋 버전을 포함한다.
- 공개 읽기 응답은 `ETag`와 `Cache-Control`을 사용한다. 클라이언트는 `If-None-Match`로 `304`를 받을 수 있다.
- 오류는 `{ "error": { "code", "message" }, "requestId" }` 구조다. 서버 로그와 사용자 문의는 본문이 아니라 `requestId`로 연결한다.
- 기사 목록은 `cursor`를 우선 사용한다. 기존 `offset`은 하위 호환을 위해 유지한다.

## 근거와 보류 상태

기본 수집 범위는 제목·원문 URL·매체·섹션·게시/수집 시각·반복 관측된 홈페이지 배치다. BigKinds `본문` 열은 파일의 수집 상태가 `본문 확보`이면 `article_body`, 기존 미리보기·발췌이면 `provider_excerpt`로 명시해 일시 처리한다. 공개 기사 HTML도 Worker 메모리에서 처리한 뒤 기사 전문·발췌·HTML·원문 문장을 D1·R2·로그에 쓰지 않는다. 기사별로 분석 상태, 비복원 해시, 글자 수, 문제 정의·원인·책임·평가·해법·취재원 구조, 근거 위치와 분석 버전만 저장한다. 공개 API는 구조화 결과와 원문 링크를 반환하며 `sample.textScope`으로 `provider_excerpt`와 `article_body`를 구분한다. 정식 라이선스 자료의 별도 보관은 호환용 `POST /api/content` 경로로 분리한다.

따라서 `comparison`은 다음 조건을 만족하기 전까지 `withheld_insufficient_evidence`다.

1. 공통 사실마다 서로 독립적인 출처의 본문 근거 문장과 기사 ID·원문 URL이 연결돼 있다.
2. 설명 차이마다 문제 정의, 원인·책임, 평가, 해법 중 어느 요소인지와 상반된 답변 그룹의 근거 문장이 있다.
3. 취재원은 실제 인용문과 화자 정보를 통해 분류된다.
4. 추천 기사 두 건의 상호보완성이 근거 범위와 함께 검증된다.

제목만으로 위 내용을 추정하지 않는다. 구조화 엔진은 기사별 문제 정의·원인·책임·평가·해법을 먼저 판정하고 근거 위치·비복원 해시를 연결한 뒤에만 매체 간 비교를 만든다. 인용된 취재원 발언은 기자 서술과 분리하며, 관측되지 않은 요소는 `not_observed`로 유보한다. 결과는 확률이나 정치 성향 점수가 아니라 사람 검토 전 자동 구조화 초안이다.

## 구조화 비교의 분석 모듈

신규 기사 프로필로 생성한 `GET /api/issues/:id`의 `comparison.analysisModules`에는 `frameComposition`, `reportingStyle`, `morphology`가 포함될 수 있다. 과거 스냅샷 또는 신규 프로필이 충분하지 않은 비교에는 이 필드가 없을 수 있으므로 클라이언트는 선택 필드로 처리해야 한다. 각 모듈의 `status`가 `partial`이거나 하위 지표가 `abstained`이면 빈 값을 추정해 채우지 않는다.

### `frameComposition`

`frameComposition.unit`은 `article_presence`, `multiLabel`은 `true`다. 매체별 `byOutlet[].labels[]`는 다음 관측치를 제공한다.

- `articleCount`: 해당 라벨이 한 번 이상 관측된 기사 수
- `articleShare`: `articleCount / analyzedArticles`
- `sentenceCount`: 라벨 근거가 관측된 문장 수
- `compositionShare`: 해당 매체의 전체 기사-라벨 할당 중 해당 라벨의 비율
- `evidenceRefs`: 라벨을 뒷받침하는 기사·근거 위치·해시·원문 링크

같은 라벨을 한 기사에서 반복해도 `articleCount`는 한 번만 센다. 한 기사에는 여러 라벨이 붙을 수 있으므로 `articleShare` 합계는 1이 아닐 수 있고, 누적 막대에는 합이 1이 되는 `compositionShare`를 사용한다. 이는 Policy Frames Codebook 기반 보조 표현 태그이며 매체 성향 점수가 아니다.

### `reportingStyle`

`reportingStyle.byOutlet[]`에는 `evaluation`과 `scope`가 있다.

- `evaluation.index`는 기사별 `(긍정 평가 수 - 부정 평가 수) / (긍정 평가 수 + 부정 평가 수)`를 관측 기사끼리 평균한 값이다. 기자 서술의 명시적 정당성 평가만 사용하며, 인용된 취재원의 평가는 `attributedOnlyArticles`에만 반영한다.
- `scope.index`는 기사별 `(주제적 문장 수 - 일화적 문장 수) / (주제적 문장 수 + 일화적 문장 수)`를 관측 기사끼리 평균한 값이다.
- 두 지수의 범위는 `-1`부터 `+1`이다. 근거가 없으면 `status: "abstained"`, `index: null`이며, 이를 0이나 중앙점으로 해석해서는 안 된다.
- `evidenceRefs`는 계산에 사용된 기사와 문단·문장 위치, 해시, 원문 URL을 제공한다.

평가 지수는 정치 성향·매체 지지도·사실성 점수가 아니다. 보도 범위 지수도 일화적 또는 주제적 보도의 우열을 판정하지 않는다.

### `morphology`

현재 `morphology.analyzer.mode`는 `controlled_lexicon_fallback`이다. Unicode 정규화, 어절 분리, 흔한 조사 제거와 일부 용언 원형화를 수행하는 경량 규칙형 분석이며 Kiwi·MeCab 수준의 완전한 형태소/POS 분석으로 해석하면 안 된다. 정식 연구 파이프라인에서는 Kiwi를 오프라인 배치에서 실행하고, 원문이나 토큰열이 아니라 같은 계약의 집계 신호만 가져오는 방식을 권장한다.

토큰화 및 lemma·POS 매칭은 코드북 후보를 찾는 단계일 뿐이다. 문제 정의·원인·책임·평가·해법의 최종 판정에는 문장 내 개념 조합, 고정밀 구문, 부정 표현과 직접·간접 인용 화자 구분을 함께 적용하며, 근거가 부족하면 유보한다.

공개 핵심어에는 k-익명성에 준하는 최소 노출 기준을 적용한다.

- `minimumDocumentFrequency: 2`: 같은 이슈의 서로 다른 기사 2건 이상에서 관측
- `minimumMediaGroupFrequency: 2`: 서로 다른 독립 미디어그룹 2곳 이상에서 관측
- `byOutlet[].terms`: 위 두 조건을 모두 만족한 lemma·품사 조합 중 매체별 최대 15개
- `perThousand`: 해당 매체의 내용어 1,000개당 관측 빈도

`tokenCount`, `contentTokenCount`, `negationCount`, `posCounts`, 단어별 집계는 순서를 포함하지 않는다. `negationCount`는 `않다·아니다·못하다·없다`처럼 명시적으로 정규화된 부정 표지 수이며, 평가의 긍정·부정 판정과는 별개의 문법적 관측치다. API와 저장 프로필은 기사 원문·문장·인용문·HTML 및 형태소·토큰 순서열을 반환하거나 저장하지 않는다. 희귀 핵심어는 공개 비교에서 제외하며, 공개된 각 핵심어의 `evidenceRefs`도 원문 문장 대신 기사 ID, 원문 URL, `evidenceLocator`, `evidenceHash`만 담는다.

## 분석 근거 참조

`analysisModules`에서 사용하는 `evidenceRefs[]`의 필드는 다음과 같다.

- `source`: 언론사명
- `articleId`: 내부 기사 식별자
- `sourceUrl`: 독자가 확인할 수 있는 원문 URL
- `evidenceLocator`: `N문단 M문장` 형식의 위치 또는 `null`
- `evidenceHash`: 근거 문장의 비복원 SHA-256 지문 또는 `null`

근거 참조는 분석값을 기사로 추적하기 위한 장치이며 원문 문장을 재배포하는 수단이 아니다. 공개 응답에 문장 텍스트가 없더라도 독자는 `sourceUrl`에서 원문과 문맥을 직접 확인할 수 있어야 한다.

## 공개 경로

| 경로 | 설명 | 캐시 |
| --- | --- | --- |
| `GET /api/health` | 수집·분석·게시 시각과 최신성 상태 | `no-store` |
| `GET /api/sources` | 방송을 제외한 22개 매체의 유형·미디어그룹과 정책 버전 | 5분 |
| `GET /api/articles` | 기사 메타데이터 탐색, cursor 페이지네이션 | 1분 |
| `GET /api/issues/dates` | 공개 가능한 성공 분석 날짜 목록 | 5분 |
| `GET /api/issues` | 최신 또는 `date=YYYY-MM-DD` 성공 스냅샷의 상위 의제 | 1분 |
| `GET /api/issues/:id` | 이슈·기사·근거·보류 상태 상세 | 5분, immutable |

쓰기·품질 검수 API는 관리자 토큰이 필요하며 공개 스키마의 범위가 아니다.

- `POST /api/observations/homepage`: 고정 뷰포트의 홈페이지 배치 관측과 좌표·순위 저장
- `POST /api/content`: 정식 라이선스 자료가 필요한 예외 상황에서만 전문을 비공개 객체 저장소에 등록
- `GET /api/analyze/transient`: 날짜별 본문 분석 성공·실패·남은 기사 수와 적용 버전 조회
- `POST /api/analyze/transient`: 등록된 공식 기사 URL을 최대 20건씩 제한 요청하고, 미처리 기사가 없어질 때까지 재개 가능한 배치로 분석한 뒤 전문 없이 구조화 결과만 저장

운영 롤백은 `POST /api/analysis/runs/:id/rollback`으로 수행한다. 관리자 토큰과 같은 출처 요청이 필요하고, 같은 기준일의 직전 성공 스냅샷이 있을 때만 대상 실행을 `rolled_back`으로 바꾼다. 행을 삭제하지 않으며 이미 롤백되거나 실패한 실행은 다시 롤백할 수 없다.

## 호환성 규칙

- 필드 삭제·의미 변경은 새 `schemaVersion`에서만 한다.
- 필드를 추가할 때도 클라이언트가 모르는 필드를 무시할 수 있어야 한다.
- 의제 대분류는 정치·경제·사회·국제를 우선하고 스포츠·생활·IT를 뒤에 둔다. 정책·규제 성격의 기술 기사는 내용에 따라 핵심 대분류로 재분류하며, 연예·문화·여행·레저 기사는 원본 메타데이터를 삭제하지 않되 의제 분석에서는 제외한다.
- 과거 `agenda-rules-v1` 스냅샷은 잘못 보정된 신뢰도와 배치 점수를 공개하지 않는다. `agendaScore: null`, `legacy_reanalysis_required`로 반환한다.
- 새 분석이 실패하면 `running` 또는 `failed` 실행은 공개 선택 대상이 아니다. 마지막 `success` 스냅샷만 유지된다.
