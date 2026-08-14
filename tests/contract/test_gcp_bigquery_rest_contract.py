from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def test_bigquery_rest_fallback_is_guarded_and_metadata_only() -> None:
    script = (ROOT / "scripts" / "gcp" / "apply-bigquery-rest.ps1").read_text(encoding="utf-8")
    assert "AGENDAFRAME_LIVE_TESTS=1" in script
    assert "SpendCapsConfirmed" in script
    assert "www.googleapis.com/bigquery/v2" in script
    assert "schema.sql" in script and "grants.sql" in script
    assert "bodyText" not in script
    assert "rawBody" not in script
    assert "secret" not in script.lower() or "secret values" in script.lower()


def test_bigquery_rest_fallback_has_project_guard_and_dry_run() -> None:
    script = (ROOT / "scripts" / "gcp" / "apply-bigquery-rest.ps1").read_text(encoding="utf-8")
    assert "$ExpectedProject" in script
    assert "if (-not $Apply)" in script
    assert 'Invoke-BigQueryScript -Label "Schema"' in script
    assert 'Invoke-BigQueryScript -Label "Grants"' in script
