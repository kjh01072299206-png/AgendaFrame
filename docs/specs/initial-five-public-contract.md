# Initial-five public read contract

이 문서는 2026년 7월 26일 초기 5개 의제의 공개 읽기 모델을 정의한다. 빌더는
현재의 `site/data/top5-2026-07-26.json`,
`site/data/metadata-clusters-2026-07-26.json`, 그리고 존재하는
`site/data/semantic-rank*-2026-07-26/` 디렉터리만 읽는다. 네트워크, AI, 뉴스,
클라우드 호출은 하지 않는다.

## 사용 방법

기본 실행은 얇은 매니페스트를 표준 출력으로 내보낸다.

```powershell
node scripts/build-initial-five.mjs --manifest
```

한 의제만 읽을 때는 의제 ID를 지정한다.

```powershell
node scripts/build-initial-five.mjs --issue bigkinds-2026-07-26-top-1
```

오프라인 상태 점검은 다음과 같다.

```powershell
node scripts/build-initial-five.mjs --check
```

배포 산출물을 별도 디렉터리에 만들 때만 `--out`을 사용한다. 기본 실행은
원본 데이터나 저장소 파일을 쓰지 않는다.

`package.json`에 스크립트가 등록돼 있고 `npm run build`가 이 스크립트를 먼저 돌린다.

```json
{
  "data:build:initial-five": "node scripts/build-initial-five.mjs --out public/initial-five"
}
```

산출물이 `public/`으로 가므로 빌드에 그대로 포함되고, Next 라우트 핸들러
`app/api/initial-five/*`가 이를 읽어 공개 API로 응답한다.

## 공개 상태

`AnalysisState`는 다음 여섯 값만 허용한다.

| 상태 | 의미 |
| --- | --- |
| `queued` | 분석 대기 중 |
| `running` | 분석 실행 중 |
| `retry_wait` | 일시 오류 후 재시도 대기 |
| `succeeded` | 해당 엔진의 검증된 출력이 존재함 |
| `review_needed` | 출력이 없거나 검증·사람 검토가 더 필요함 |
| `dead_letter` | 허용된 재시도 후에도 처리하지 못함 |

`succeeded`는 사람 검토가 끝났다는 뜻이 아니다. 현재 AI 프레이밍 파일의
`automatic_draft` 상태처럼 AI 호출과 구조 검증이 성공했지만 사람 검토가 필요한
경우에도 엔진 상태는 `succeeded`, `reviewRequired`는 `true`가 될 수 있다.

2026-08-06 기준으로 rank 1–5 전부 `succeeded`다. 메타데이터 클러스터 5개에 AI
출력이 있고, 본문 시맨틱 프로필도 25건(7·6·4·4·4) 전부 존재한다.
`reviewNeededArticleCount`는 다섯 의제 모두 0이다.

이 문서를 처음 쓸 때는 rank 1의 7건만 있었고 rank 2–5는 `review_needed`였다.
그 상태를 다루는 규칙 자체는 그대로 유효하다 — 파일이 없거나 무효인 의제는
지금도 `review_needed`·`unavailable`로 공개하고, 규칙 기반 프로필이 그 상태를
대신하지 않는다.

`succeeded`가 사람 검토 완료를 뜻하지 않는다는 원칙도 그대로다. 25건은 서로 다른
각도의 AI 코더 2인이 독립 코딩한 뒤 판정을 거친 결과이며(평균 층위 일치 89.3%,
`site/data/coder-agreement-2026-07-26.json`), 사람 코더 검증은 아직 0건이다.

## 매니페스트

`InitialFiveManifest`는 첫 화면과 라우팅에 필요한 얇은 목록이다.

```js
{
  schemaVersion: "agendaframe.initial-five.public.v1",
  basisDate: "2026-07-26",
  generatedAt: "...",              // 입력 산출물의 생성 시각
  issueCount: 5,
  articleCount: 25,
  issues: [{
    issueId,
    rank,
    title,                           // 고정된 사건 중심 표시 제목
    category,
    articleCount,
    outletCount,
    status: AnalysisState,
    payloadKey: "issues/<issueId>.json",
    clusterAi: {
      status,
      engineLabel: "ai_semantic" | "unavailable",
      semanticAi,
      model,
      promptVersion,
      schemaVersion
    },
    semantic: {
      status,
      engineLabel: "ai_semantic" | "unavailable",
      semanticAi,
      model,
      promptVersion,
      schemaVersion,
      succeededArticleCount,
      reviewNeededArticleCount
    }
  }],
  lineage: { top5SchemaVersion, metadataSchemaVersion, metadataGeneratedAt }
}
```

