from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def test_snapshot_migration_is_body_free_and_pointer_last() -> None:
    script = (ROOT / "scripts" / "gcp" / "migrate-initial-five-snapshot.py").read_text(
        encoding="utf-8"
    )
    assert "AGENDAFRAME_LIVE_TESTS" in script
    assert "exactly five" in script
    assert "active.json" in script
    assert "manifestSha256" in script
    assert "pointer is intentionally the final write" in script
    assert "body_text" in script and "raw_body" in script
    assert "upload_from_string(canonical_json(plan.pointer)" in script
    assert (
        "article body" not in script.lower()
        or "never reads or uploads article bodies" in script.lower()
    )


def test_snapshot_migration_targets_only_reviewed_project_and_public_artifacts() -> None:
    script = (ROOT / "scripts" / "gcp" / "migrate-initial-five-snapshot.py").read_text(
        encoding="utf-8"
    )
    assert "project-40bc06fc-fb4b-46b6-a10" in script
    assert "site" in script and "public" in script and "initial-five" in script
    assert "google.cloud import storage" in script
    assert "current.json" in script
