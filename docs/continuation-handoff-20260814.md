# AgendaFrame continuation handoff — 2026-08-14 KST

## Current repository state

- Repository: `C:\Users\강준혁\Desktop\구글캡디_문서`
- Branch: `codex/initial-five-complete`
- Current saved checkpoint: the latest commit on this branch (verify with
  `git rev-parse HEAD`); it includes the guarded runtime-services provisioner,
  contract test, and this handoff update.
- `origin/main` is an ancestor of this branch; the branch is ahead of it and
  does not require another merge at this checkpoint.
- The current branch already contains the other-computer release merge
  `9f1f627`, whose history includes `5d178d1`; do not re-run the abandoned
  broad conflict merge. The current HEAD is the later runtime-observability
  checkpoint (verify it with `git rev-parse HEAD`).
- Current offline evidence: root full gate **137 unit/contract + 3
  integration/e2e passed** and site `npm test` **186 passed**. Site typecheck
  passes; lint has 0 errors and four pre-existing warnings.
- A reviewed `git push origin HEAD:main` was attempted from this checkpoint
  and failed because this environment could not resolve `github.com`; no
  remote main or Vercel production deployment changed.
- This handoff is committed with the current runtime/observability slices;
  future changes should update it rather than rewriting prior checkpoints.
- Preserve unrelated untracked worktrees, logs, feedback, `outputs/`, `.grok/`,
  and any user/other-model changes. Never use `git reset --hard`,
  `git checkout --`, or `git add -A`.

## Product boundary that is now implemented in code

The production target remains the existing AgendaFrame site. The main shell,
existing Cloudflare/D1 API path, and existing routes are not replaced in demo
mode. A live switch is explicit:

- `AGENDAFRAME_DATA_MODE=demo` (default): preserve the existing home/API and
  initial-five behavior.
- `AGENDAFRAME_DATA_MODE=live` plus
  `AGENDAFRAME_ACTIVE_SNAPSHOT_URL=https://<snapshot-reader>/active`: use one
  body-free GCP active snapshot for the main page, outlet comparison, and
  framing analysis.

The current live snapshot envelope is validated before use. It must contain
exactly five issues, matching bundle IDs, immutable `active.json` and
`manifest.json` references, a 64-hex manifest digest, valid evidence lineage,
and no raw article/body/HTML/sentence fields.

## Work completed in this slice

### GCP reader and publication lineage

- `src/backend/gcp_snapshot_reader.py`: offline-safe pointer/manifest/active
  reader with digest, snapshot identity, five-issue, path, quality-gate, and
  recursive raw-body validation.
- `src/backend/gcp_snapshot_reader_service.py`: future Cloud Run read service;
  `GET /healthz` and `GET /active`, generic `503` on invalid/missing snapshot,
  `no-store` responses, no storage-error details in the response.
- `src/backend/gcp_orchestration.py`: publisher now writes pointer `active` and
  `manifestSha256` fields using shared canonical JSON hashing.
- `src/backend/gcp_job_entrypoint.py`: validates pointer references and the
  manifest digest before accepting a successful run.
- `src/backend/gcp_live_dependencies.py` and
  `src/backend/gcp_stage_adapters.py`: expose the read-only public-object
  adapter needed by the reader.
- `infra/gcp/snapshot-reader-service.yaml`: explicit contract only; it is not
  an applied Cloud Run service.

### Site connection

- `site/app/(shell)/active-home.tsx`: body-free active-snapshot home view.
- `site/app/(shell)/page.tsx`: live mode selects the active snapshot home;
  demo mode continues to render the existing `LiveHome`.
- `site/app/(shell)/issues/[issueId]/outlets/page.tsx` and
  `.../framing/page.tsx`: live mode renders the semantic comparison/framing
  pages from the same active bundle; demo/static and existing live API paths
  remain intact.
- `site/tests/active-snapshot-contract.test.mjs`: route-boundary regression
  contract added, including a 404 guard when a live snapshot does not contain
  the requested issue. Live routes never fall back to the older D1/API path.
- `scripts/verify-vercel-production.ps1`: dry-run-by-default public verifier;
  with `-Execute`, it binds `/version` to the full release SHA and checks the
  home, outlets, and framing routes without printing response bodies.

### Deployment repeatability

