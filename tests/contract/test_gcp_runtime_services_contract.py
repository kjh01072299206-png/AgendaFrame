from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def test_runtime_services_provisioner_is_dry_run_and_project_guarded() -> None:
    script = (ROOT / "scripts" / "gcp" / "provision-runtime-services.ps1").read_text(
        encoding="utf-8"
    )
    assert "[switch]$Apply" in script
    assert "[switch]$SpendCapsConfirmed" in script
    assert "if (-not $Apply)" in script
    assert "$ExpectedProject" in script
    assert "NotificationChannel" in script
    assert "No secret versions were created" in script
    assert "secrets" in script
    assert "pubsub" in script
    assert "monitoring" in script
    assert "gcloud" in script


def test_runtime_services_provisioner_matches_body_free_contract_names() -> None:
    script = (ROOT / "scripts" / "gcp" / "provision-runtime-services.ps1").read_text(
        encoding="utf-8"
    )
    contract = (ROOT / "infra" / "gcp" / "pubsub.yaml").read_text(encoding="utf-8")
    secrets = (ROOT / "infra" / "gcp" / "secrets.yaml").read_text(encoding="utf-8")
    assert '"agenda-article-analysis"' in script
    assert '"agenda-article-analysis-dlq"' in script
    assert '"agenda-article-analysis-worker"' in script
    assert "agendaframe-news-source-auth" in script
    assert "agendaframe-vertex-service-config" in script
    assert "agendaframe-site-import-token" in script
    assert "agenda-article-analysis" in contract
    assert "deadLetterTopic" in contract
    assert "agendaframe-news-source-auth" in secrets
    assert "valuesInRepository: false" in secrets
    assert "bodyText" not in script
    assert "rawBody" not in script
    assert "promptPayload" not in script
