# AgendaFrame

AgendaFrame is a team project for AI-assisted news agenda and framing analysis.
The project collects article metadata from selected media outlets, groups related
issues, compares outlet-level coverage patterns, and generates analysis reports.

## Repository Structure

```text
.
├── README.md
├── AGENTS.md           # repository-wide agent and safety rules
├── CONTRIBUTING.md
├── .env.example
├── pyproject.toml
├── requirements.lock   # hashed, reproducible Python environment
├── .github/workflows/ci.yml
├── docs/
│   ├── planning/      # product backlog, sprint backlog, WBS
│   ├── specs/         # use cases, UML, feature specification
│   ├── research/      # prior research and service review
│   ├── process/       # deliverable workflow notes
│   └── submission/    # final report and local submission artifacts
├── src/
│   ├── backend/       # API server and orchestration
│   ├── crawler/       # article collection jobs
│   ├── ai/            # clustering, scoring, framing analysis
│   └── agendaframe_tooling/  # deterministic evaluation helpers
├── tests/
│   ├── unit/
│   ├── contract/
│   ├── integration/
│   ├── fixtures/crawler/
│   └── e2e/
├── evals/
│   ├── clustering/gold.jsonl
│   ├── framing/gold.jsonl
│   ├── report/
│   ├── prompts/
│   └── thresholds.yaml
├── scripts/           # bootstrap, checks, evaluation, and artifact generation
└── outputs/           # generated diagrams and images
```

## Team Workflow

Keep `main` stable. Each member should create a branch for their own task,
push that branch, and open a pull request before merging.

```powershell
git switch main
git pull --ff-only
git switch -c feature/news-crawler
```

After editing:

```powershell
git status
git add <changed-files>
git commit -m "feat: add news crawler"
git push -u origin feature/news-crawler
```

Recommended branch prefixes:

- `feature/` for new implementation work
- `fix/` for bug fixes
- `docs/` for documentation changes
- `refactor/` for internal restructuring
- `test/` for test coverage

## Local Setup

Copy `.env.example` to `.env` and fill local secrets there. Do not commit `.env`.

```powershell
Copy-Item .env.example .env
```

```powershell
powershell -NoProfile -File scripts/bootstrap.ps1
```

Bootstrap creates `.venv`, installs the hashed `requirements.lock`, installs the
local tooling package without resolving new dependencies, and runs the quick
offline gate. The deployed website is not stored in `src/frontend` in this
checkout and is therefore not claimed as part of this Python harness.

After changing Python dependencies, regenerate the lock and run the full gate:

```powershell
.venv\Scripts\python.exe -m piptools compile --extra dev --generate-hashes `
  --allow-unsafe --strip-extras --output-file requirements.lock pyproject.toml
powershell -NoProfile -File scripts/check.ps1 -Mode full
```

## Useful Commands

Regenerate diagram images:

```powershell
python scripts/render_agendaframe_outputs.py
```

Build or refresh submission artifacts:

```powershell
python scripts/build_agendaframe_submission.py
```

Run the offline repository gate:

```powershell
powershell -NoProfile -File scripts/check.ps1 -Mode quick
powershell -NoProfile -File scripts/check.ps1 -Mode full
```

Validate evaluation assets without calling a model or network service:

```powershell
.venv\Scripts\python.exe scripts/run_evals.py
```

## GitHub Hygiene

Do commit:

- source code under `src/`
- tests under `tests/`
- planning and specification documents under `docs/`
- generated diagrams under `outputs/` when they are part of the submission
- safe examples such as `.env.example`

Do not commit:

- `.env`, API keys, service account files, or credentials
- personal application forms, support fund documents, or private school forms
- temporary folders such as `tmp_*`
- large final ZIP files; use GitHub Releases or local submission storage
