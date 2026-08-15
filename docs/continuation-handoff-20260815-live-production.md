# 2026-08-15 실반영 기준일 인수인계

이 문서는 7월 26일 데모 데이터로 되돌리지 않고 2026-08-15를 첫 실기사 기준일로 삼아 AgendaFrame을 실제 AI 분석·검증·공개 스냅샷 흐름으로 전환한 작업 기록이다. 코드와 오프라인 검증 완료, 실제 Vertex 실행·current pointer 교체·Vercel 공개 화면 검증은 별도로 구분한다.

## 1. 발견한 문제와 이번 수정

- scripts/cluster_today_issues.mjs와 기존 정적 산출물은 수동 사건 정의, 제목 키워드, slice(0, 15), 임의 locator/hash에 의존했다. 이 경로는 운영 경로에서 제외한다.
- 7월 26일 prototype/static issue와 8월 15일 live ID가 섞이거나, hydration 뒤 D1 issue 목록이 active snapshot을 덮어쓸 수 있었다.
- 본문 첫 문단이나 articleBody가 제목으로 노출될 수 있었고, 근거 없는 비교·프레이밍 문장이 정상 분석처럼 보일 수 있었다.
- 점수가 null 또는 0으로 고정되는 경로가 있었고, 실제 invocation lineage 없이 Vertex 모델명을 표시하는 경로가 있었다.
- 확인 시점의 GCP current pointer는 2026-08-14 canary(runId=canary-12-20260814-f)를 가리켰다. 해당 manifest의 issue는 title-fallback-*, 점수 null, 매체 수 1인 구형 산출물이라 새 완료 조건을 만족하지 않는다.

## 2. 구현된 운영 경로

### 수집·제목 정제

- src/backend/gcp_live_dependencies.py는 JSON-LD NewsArticle.headline → og:title → 검증된 HTML title → RSS title 순서로만 제목을 선택한다.
- articleBody, description, listing anchor, 본문 문장을 제목 fallback으로 사용하지 않는다. 제목을 확인할 수 없으면 수집하지 않고 title_source를 보존한다.
- src/crawler/models.py의 ArticleDocument.title_source와 metadata titleSource로 title lineage를 기록한다.
- private body는 분석 중에만 vault/object storage에서 사용하고 public manifest/bundle에는 보내지 않는다.

### 실제 AI 군집

- src/backend/gcp_stage_adapters.py의 운영 rank adapter는 전체 수집 metadata를 하나의 Vertex 초기-5 클러스터 요청에 전달한다. 운영 경로에서 수동 EVENT_DEFS, 제목 키워드 묶음, remainder singleton, title fallback을 만들지 않는다.
- AI가 반환한 same_event 군집 중 다음을 모두 만족하는 경우만 후보로 남긴다.
  - 기사 3개 이상
  - 서로 다른 매체 2개 이상
  - cohesion high 또는 medium
  - 확인 가능한 article ID만 포함
- 후보가 5개 미만이면 임의 행으로 채우지 않고 quarantine한다. 공개 게이트는 정확히 top 5 bundle만 허용한다.
- hard negative와 사건 식별은 제목 하나가 아니라 핵심 인물·기관·행위·시점·장소·정책/법안·사건 상태·기사 제목/본문 증거를 함께 사용하도록 Vertex prompt 계약으로 제한한다.

### 실제 점수

src/backend/gcp_stage_adapters.py의 observed-agenda-gcp-v1 점수는 관측 가능한 값만 사용한다.

- 매체 다양성 55%
- 기사량(log 규모) 25%
- 동일 매체 반복 보도 5%
- 배치·검색 순위는 관측되지 않은 값으로 제외
- 매체 수와 기사 수를 반영한 coverage factor 적용

공개 issue에는 agendaScore, scoreBreakdown, rankScoreVersion, sourceCount를 함께 남긴다. 화면은 0.0 placeholder가 아니라 실제 계산값만 표시한다.

### Vertex 프레이밍·이벤트 합성

- src/ai/framing.py: gemini-2.5-flash-lite, framing prompt/schema 계약, article별 실제 Vertex 응답 검증.
- src/ai/event_synthesis.py: 비교·공통점·차이점 합성에 실제 Vertex invocation receipt를 연결한다.
- 성공 결과마다 provider, model, prompt version, attempt, 완료시각, request/response SHA-256 receipt를 기록한다. 본문·prompt payload 자체는 로그나 public JSON에 기록하지 않는다.
- 근거가 없거나 출력 검증이 실패하면 explicit_not_stated, not_observed, insufficient_evidence, conflicting, analysis_failed, review_needed 중 적절한 상태로 남기고 정상 분석 문장으로 채우지 않는다.

