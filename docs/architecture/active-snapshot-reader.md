# Active snapshot read boundary

## Purpose

The GCP publisher writes an immutable public snapshot under
`snapshots/<basis_date>/<snapshot_id>/` and moves `snapshots/current.json` only
after the quality gate passes. The Vercel site must read one validated public
envelope so the main page, outlet comparison, and framing analysis cannot use
different runs.

## Implemented offline contract

- `src/backend/gcp_snapshot_reader.py` reads the current pointer, manifest, and
  active payload through an injected object-store interface.
- The pointer must identify the exact 32-hex snapshot, immutable prefix,
  `manifest.json`, `active.json`, and a 64-hex `manifestSha256`.
- The manifest and active payload must converge on the same snapshot ID and
  exact five issue IDs. The quality gate must be passed, raw-body fields are
  rejected recursively, and path traversal references are rejected.
- `src/backend/gcp_snapshot_reader_service.py` provides the future Cloud Run
  read surface: `GET /active` returns only the validated envelope and
  `GET /healthz` returns status. Invalid or missing snapshots return a generic
  `503` without storage details; responses are `no-store`.
- `site/lib/active-snapshot.ts` remains fail-closed. In live mode it reads the
  full `/active` JSON from `AGENDAFRAME_ACTIVE_SNAPSHOT_URL` and refuses a
  missing or invalid envelope.
- When `AGENDAFRAME_DATA_MODE=live`, `site/app/(shell)/page.tsx` renders the
  active snapshot home and the `/outlets` and `/framing` routes render the
  semantic pages from that same snapshot. Demo mode keeps the existing live
  Cloudflare API/home and initial-five behavior.

## Not yet deployed

`infra/gcp/snapshot-reader-service.yaml` is a contract only. No Cloud Run
service, Scheduler, Workflows, Pub/Sub, Secret Manager, or Vercel environment
variable has been applied in this checkpoint. Do not describe the public site
as GCP-live until the reader URL returns `/healthz` 200 and `/active` with a
current snapshot, and the site `/version`, `/`, `/outlets`, and `/framing`
screens are verified.

The recurring job deployment path is recorded in
`scripts/gcp/deploy-runtime-job.ps1`. It is dry-run by default, requires the
full offline gate and an immutable 40-character commit, and only starts a
billed canary when `-Execute -RunId ... -ScheduledTime ...` is explicit.

## Cutover order

1. Build the reviewed image from the release commit and deploy the reader as a
   non-production Cloud Run service with a least-privilege Storage Object
   Viewer service account.
2. Verify the reader against a synthetic body-free snapshot, then a canary
   snapshot. Check pointer/manifest digest, five issues, evidence locators, and
   absence of raw body fields.
3. Set Vercel server environment variables
   `AGENDAFRAME_DATA_MODE=live` and
   `AGENDAFRAME_ACTIVE_SNAPSHOT_URL=https://<reader>/active` for a preview
   deployment first. Keep the previous deployment available for rollback.
4. Only after the GCP collector/scheduler canary is proven, change scheduler
   ownership and disable the Cloudflare cron to avoid duplicate four-times-a-
   day runs.
5. Verify the public `/version` commit, main page, and both analysis routes;
   record the snapshot ID and rollback pointer.

## Verification

The reader, service, pointer digest, and route-boundary tests are offline and
must remain network-free. External GCP creation and Vercel production changes
are separate live operations and are not implied by these tests.