- `scripts/gcp/deploy-runtime-job.ps1`: dry-run-by-default recurring Cloud Run
  Job deployment path for `python -m backend.gcp_job_entrypoint`. It requires
  an approved project, immutable full SHA, clean tracked tree, and full gate;
  billed execution additionally requires explicit `-Execute -RunId ...
  -ScheduledTime ...`. It sets GCP ownership and disables legacy/Cloudflare
  schedules in the job environment.
- `docs/architecture/active-snapshot-reader.md`: reader contract, env names,
  cutover order, and public verification requirements.

### Collection parser hardening

- `src/backend/gcp_live_dependencies.py` now reads `datePublished` from
  article JSON-LD as metadata, keeps the strict KST collection-window check,
  rejects date-less pages instead of substituting discovery time, and enforces
  the validated per-source record limit.
- `src/backend/gcp_source_policy.py` and
  `src/backend/gcp_stage_adapters.py` carry the policy's
  `maxRecordsPerSourcePerRun` value (currently 120) into the parser.
- `tests/unit/test_gcp_live_dependencies.py` covers JSON-LD publication dates,
  tracking-query canonicalization, date-less HTML candidates, both sides of
  the collection window, short-body rejection, domain/deduplication guards,
  and the per-source limit. These are fixture-only tests; they make no network
  calls.
- `src/backend/gcp_job_entrypoint.py` now rejects malformed or out-of-window
  `AGENDAFRAME_BASIS_DATE` values before any production adapter is constructed,
  so the post-2026-10-31 scheduler cannot perform unnecessary source requests.

### Cloud Run entrypoint review

- `src/backend/Dockerfile` now defaults to the recurring
  `python -m backend.gcp_job_entrypoint` entrypoint.
- `scripts/gcp/deploy.ps1` explicitly overrides the image command to
  `python -m backend.main validate-config` for the legacy configuration-check
  job, while `scripts/gcp/deploy-runtime-job.ps1` and
  `infra/gcp/cloud-run-job.yaml` use the recurring entrypoint. This prevents a
  default image invocation from silently running the old check instead of the
  GCP-owned pipeline.
- The deployment script's local dry run was verified after commit
  `c6061f9`. No image build, Cloud Run resource mutation, or billed execution
  was performed, so this is wiring evidence—not a production deployment.
- `scripts/gcp/deploy-snapshot-reader.ps1` now provides the matching
  dry-run-by-default reader deployment path. It uses the dedicated `reader`
  service account with Storage Object Viewer, keeps traffic at `--no-traffic`
  unless `-Promote` is explicit, and requires `-AllowUnauthenticated` before
  exposing the body-free `/active` boundary to Vercel.
- `scripts/gcp/provision.ps1` now includes the Workflows, Pub/Sub, Monitoring,
  and Logging APIs plus `reader` and `scheduler` service-account creation in
  its guarded apply plan. It still remains dry-run by default; no API enable or
  IAM mutation was made.
- `scripts/gcp/verify-snapshot-reader.ps1` now provides the explicit canary
  verifier. It contacts `/healthz` and `/active` only with `-Execute`, requires
  an HTTPS reader URL, and checks the five-issue manifest, quality gate,
  snapshot ID, and recursive forbidden-field absence without printing the
  public envelope.

### Storage decision contract

- `infra/gcp/workflow.yaml` now states that the current metadata/analysis
  store is BigQuery and the transactional store is not connected.
- Cloud SQL is explicitly recorded as a planned future migration with no
  runtime adapter. This matches `GcpAnalysisStore` and prevents a contract
  file from implying that Cloud SQL is already serving production traffic.
- The workflow contract test asserts all four fields and remains offline.

### Deployable Workflows and Scheduler path

- `infra/gcp/workflow-runtime.yaml` is the executable Google Workflows source;
  it invokes `googleapis.run.v1.namespaces.jobs.run`, waits for the guarded
  Cloud Run Job, and injects KST `basisDate`, workflow execution `runId`, and
  the GCP-only ownership flags.
- `scripts/gcp/deploy-orchestration.ps1` is dry-run by default. It deploys the
  workflow only with `-Apply -FullGatePassed` and creates/updates the recurring
  Scheduler job only when `-CreateScheduler` is also supplied.
- The Scheduler contract remains `0 3,9,15,21 * * *` UTC (00/06/12/18 KST).
  `workflow` has `roles/run.admin`; `scheduler` has only
  `roles/workflows.invoker`. `provision.ps1` creates both accounts in its
  guarded apply plan.
- The reusable command sequence is recorded in
  `docs/gcp-orchestration-deploy.md`. No workflow, scheduler, IAM, or GCP
  resource was applied in this checkpoint.

