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

## Verification completed

- `powershell -NoProfile -File scripts/check.ps1 -Mode quick` → **119 passed**;
  Ruff and formatting passed.
- `site/npm run typecheck` → passed.
- `site/npm run lint` → 0 errors; four pre-existing warnings remain.
- `site/npm test` → **186 passed, 0 failed** (build included). The first
  sandbox attempt hit Vite `spawn EPERM`; the same local build/test passed with
  the required local process permission escalation. No network or deployment
  API was called.
- Focused snapshot-reader/service/contract tests passed; the site active-route
  and semantic-page contracts passed.

## Not completed — do not claim these as done

No GCP resource has been applied in this checkpoint. Read-only inspection
showed the project has foundation resources but no recurring Scheduler,
Workflows, Pub/Sub/DLQ, Secret Manager wiring, or snapshot-reader service.
No live article fetch, Vertex call, GCS write, Vercel env change, main push, or
production deployment was performed. The current Cloudflare Worker cron still
owns real collection until a verified GCP cutover.

Remaining order:

1. Add parser/datePublished/body-minimum fixture regression tests and resolve
   the remaining Cloud Run image/entrypoint production wiring review.
2. In the non-production GCP project, verify Workflows API, budget/spend cap,
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

First inspect the committed reader slice and run the offline gates. Then work
only on the next incomplete item: parser/datePublished/body-minimum fixture
regressions and the reviewed Cloud Run production wiring. Keep all GCP YAML
contract_only/externalCalls:false until a non-production live authorization,
budget cap, IAM, and rollback plan are explicitly available. If live approval
is available, deploy reader canary before collector; verify body-free /active,
pointer SHA, exactly five issues, evidence lineage, lease/idempotency, and
previous-pointer rollback. Only after that create 4/day Scheduler + Workflows
and disable the Cloudflare cron through the ownership flags. Finally connect
Vercel live env in preview and verify /version, /, /outlets, and /framing.

At every handoff report: changed files, exact tests, external calls (none unless
explicitly authorized), what remains blocked, and the next task. Never say
GCP-live or production deployed without public endpoint and resource evidence.
```
