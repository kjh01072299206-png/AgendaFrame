# GCP bootstrap

The scripts in this directory target only
`project-40bc06fc-fb4b-46b6-a10`.

1. Configure monthly spend caps in Cloud Billing:
   - Gemini Enterprise Agent Platform / Vertex AI: USD 5
   - Cloud Run: USD 2
2. Add a project-wide alert-only budget at USD 10 for services that do not
   support spend-cap enforcement.
3. Run `provision.ps1` without switches to review the plan.
4. Run with `-Apply -SpendCapsConfirmed` only after the caps are visible.

`-DeferStorageLifecycle` and `-DeferBigQuerySchema` are recovery-only switches
for a temporary control-plane outage. They allow only the remaining IAM
foundation to be prepared. Collection, analysis, publication, and scheduling
must stay disabled until both deferred controls are applied and verified.

The provisioning script does not create a Scheduler job or make any news-site
request. Those remain blocked until a reviewed Cloud Run image, an explicit live
opt-in, and an allowlisted source with written permission are available.

BigQuery, Cloud Storage, Cloud Run, and Artifact Registry use
`asia-northeast3`. Gemini requests use the `global` Vertex endpoint for
`gemini-2.5-flash-lite`, so the article text sent for analysis must be covered
by the publisher permission and the approved external-AI processing policy.
The code additionally caps analysis at 50 articles per run and 200 per day.

After the full offline gate passes and the reviewed commit is clean,
`deploy.ps1` builds an image tagged with the full Git SHA and deploys only a
configuration-check Cloud Run Job. It does not analyze an article. The
collection and analysis schedule remains intentionally absent while every real
source is `metadata_only`.

`deploy-trial-jobs.ps1` deploys the two one-shot pilot jobs that `deploy.ps1`
deliberately leaves out:

- `agendaframe-frame-trial` runs `live-run` as the analyzer service account
  against a hand-reviewed authorization file and a transient private input.
- `agendaframe-publish-trial` runs `publish` as the publisher service account
  with `--cluster-approval-json`. The retired `--approve-published-cluster`
  option must not be used.

Both jobs reuse the guards from `deploy.ps1`: hard-pinned project, dry run by
default, `-Apply -FullGatePassed`, a clean tracked tree, and an image tag that
must equal the checked-out 40-character commit SHA. Deployment is free, so
starting a billed run needs the separate `-Execute` switch.

`--max-retries` is pinned to `0` for these two jobs even though
`cloud_run.max_retries` is `1`. A retried publish job could re-import a cluster
that already reached the site, and a retried analysis job could spend Vertex
quota twice on the same articles.

No Cloud Scheduler trigger is created for the trial jobs and none should be. The
analysis input is a reviewed file, not a crawl, and the pilot is a single
experiment on seven approved articles.

Table-scoped BigQuery grants live in `src/backend/sql/grants.sql` and are applied
by `provision.ps1` after the service accounts exist. The publisher's
project-level BigQuery role stays read-only; the grant is what allows
`mark_published()` to update `frame_analyses.publication_status`.