### Guarded runtime-services provisioning

- `scripts/gcp/provision-runtime-services.ps1` is a separate dry-run-by-default
  apply path for the recurring Pub/Sub topic/subscription and DLQ, Secret
  Manager **containers only**, log-based metrics, and Monitoring alert
  policies. It checks the expected non-production project, requires
  `-SpendCapsConfirmed` and a full notification-channel name for apply, and
  never creates secret versions or prints secret values.
- The log metrics use the supported Logging API configuration-file form and
  DELTA/INT64 counters. Delay and snapshot-age alerts are absence conditions
  on the success and publication counters, rather than unsupported GAUGE
  flags.
- `src/backend/gcp_job_entrypoint.py` emits allow-listed structured JSON events
  for run success/failure, quality-gate quarantine, and active-snapshot
  publication. The records contain run metadata and timing/status only; they
  never contain article body, prompt, HTML, or credential fields. Stage and
  wiring error messages in the process result are replaced by type plus a
  short non-reversible fingerprint, so an adapter exception cannot leak a
  body or secret through Cloud Run stdout.
- `tests/contract/test_gcp_runtime_services_contract.py` locks the resource
  names, body-free contract, dry-run default, project guard, and secret-value
  boundary, metric/event names, and absence/threshold alert shape. PowerShell
  parse, dry-run, and apply/project guards pass; no `gcloud` resource call was
  made.
- This adds an executable provisioning path, not evidence that the resources
  exist. Apply remains a separately authorized live step after budget, IAM,
  and rollback checks.

## Verification completed

- Latest quick gate after the runtime-services logging contract: **137 passed**;
  formatting and lint passed. The new contract tests and both orchestration
  dry runs were included.
- Latest full gate: **137 unit/contract + 3 integration/e2e passed**;
  evaluation assets remain synthetic and `release_eligible: false`.
- `site/npm run typecheck` → passed.
- `site/npm run lint` → 0 errors; four pre-existing warnings remain.
- `site/npm test` → **186 passed, 0 failed** (build included). The first
  sandbox attempt hit Vite `spawn EPERM`; the same local build/test passed with
  the required local process permission escalation. No network or deployment
  API was called.
- The live snapshot route regression test passed after the fail-closed guard;
  missing live issue IDs now resolve to `notFound()` instead of legacy data.
- The root quick gate after the runtime-services logging contract passed
  **137 tests**;
  verifier dry-run and its two contract tests passed without network access.
- Focused snapshot-reader/service/contract tests passed; the site active-route
  and semantic-page contracts passed.
- Focused collection parser tests → **7 passed**, including JSON-LD
  `datePublished`, strict date-window boundaries, date-less rejection, body
  minimum, canonicalization/deduplication, and source-limit enforcement.
- Runtime-services provisioning PowerShell parse and dry-run passed; its
  focused contract test passed **3 tests**. No `gcloud` resource call was made.
- `powershell -NoProfile -File scripts/gcp/deploy-snapshot-reader.ps1` dry run
  passed and printed no image build, deployment, traffic promotion, or GCP
  resource mutation.
- `powershell -NoProfile -File scripts/gcp/verify-snapshot-reader.ps1` dry run
  passed without contacting a reader URL; `-Execute` correctly requires an
  explicit reader URL.

## Not completed — do not claim these as done

No GCP resource has been applied in this checkpoint. Read-only inspection
showed the project has foundation resources but no recurring Scheduler,
Workflows, Pub/Sub/DLQ, Secret Manager wiring, or snapshot-reader service.
No live article fetch, Vertex call, GCS write, Vercel env change, main push, or
production deployment was performed. The current Cloudflare Worker cron still
owns real collection until a verified GCP cutover.

The reviewed release push was attempted after the full offline gates passed,
but this environment could not resolve `github.com` (`Could not resolve host`).
No remote `main` or Vercel deployment changed. When network access is restored,
rerun `git push origin HEAD:main`, then verify the deployed `/version` SHA before
calling production deployment complete.

Remaining order:

1. In the non-production GCP project, verify Workflows API, budget/spend cap,
   IAM, private bucket lifecycle, BigQuery schema/grants, and the reader service
   deployment plan. Apply only with explicit live authorization.
2. With that authorization, run the guarded runtime-services apply for
   Pub/Sub/DLQ, secret containers, log metrics, and alert policies; add secret
   versions only through Secret Manager after IAM review.
