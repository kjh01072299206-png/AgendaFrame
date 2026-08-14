# AgendaFrame continuation handoff — 2026-08-14 KST

## Current repository state

- Repository: `C:\Users\강준혁\Desktop\구글캡디_문서`
- Branch: `codex/initial-five-complete`
- Saved integration checkpoints: `9f1f627` (origin/main + live/GCP merge),
  `1b2a483` (release integration handoff).
- This handoff is intended to be committed with the reader slice below.
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
  contract added.

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
  `1ce3539`. No image build, Cloud Run resource mutation, or billed execution
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

## Verification completed

- Latest quick gate after the deployable-workflow changes: **129 passed**;
  formatting and lint passed. The new contract tests and both orchestration
  dry runs were included.
- Latest full gate: **129 unit/contract + 3 integration/e2e passed**;
  evaluation assets remain synthetic and `release_eligible: false`.

- `powershell -NoProfile -File scripts/check.ps1 -Mode quick` → **127 passed**;
  Ruff and formatting passed.
- `powershell -NoProfile -File scripts/check.ps1 -Mode full` → **124 unit/
  contract tests and 3 integration/e2e tests passed**; evaluation assets remain
  synthetic and `release_eligible: false`.
- `site/npm run typecheck` → passed.
- `site/npm run lint` → 0 errors; four pre-existing warnings remain.
- `site/npm test` → **186 passed, 0 failed** (build included). The first
  sandbox attempt hit Vite `spawn EPERM`; the same local build/test passed with
  the required local process permission escalation. No network or deployment
  API was called.
- Focused snapshot-reader/service/contract tests passed; the site active-route
  and semantic-page contracts passed.
- Focused collection parser tests → **7 passed**, including JSON-LD
  `datePublished`, strict date-window boundaries, date-less rejection, body
  minimum, canonicalization/deduplication, and source-limit enforcement.
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

Remaining order:

1. In the non-production GCP project, verify Workflows API, budget/spend cap,
   IAM, private bucket lifecycle, BigQuery schema/grants, and the reader service
   deployment plan. Apply only with explicit live authorization.
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
datePublished/body-minimum fixture regressions and local Cloud Run entrypoint
review are already implemented; next work is the explicitly authorized,
non-production GCP canary preparation. Keep all GCP YAML
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