### evidence lineage

- src/backend/gcp_stage_adapters.py가 private body의 실제 paragraph/sentence 위치와 salted sentence SHA-256을 만든다.
- public row에는 article ID, locator, hash, public paraphrase, voice/source role, model run lineage만 남긴다.
- src/backend/gcp_orchestration.py 품질 게이트는 locator의 양의 정수 paragraph/sentence, 64자리 hash, 실제 cluster/semantic/profile invocation receipt, model·prompt·runId, 본문 부재, 정확한 top-5 bundle 일치를 모두 확인한다.
- public payload 금칙어는 bodyText, raw_body, articleBody, content, HTML, sentenceText 등으로 확장했다.

## 3. active snapshot과 화면 일관성

- site/lib/active-snapshot.ts가 live mode에서 reader의 하나의 envelope만 읽고, manifest와 bundle ID가 정확히 일치하는지 확인한다.
- manifest와 envelope의 quality gate가 모두 pass가 아니면 화면에 live 결과를 표시하지 않는다.
- shell, main, issue overview, outlets, framing, report, AI ask API/page가 모두 같은 getActiveSnapshot() 결과를 사용한다.
- site/app/(shell)/shell-chrome.tsx는 hydration 후 D1 /api/issues로 issue ID를 덮어쓰지 않는다.
- demo mode는 로컬 개발용이며 7월 26일 데이터를 8월 15일 live 결과로 위장하지 않는다. Vercel production은 AGENDAFRAME_DATA_MODE=live와 AGENDAFRAME_ACTIVE_SNAPSHOT_URL을 사용해야 한다.

## 4. GCP 구조와 자동 갱신

- Cloud Run Job: agendaframe-collection-analysis
- Workflow: agendaframe-collection-analysis
- Scheduler: agendaframe-collection-4x-kst
- KST 00/06/12/18 = UTC 0 3,9,15,21 * * *
- snapshot reader: https://agendaframe-snapshot-reader-2zut37vwaq-du.a.run.app
- snapshot bucket과 project는 config/gcp-runtime.yaml 및 site/.openai/hosting.json의 기존 설정을 사용한다. 새 project/site를 만들지 않는다.
- Cloudflare cron은 GCP Scheduler와 중복 실행하지 않도록 legacy/Cloudflare ownership을 비활성화한 뒤에만 cutover한다.

각 run은 runId와 scheduled time을 갖고, 수집 → metadata persist → Vertex global cluster → 실제 Vertex framing → evidence gate → immutable manifest/active bundle 작성 → 마지막에 current pointer 교체 순으로 실행한다. 실패하면 이전 pointer를 유지한다.

## 5. 검증 결과

### 완료된 로컬 검증

- powershell -NoProfile -File scripts/check.ps1 -Mode quick: 163 passed
- powershell -NoProfile -File scripts/check.ps1 -Mode full: 163 unit/contract + integration/e2e 3 passed; eval asset은 synthetic_schema_only, release_eligible=false로 남아 있어 실제 모델 품질 증거로 사용하지 않는다.
- Python 핵심 단위 테스트: stage adapter/orchestration/job entrypoint 및 live dependency 테스트 통과
- site: typecheck 통과, lint error 없음(기존 warning 6개), 계약·품질·active snapshot 관련 테스트 29 passed
- npx next build: compile, TypeScript, static page 생성 완료

### 아직 완료로 부르면 안 되는 검증

- 현재 GCP pointer는 구형 2026-08-14 canary이며 새 코드의 2026-08-15 실제 Vertex 결과가 아니다.
- 확인된 구형 reader는 /active 200이지만 /healthz 404이다. 새 reader revision을 배포한 뒤 /healthz와 expected snapshot ID를 다시 확인해야 한다.
- public Vercel /version의 reviewed commit SHA와 실제 main/top-1/outlets/framing 화면은 새 commit 배포 후에 확인해야 한다.
- 실제 8월 15일 기사에 대한 cluster precision, unsupported claim rate, locator/hash 일치율은 실제 run과 사람 검토 전에는 측정되지 않았다.
- 로컬 audit-site.mjs는 현재 playwright-core 경로가 지정되지 않아 브라우저 audit 실행이 보류된 상태다. Next build와 계약 테스트 통과를 브라우저 렌더 통과로 대체하지 않는다.

## 6. 배포·실행 순서

