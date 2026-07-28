# Source Layout

Implementation code should be split by responsibility:

- `backend/`: API server, orchestration, and data access
- `crawler/`: article collection and metadata extraction jobs
- `ai/`: clustering, scoring, framing analysis, and report generation
- `agendaframe_tooling/`: deterministic repository and evaluation helpers

Keep module-specific setup files near the module that owns them.
