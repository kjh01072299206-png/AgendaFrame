# Live tests

Tests in this directory may contact only explicitly authorized staging services.
Each test module must document its target project, required environment variables,
maximum expected cost, resources it creates, and cleanup behavior.

Run live tests only after the offline full gate succeeds:

```powershell
$env:AGENDAFRAME_LIVE_TESTS = "1"
pwsh -NoProfile -File scripts/check.ps1 -Mode live
```

Never point this suite at production or use a personal cloud project.