매니페스트에는 기사 본문, 기사 프로필 배열, 전체 비교 결과를 넣지 않는다.

## 의제 번들

`IssueAnalysisBundle`은 `getIssue(issueId)`가 요청될 때 한 의제만 만든다.

- `issue`: 의제 ID, 순위, 고정 제목, 기사 수, 매체 수
- `analysisStatus`: 클러스터·본문 시맨틱별 상태와 처리 건수
- `clusterAi`: 메타데이터 AI의 모델·프롬프트·스키마·결정·요약·변형·이탈 기사
- `articles`: 기사 ID, 제목, 매체, 매체 ID, 게시 시각, URL, 본문 해시와 분석 상태
- `semanticProfiles`: 기사별 AI 시맨틱 상태, 모델·프롬프트·스키마, 공개 프로필과 근거
- `ruleProfiles`: 기사별 규칙 기반 보조 프로필과 근거
- `comparison`: 기존 비교 결과를 `rules_local` 엔진으로 명시한 보조 집계
- `lineage`: 입력 스키마·생성 시각·시맨틱 디렉터리·계약 버전

비교·규칙 프로필의 `engine.label`은 항상 `rules_local`이고 `semanticAi`는
`false`다. AI 본문 프로필의 `engine.label`은 다음 조건을 모두 만족할 때만
`ai_semantic`이다.

1. `engine.semantic_ai === true`
2. `review.analysis_decision === "analyze"`
3. fallback 사유가 없음
4. 본문 해시가 있음
5. 최소 하나의 공개 근거 로케이터 또는 문장 해시가 있음

그 밖의 프로필, 파일 누락, 잘못된 JSON, 빈 AI 응답은 `review_needed`와
`unavailable`로 공개한다. `rules_local` 성공을 AI 성공으로 승격하지 않는다.

## 근거·개인정보 경계

공개 근거는 다음 정보만 보존한다.

```js
{
  articleId,
  sourceId,
  locator: { paragraph, sentence },
  sentenceSha256
}
```

현재 공개 산출물에 근거 로케이터와 해시만 있으면 빌더는 인용문이나 기사 본문을
만들지 않는다. `public_paraphrase`와 클러스터 요약처럼 이미 산출물에 들어 있는
구조화 문장은 보존할 수 있지만, 원문 인용으로 표시하지 않는다.

다음 키는 공개 프로젝션에서 제거하고 계약 테스트에서 누출을 검사한다.

- `raw_body`
- `body_text`
- `sentence_text`
- `html`
- `full_article`
- `article_content`
- `full_content`

본문 글자 수·문장 수·본문 해시 같은 메타데이터는 원문 자체가 아니므로 보존할
수 있다. 공개 모델에는 본문 문자열, HTML, 문장 배열, 토큰 원문을 넣지 않는다.

## 입력과 결정성

입력 산출물의 생성 시각을 재사용하므로 기본 빌드는 현재 시각이나 난수에
의존하지 않는다. 같은 입력 디렉터리에서 두 번 빌드한 매니페스트는 동일해야
한다. 시맨틱 디렉터리가 없거나 프로필이 무효인 경우에도 빌드는 중단하지 않고
해당 기사와 의제를 `review_needed`로 표시한다.

## 코더 일치도

매니페스트는 `coderAgreement`를 함께 싣고, 의제별 번들은 그 의제 기사만으로
값을 다시 계산해 넣는다. 25건 전부를 덮지 않는 입력이나 요약 수치가 재계산과
어긋나는 입력은 빌더가 거부한다.

두 코더는 사람이 아니라 서로 다른 프롬프트 각도의 모델 코더다. 산출물의
`coder_limit` 필드가 이 한계를 명시하며, 화면과 문서에서 사람 코더 간
신뢰도로 표시하지 않는다.

## 계약 테스트

`site/tests/initial-five-contract.test.mjs`가 다음을 검사한다.

- 5개 의제·25개 기사와 고정 제목
- 얇은 매니페스트와 결정성
- 클러스터 AI 메타데이터, 규칙 엔진과 AI 엔진 라벨 분리
- 의제 하나의 번들에 기사 메타데이터·계보·상태·근거 로케이터가 들어감
- 25건 전부가 AI 성공과 근거 검증을 통과한 뒤에만 공개됨
- AI `analyze`·비fallback·근거 존재 조건
- 금지 키와 원문 누출 부재
- 운영 워커가 매니페스트와 지연 로딩 번들을 서빙함
- 질문 응답이 공개된 근거 안에서만 나옴
- 코더 일치도가 전 기사를 덮고 의제별로 재계산됨
