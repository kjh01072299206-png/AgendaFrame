# AgendaFrame 배포·검증 절차

최종 공개 주소는 https://agendaframe-capstone.vercel.app 이다. site/는 Vercel 앱이고, 기사 수집·Vertex 분석·immutable snapshot은 기존 GCP 리소스가 담당한다. 이 둘의 배포 성공을 하나의 완료 주장으로 합치지 않는다.

## 사전 조건

- git status --short로 기존 dirty/untracked 파일을 확인하고, 의도한 파일만 stage한다.
- scripts/check.ps1 -Mode full과 사이트 gate를 통과한 reviewed commit만 배포한다.
- GCP project, billing account, budget, service account, Cloud Run Job image를 확인한다. 이 저장소의 trial project에 environment label이 없으면 non-production임을 별도로 인증할 수 없으므로 실행 결과를 명시적으로 기록한다.
- Vercel token, GCP credential, 기사 본문, prompt payload를 로그에 출력하지 않는다.

## 오프라인 검증

~~~powershell
powershell -NoProfile -File scripts/check.ps1 -Mode quick
powershell -NoProfile -File scripts/check.ps1 -Mode full
cd site
npm run typecheck
npm run lint
node --test --test-isolation=none tests/initial-five-contract.test.mjs tests/community.test.mjs tests/active-snapshot-contract.test.mjs tests/live-2026-08-15-quality.test.mjs tests/semantic-analysis-pages-contract.test.mjs
npx next build
npx next start -p 3000
node scripts/audit-site.mjs --url http://127.0.0.1:3000
~~~

audit-site.mjs가 브라우저 runtime을 찾지 못하면 AF_PW에 설치된 playwright-core entrypoint를 지정하고 다시 실행한다. build/contract 테스트만으로 렌더 audit 성공을 주장하지 않는다.

## GCP runtime과 첫 8월 15일 실행

배포 스크립트는 기본 dry-run이다. -Apply -FullGatePassed를 붙일 때만 Cloud Build와 Cloud Run 변경을 수행한다.

~~~powershell
powershell -NoProfile -File scripts/gcp/deploy-runtime-job.ps1 -Apply -FullGatePassed -CommitSha <40-character-reviewed-sha>
gcloud run jobs execute agendaframe-collection-analysis --project project-40bc06fc-fb4b-46b6-a10 --region asia-northeast3 --update-env-vars AGENDAFRAME_RUN_ID=live-20260815-first-real,AGENDAFRAME_SCHEDULED_TIME=2026-08-15T12:00:00+09:00,AGENDAFRAME_BASIS_DATE=2026-08-15 --wait
~~~

실행이 실패하거나 품질 gate가 quarantine하면 current pointer는 유지되어야 한다. 성공만으로 공개 완료가 아니며, manifest의 실제 agendaScore, 5개 issue, issue별 3개 이상 기사·2개 이상 매체, cluster/semantic/profile receipt, locator/hash를 확인한다.

## Snapshot reader

~~~powershell
powershell -NoProfile -File scripts/gcp/deploy-snapshot-reader.ps1 -Apply -FullGatePassed -AllowUnauthenticated -Promote -CommitSha <40-character-reviewed-sha>
powershell -NoProfile -File scripts/gcp/verify-snapshot-reader.ps1 -Execute -ReaderUrl https://agendaframe-snapshot-reader-2zut37vwaq-du.a.run.app -ExpectedSnapshotId <new-snapshot-id>
~~~

/healthz가 200이고 /active의 snapshot ID·quality gate·본문 부재·정확한 bundle set이 일치하기 전에는 Vercel live env를 바꾸지 않는다.

## Vercel production

production env는 다음 두 이름을 사용한다.

- AGENDAFRAME_DATA_MODE=live
- AGENDAFRAME_ACTIVE_SNAPSHOT_URL=<reader-url>/active

값을 설정한 뒤 root에서 배포한다.

~~~powershell
npx vercel env ls production
npx vercel deploy --prod --yes
~~~

배포 확인은 다음 순서다.

1. https://agendaframe-capstone.vercel.app/version의 HTTP 상태와 reviewed commit SHA 확인
2. /에서 2026-08-15 basis date와 같은 top 5 확인
3. top 1~5 각각의 overview, outlets, framing, report 링크 확인
4. 새로고침·모바일 폭·키보드 이동·live reader 실패 상태 확인
5. public 응답에 bodyText, raw_body, articleBody, content, HTML, sentenceText가 없는지 확인

/version HTTP 200 또는 Vercel deployment 생성만으로 화면 검증을 대신하지 않는다.

## 실패와 rollback

- GCP 품질 gate 실패: pointer를 교체하지 않고 run을 quarantine한다.
- pointer 교체 후 reader/public 검증 실패: 직전 immutable snapshot ID로 pointer를 되돌린다.
- Vercel 화면·commit 불일치: 직전 검증된 production deployment로 되돌린다.
- 7월 26일 demo JSON이나 prototype issue를 live fallback으로 연결하지 않는다.

자세한 2026-08-15 상태와 현재 미완료 항목은 continuation-handoff-20260815-live-production.md를 참조한다.