3. Deploy a synthetic body-free snapshot-reader canary; verify `/healthz`,
   `/active`, pointer/manifest SHA, exactly five issues, and no forbidden keys.
4. Deploy/run one collector canary with unique `run_id`; inspect lease,
   idempotency, quality gate, immutable objects, and rollback pointer.
5. Only after canary success, create Scheduler 00/06/12/18 KST + Workflows and
   cut ownership away from the Cloudflare cron. Never let both schedulers run.
6. Set Vercel server env in preview, verify `/version`, `/`, `/outlets`, and
   `/framing`, then promote through the documented deployment path while
   retaining the previous deployment for rollback.

## Prompt for the next model

```text
Read AGENTS.md and docs/continuation-handoff-20260814.md first. Start with
git status --short and preserve all unrelated dirty/untracked files. Continue
AgendaFrame from branch codex/initial-five-complete. Do not rebuild the main
site, replace the existing demo/API path, expose article bodies, or call news,
Vertex, GCP, or deployment APIs during ordinary tests.

First inspect the committed reader slice and run the offline gates. The parser
datePublished/body-minimum fixture regressions, local Cloud Run entrypoint
review, and the guarded runtime-services provisioner are already implemented;
next work is the explicitly authorized, non-production GCP canary preparation.
Keep all GCP YAML
contract_only/externalCalls:false until a non-production live authorization,
budget cap, IAM, and rollback plan are explicitly available. If live approval
is available, deploy reader canary before collector; verify body-free /active,
pointer SHA, exactly five issues, evidence lineage, lease/idempotency, and
previous-pointer rollback. The deployable source is
`infra/gcp/workflow-runtime.yaml` and its guarded path is
`scripts/gcp/deploy-orchestration.ps1`; use `-CreateScheduler` only after
the canary. Only after that create 4/day Scheduler + Workflows
and disable the Cloudflare cron through the ownership flags. Finally connect
Vercel live env in preview and verify /version, /, /outlets, and /framing.

At every handoff report: changed files, exact tests, external calls (none unless
explicitly authorized), what remains blocked, and the next task. Never say
GCP-live or production deployed without public endpoint and resource evidence.
```

## 2026-08-15 live non-production checkpoint (amendment)

The previous "no GCP resource applied" statement above describes the earlier
checkpoint only. On 2026-08-15, with `AGENDAFRAME_LIVE_TESTS=1`, the active
non-production project `project-40bc06fc-fb4b-46b6-a10` was inspected and the
following idempotent resources were applied and read back:

- Workflows API, required Cloud Run/Artifact Registry/BigQuery/Storage/
  Pub/Sub/Secret Manager/Logging/Monitoring APIs enabled.
- Existing private bucket `gs://project-40bc06fc-fb4b-46b6-a10-agendaframe-private`
  verified with public access prevention enforced, uniform bucket-level access,
  and `bodies/` delete lifecycle.
- Artifact Registry repository and `reader`, `workflow`, and `scheduler`
  service accounts/IAM bindings applied.
- Pub/Sub topic `agenda-article-analysis`, DLQ topic, and
  `agenda-article-analysis-worker` subscription applied with five-attempt DLQ
  policy and service-agent bindings.
- Secret Manager containers `agendaframe-news-source-auth`,
  `agendaframe-vertex-service-config`, and `agendaframe-site-import-token`
  applied with accessor bindings. **No secret versions or values were added.**
- Four body-free log metrics applied. Monitoring policies remain deferred
  because the project has no approved notification channel; no arbitrary email
  address was invented.
- BigQuery `agendaframe` dataset and six partitioned metadata-only tables were
  verified through the official REST API. The publisher table grant was applied
  with `scripts/gcp/apply-bigquery-rest.ps1`, a guarded live fallback for the
  local `bq` DNS failure.

The first live attempts exposed and fixed two Windows/SDK issues: deployment
scripts now prefer `gcloud.cmd` over `gcloud.ps1`, and Secret Manager IAM uses
the valid `serviceAccount:` member prefix. `scripts/gcp/provision.ps1` also
skips already-hardened bucket updates safely. No article fetch, Vertex model
call, Cloud Run image build, Scheduler/Workflow deployment, Vercel change, or
production cutover has happened yet. The remaining live order is: full gate and
clean immutable commit, reader canary, runtime-job canary, workflow deploy,
then scheduler creation and ownership cutover only after endpoint verification.

Repeatable REST schema/grant command (non-production only):

