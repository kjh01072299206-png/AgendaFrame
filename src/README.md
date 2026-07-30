# Source Layout

Implementation code should be split by responsibility:

- `backend/`: batch orchestration, GCP data access, publishing, and cost gates
- `crawler/`: article collection policy, URL safety, and metadata/body extraction
- `ai/`: clustering, scoring, evidence validation, framing analysis, and reporting
- `agendaframe_tooling/`: deterministic repository and evaluation helpers

Keep module-specific setup files near the module that owns them.
