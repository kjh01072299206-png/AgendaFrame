# AgendaFrame repository instructions

These instructions apply to the entire repository.

## Work safely

- Start by checking `git status --short`. Existing modifications belong to the
  user or another agent; do not discard, rewrite, or move them unless the task
  explicitly requires it.
- Keep secrets out of source, fixtures, logs, generated reports, and screenshots.
  Commit only placeholder values in `.env.example`.
- Do not contact news sites, Vertex AI, Gemini, BigQuery, Firebase, or deployment
  APIs during ordinary tests. Live calls require an explicit live-test opt-in and
  a non-production project with a budget limit.
- Prefer deterministic fixtures. Record the collection time and source URL when a
  fixture represents an external article, and remove personal data that is not
  needed by the test.

## Repository boundaries

- Product code belongs under `src/`; repository automation belongs under
  `scripts/`; tests belong under `tests/`; model and prompt evaluations belong
  under `evals/`.
- `docs/` contains source documents. `outputs/` contains reviewed generated
  images. Use a temporary output directory for experiments so normal checks do
  not overwrite reviewed artifacts.
- Keep fetching separate from parsing. Crawler parsers must be testable against
  saved HTML without network access.
- Keep cloud SDKs behind small interfaces so unit tests can use fakes. Never make
  credentials a requirement for importing an application module.

## Required verification

Run the repository's offline gate before handing work off:

```powershell
powershell -NoProfile -File scripts/check.ps1 -Mode quick
```

Use `-Mode full` after `scripts/bootstrap.ps1` when changing dependencies,
document generation, or production code. `quick` runs static checks plus unit and
contract tests; `full` adds integration, offline end-to-end, and evaluation-data
validation. Both modes must remain
network-free. Use `-Mode live` only when the task explicitly authorizes external
services and `AGENDAFRAME_LIVE_TESTS=1` is set.

Keep `requirements.lock` synchronized with `pyproject.toml`. Bootstrap must install
the hashed lock before installing the editable package without dependency
resolution. Dependency changes require a regenerated lock and a full check.

Every bug fix should add a regression test where practical. Tests must not depend
on the current date, random model prose, a developer-specific absolute path, or
an existing cloud login.

## AI and evidence quality

- Version prompts, model identifiers, label taxonomies, and evaluation datasets.
- Preserve article IDs and evidence spans through clustering, frame analysis, and
  report generation. A generated claim must be traceable to its cited article.
- Do not use exact-string snapshots for open-ended model prose. Gate clustering,
  frame labels, citation coverage, and unsupported-claim rate with the metrics in
  `evals/thresholds.yaml`; require human review for changes near a threshold.

## Deployment discipline

- Deploy immutable builds from a reviewed commit. Keep environment-specific
  configuration outside the bundle and use least-privilege service accounts.
- Before production, run the full gate, verify a health check in staging, and
  retain the previous deploy for rollback. Never print deployment tokens.
- Production migrations must be backward-compatible with the currently deployed
  application and have an explicit rollback or roll-forward path.