~~~powershell
powershell -NoProfile -File scripts/gcp/deploy-runtime-job.ps1 -Apply -FullGatePassed -CommitSha <40-character-reviewed-sha>
gcloud run jobs execute agendaframe-collection-analysis --region asia-northeast3 --project project-40bc06fc-fb4b-46b6-a10 --update-env-vars AGENDAFRAME_RUN_ID=live-20260815-first-real,AGENDAFRAME_SCHEDULED_TIME=2026-08-15T12:00:00+09:00,AGENDAFRAME_BASIS_DATE=2026-08-15 --wait
powershell -NoProfile -File scripts/gcp/deploy-snapshot-reader.ps1 -Apply -FullGatePassed -AllowUnauthenticated -Promote -CommitSha <40-character-reviewed-sha>
npx vercel env ls production
npx vercel deploy --prod --yes
~~~

배포 후 /version, reader /healthz, reader /active, main, top-1~5의 outlets/framing/report, mobile/keyboard/failure state를 직접 확인한다. /version은 HTTP 200만으로 충분하지 않고 reviewed commit SHA가 일치해야 한다.

## Live execution evidence recorded on 2026-08-15

This section is intentionally written in ASCII because the older handoff text
was saved with a legacy Korean encoding and is displayed as mojibake in some
terminals.

- Reviewed code commits pushed to `origin/main`: `b014326` (real-AI/evidence
  fail-closed gate), `232081c` (global outlier coverage validation), and
  `de73d2d` (redistribute the collection budget after source gaps).
- The offline full gate after the implementation changes passed: 165 tests,
  including 3 integration/offline end-to-end checks. The evaluation asset still
  reports `model_quality_measured=false`, `dataset_status=synthetic_schema_only`,
  and `release_eligible=false`; this is not a real-model quality certificate.
- Cloud Build `749e7430-fb9f-4860-815d-168f96450beb` deployed the `b014326`
  runtime image. Run `live-20260815-first-real-b014326` failed at `cluster_rank`
  because the first validator rejected a response that covered the global
  outlier articles. That validator was corrected in `232081c`.
- Cloud Build `a4d7bdc8-1df7-4bfc-a46f-48986850c4dd` deployed `232081c`.
  Run `live-20260815-first-real-232081c` collected and persisted real metadata,
  then failed the publishability gate: Vertex produced only 3 publishable
  event clusters.
- Cloud Build `09a01f90-d327-4146-9a23-328bef812891` deployed `de73d2d`.
  Run `live-20260815-first-real-de73d2d` collected 32 distinct articles from 5
  sources, but the live `cluster_rank` stage was quarantined after a
  `json_decode_error` fingerprint. Re-running the same 32-article metadata
  through the deployed Vertex path produced valid JSON, but only 4 clusters
  satisfied the required minimum of 3 articles and 2 distinct media outlets;
  the fifth candidate had 2 articles. Three independent diagnostic calls had
  the same 4-publishable-cluster boundary.
- The current public reader was checked directly at
  `https://agendaframe-snapshot-reader-2zut37vwaq-du.a.run.app/active` and
  returned the prior healthy pointer: basis date `2026-08-14`, run
  `canary-12-20260814-f`, snapshot `6eccfe4f6c90ad12966b0e9b22eacfdf`.
  No failed 2026-08-15 run was promoted, and no synthetic fifth issue was
  inserted.
- Therefore the 2026-08-15 snapshot is intentionally **not published yet**.
  The runtime and fail-closed behavior are deployed and tested, but the public
  data cutover and Vercel production redeploy remain pending until a real run
  supplies five independently publishable clusters. Do not lower the gate or
  use singleton/outlier articles to fill the fifth issue.

## 7. rollback

- quality gate 실패·reader 검증 실패·public 화면 불일치 시 GCS current pointer를 바꾸지 않는다.
- pointer가 이미 바뀐 뒤 문제가 발견되면 직전 immutable snapshot ID로 pointer만 되돌리고, 새 run은 실패 상태로 남긴다.
- public app 문제는 직전 검증된 Vercel deployment로 되돌린다.
- 7월 26일 prototype/static JSON을 8월 15일 live 결과의 대체품으로 연결하지 않는다.

## 8. 남은 일과 다음 모델의 시작점

1. 새 runtime image를 reviewed commit으로 배포하고 2026-08-15 실제 run을 실행한다.
2. run 성공 시 새 manifest/pointer와 reader /healthz·/active를 확인한다.
3. Vercel production env를 live reader로 설정하고 새 commit을 배포한다.
4. 공개 /version과 실제 화면, 다섯 issue의 모든 링크를 브라우저에서 확인한다.
5. 실제 결과에 대해 사람 검토를 수행하고, 품질 목표를 충족하지 못하면 pointer를 교체하지 않는다.

완료 보고는 실제 구현/배포, 오프라인 테스트, 실제 live 검증, 사람 검토가 필요한 항목을 분리해서 작성한다.