```powershell
$env:AGENDAFRAME_LIVE_TESTS='1'; $env:HTTPS_PROXY=''; $env:HTTP_PROXY=''; $env:ALL_PROXY='';
powershell -NoProfile -File scripts/gcp/apply-bigquery-rest.ps1 -Apply -SpendCapsConfirmed
```

## 2026-08-15 latest runtime checkpoint (handoff for the next model)

### Saved repository state

- Branch: `codex/initial-five-complete`.
- Latest committed checkpoint: `f9f8652 fix(gcp): cap scheduled fetch latency`.
- The intentional commits after the previous amendment are:
  `1594e4e` (runtime clusterer accepts the configured 50-article cap),
  `86ac0e8` (distribute the cap across all twelve sources), `bbfbf0d`
  (isolate source-local network failures), `88d0ce1` (validate and bound
  per-source discovery requests), and `f9f8652` (pass the per-source budget
  to the parser and use a five-second production fetch timeout).
- Latest offline evidence: `scripts/check.ps1 -Mode full` passed with **146
  unit/contract tests and 3 integration/e2e tests**. Evaluation assets remain
  synthetic/unlabeled (`release_eligible: false`). Site code was not changed
  in this slice; prior site typecheck/lint/test evidence remains valid.
- `docs/next-session-handoff.md` is an existing user/other-model dirty file;
  do not stage or rewrite it. Existing untracked worktrees, logs, feedback,
  outputs, and `.grok/` are also out of scope.

### Non-production resources and live evidence

- Project `project-40bc06fc-fb4b-46b6-a10` is the only live target. APIs,
  private bucket hardening/lifecycle, BigQuery `agendaframe` metadata tables,
  publisher grant, Pub/Sub topic/subscription/DLQ, Secret Manager containers
  (no versions/values), and four body-free log metrics were applied and read
  back. Monitoring alert policies remain deferred because no approved
  notification channel exists.
- GCS historical migration is readable: active pointer snapshot
  `33751fe9c7eefaf20e59ccd35ae9a2d3`, seven immutable objects, five issues,
  `qualityGate.status=pass`, `publicSnapshotReady=true`, and manifest SHA
  `6810854ff752f95ca2e5e08884c2ba1cad3d029ad9c2b7317ea1c89c287b6c34`.
  This is a historical body-free artifact, not proof of a live current-date
  collection.
- Snapshot-reader Cloud Run service `agendaframe-snapshot-reader` revision
  `00001-rm9` is Ready and authenticated-only. The public URL and `/active`
  response could not be verified from this network because `run.app` DNS /
  proxy access failed; do not call the reader or production deployment live.
- Runtime Cloud Run Job `agendaframe-collection-analysis` is deployed with
  image `asia-northeast3-docker.pkg.dev/project-40bc06fc-fb4b-46b6-a10/agendaframe/runtime:f9f86523eb75aaeec1d9faf69b48b32c3d3b1955` and GCP-only
  ownership flags. No Scheduler or Workflows deployment has been created.

### Canary history (all non-production; no public cutover)

1. `twllg` on `f28d99d`: collection/persist reached `cluster_rank`, then the
   old 25-article `InitialFiveClusterer` limit rejected the 50-article run.
   Fixed in `1594e4e` and covered by a 50-article regression test.
2. `vxd9c` on `bd4978d`: collection, persistence, and clustering completed;
   `top5_semantic` stopped because the model result did not produce exactly
   five ranked issues (`semantic stage requires exactly five ranked issues`).
   This is a quarantine/failure, not a publish.
3. `j57kk` on `86ac0e8`: a source network exception escaped collection. Fixed
   in `bbfbf0d`; collection now records body-free `sourceErrorCounts` and
   continues other sources.
4. `jklst` on `bbfbf0d`: the task reached the Cloud Run 900-second timeout and
   was cancelled. The cause was unbounded candidate-page attempts when feeds
   returned no valid rows. Fixed in `88d0ce1` and `f9f8652` by validating the
   policy's 30-request limit, passing the source budget (4/5 for a 50-row
   twelve-source run) into the parser, and using a five-second fetch timeout.
5. `vhs68` on `f9f8652`: started asynchronously for a canary, then was
   cancelled at handoff to protect the spend cap. There is **no successful
   runtime canary or published current snapshot yet**.

### Next model: exact next actions

