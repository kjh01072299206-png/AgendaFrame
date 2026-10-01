from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]


def load_publisher():
    spec = importlib.util.spec_from_file_location(
        "comparison_publisher", ROOT / "scripts/gcp/publish-reviewed-comparison.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def candidate_fixture(tmp_path, status="no_clear_difference"):
    run_id = "a" * 32
    rows = [{"issueId": f"fixture-{i}", "payloadKey": f"issues/fixture-{i}.json"} for i in range(5)]
    manifest = {
        "basisDate": "2026-08-15",
        "issueCount": 5,
        "analysisRunId": run_id,
        "analysisGeneratedAt": "2026-10-01T00:00:00Z",
        "issues": rows,
    }
    (tmp_path / "issues").mkdir()
    (tmp_path / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    for row in rows:
        synthesis = {
            "promptVersion": "event-synthesis-v2.2.0",
            "schemaVersion": "agendaframe.event-synthesis.v2.2",
            "usable": True,
            "source": "gcp:event-synthesis",
            "comparison_result": {
                "version": "comparison-v1.0.0",
                "status": status,
                "dimensions": [],
            },
            "invocation": {
                "provider": "vertex_ai",
                "model": "fixture-model",
                "prompt_version": "event-synthesis-v2.2.0",
                "request_sha256": "a" * 64,
                "response_sha256": "b" * 64,
            },
        }
        bundle = {
            "issue": {"issueId": row["issueId"]},
            "lineage": {"runId": run_id},
            "comparison": {
                "data": {
                    "synthesis": synthesis,
                    "comparison_result": synthesis["comparison_result"],
                }
            },
        }
        (tmp_path / row["payloadKey"]).write_text(json.dumps(bundle), encoding="utf-8")
    summary = {
        "runId": run_id,
        "rawArticleBodyWritten": False,
        "verification": [{"issueId": r["issueId"], "passed": True} for r in rows],
    }
    return manifest, summary


def test_plan_is_body_free_content_addressed_and_keeps_quality_limits(tmp_path):
    module = load_publisher()
    _, summary = candidate_fixture(tmp_path)
    pointer, objects = module.build_plan(tmp_path, summary)
    assert len(pointer["snapshotId"]) == 32
    assert len(objects) == 7
    assert objects[pointer["active"]]["qualityGate"]["modelQualityMeasured"] is False
    assert objects[pointer["active"]]["qualityGate"]["humanReviewRequired"] is True
    assert module.build_plan(tmp_path, summary)[0] == pointer


def test_all_held_and_failed_verification_cannot_be_promoted(tmp_path):
    module = load_publisher()
    _, summary = candidate_fixture(tmp_path, "held_for_analysis")
    with pytest.raises(ValueError, match="all-held"):
        module.build_plan(tmp_path, summary)
    summary["verification"][0]["passed"] = False
    with pytest.raises(ValueError, match="passed live evidence"):
        module.build_plan(tmp_path, summary)


def test_payload_path_cannot_escape_candidate_directory(tmp_path):
    module = load_publisher()
    manifest, summary = candidate_fixture(tmp_path)
    manifest["issues"][0]["payloadKey"] = "../outside.json"
    (tmp_path / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    with pytest.raises(ValueError, match="within its issue directory"):
        module.build_plan(tmp_path, summary)
