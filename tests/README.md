# Tests

The default suite is deterministic and does not use the network or cloud
credentials. Run it from the repository root:

```powershell
powershell -NoProfile -File scripts/check.ps1 -Mode quick
```

## Layout

- `unit/`: pure scoring, parsing, normalization, and domain-logic tests
- `contract/`: repository, artifact, API-schema, and evaluation-data contracts
- `integration/`: boundaries exercised with fake cloud and storage clients
- `fixtures/`: saved, minimized inputs; never put secrets or unnecessary personal
  data here
- `e2e/`: complete offline workflows using temporary output directories
- `live/`: opt-in checks against a staging service

Name tests `test_*.py`; the suite is compatible with both `unittest` and pytest.
External network calls are forbidden outside `live/`. A live test must document
its target, cleanup behavior, expected cost, and required environment variables.

`quick` runs `unit/` and `contract/`. `full` additionally runs `integration/`,
`e2e/`, and evaluation validation. A suite with no collected tests is rejected
when that suite is required by the selected mode.