1. Start with `git status --short`, `git rev-parse HEAD`, and this section.
   Preserve `docs/next-session-handoff.md` and all unrelated dirty/untracked
   paths. Run the full offline gate once before any live call.
2. Run one bounded non-production canary. Prefer adding a guarded
   `AGENDAFRAME_MAX_ARTICLES_PER_RUN` override (maximum 50, canary-only) so a
   12-source smoke run can use 12 articles (one per source) before spending on
   50 body analyses. Keep the default production config at 50 until the
   smaller run proves collection, source distribution, clustering, and Vertex
   evidence. Do not fabricate a fifth issue: if fewer than five real clusters
   exist, quarantine and record the reason.
3. Inspect the body-free result payload and logs for per-source counts,
   cluster count, Vertex review/error counts, quality-gate status, immutable
   object writes, and pointer movement. A successful canary must prove exact
   five issues, valid locator + 64-hex sentence hash for every public article
   row, no raw body/HTML/sentence fields, and previous-pointer preservation on
   failure.
4. If the canary passes, deploy `infra/gcp/workflow-runtime.yaml` through
   `scripts/gcp/deploy-orchestration.ps1` with `-Apply -FullGatePassed`, then
   create the Scheduler only with `-CreateScheduler`. The UTC schedule is
   `0 3,9,15,21 * * *` (00/06/12/18 KST). Do not create it while canary or
   reader verification is incomplete.
5. Verify the reader using an authenticated non-production path or approved
   ingress; public `/healthz` and `/active` must be checked before setting
   `AGENDAFRAME_DATA_MODE=live` or `AGENDAFRAME_ACTIVE_SNAPSHOT_URL` in Vercel.
   The existing main site and its two semantic pages must remain unchanged
   except for the explicit live snapshot boundary.
6. Production is still blocked: no GitHub `main` push (DNS previously failed),
   no Vercel env change/deploy, no public reader verification, no Scheduler,
   and no Cloudflare-cron ownership cutover. Never report these as complete.

### 2026-08-15 event synthesis slice

The product gap is not another collection canary. Article-level Vertex
profiles exist, but the public comparison was still a fixed sentence plus
empty `source_lens.by_outlet`. The example HTML needs event-level prose:
shared line, split line, 2–4 camps, four-function rows, and proof rows, each
bound to article ID + locator + sentence hash.

Added in this slice:

- `src/ai/event_synthesis.py`: `bind_event_synthesis` drops uncited claims,
  blocks ideology labels, and forbids A ↔ B unless two evidence groups
  survive. `VertexEventSynthesizer` is injected and lazy.
- `FrameSemanticAdapter` calls the synthesizer when present and falls back to
  the old rule aggregation when the draft is unusable.
- `evals/prompts/event-synthesis-v1.0.0.md` plus schema/manifest entry.
- Semantic pages render `SynthesisNarrative` from `comparison.data.synthesis`.

There is still no successful live Vertex synthesis and no published current
snapshot. Do not call the comparison “HTML-complete” until a bound synthesis
payload is on an active snapshot.

## Prompt for another model

```text
Read AGENTS.md and docs/continuation-handoff-20260814.md. Continue from
branch codex/initial-five-complete. Preserve every unrelated dirty/untracked
file, especially docs/next-session-handoff.md; never reset or stage everything.
The product target is the example-HTML event comparison (camps, shared/split
lines, four functions, proof rows), not a rule-aggregated screen. Event
synthesis binding is in src/ai/event_synthesis.py; do not rebuild it.

GCP non-production resources exist, but there is no successful runtime canary,
no live Vertex synthesis payload, no Scheduler/Workflow deployment, no public
reader verification, no Vercel change, and no production cutover.

Next: prove one bound synthesis on a real or fixture profile set, then a cheap
12-article canary only if live authorization exists. Do not execute live
Vertex/GCP calls without AGENDAFRAME_LIVE_TESTS=1.
Verify sourceArticleCounts/sourceErrorCounts, cluster count, Vertex evidence,
quality gate, immutable GCS objects, pointer SHA, and rollback preservation.
Do not fabricate fewer-than-five clusters and do not expose article bodies.
Only after a successful canary verify the authenticated reader, deploy
infra/gcp/workflow-runtime.yaml, create the 0/6/12/18 KST Scheduler via the
guarded script, and then plan the Vercel preview/live env and public /version
check. Keep Cloudflare ownership disabled only after GCP Scheduler is proven;
never run both schedulers. At handoff, report exact changed files/tests,
external calls, blocked items, and the next task.
```
