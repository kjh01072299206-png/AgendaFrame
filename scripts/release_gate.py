"""Fail-closed release gate for evals/thresholds.yaml and a labeled holdout.

This is deliberately independent of cloud credentials. It is used in local and
CI checks; a cloud deploy must consume the same result before promotion.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import yaml


def _records(path: Path) -> list[dict]:
    records = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.strip():
            records.append(json.loads(line))
    return records


def dataset_state(records: list[dict]) -> dict:
    if not records:
        return {
            "kind": "missing",
            "status": "missing",
            "annotators": 0,
            "adjudicated": False,
            "agreementReport": False,
            "lockedHoldout": False,
        }
    first = records[0]
    annotations = [record.get("annotation", {}) for record in records]
    source = [record.get("source", {}) for record in records]
    return {
        "kind": "real"
        if all(record.get("source", {}).get("kind") == "real" for record in records)
        else "synthetic",
        "status": "labeled"
        if all(annotation.get("status") in {"labeled", "adjudicated"} for annotation in annotations)
        else "unlabeled",
        "annotators": min(
            (len(annotation.get("annotator_ids", [])) for annotation in annotations), default=0
        ),
        "adjudicated": bool(records)
        and all(annotation.get("adjudicated") is True for annotation in annotations),
        "agreementReport": all(annotation.get("agreement") for annotation in annotations),
        "lockedHoldout": all(
            record.get("locked") is True and record.get("split") == "locked_holdout"
            for record in records
        ),
        "licensed": all(
            source.get("rights_status") in {"licensed", "authorized_research", "public_license"}
            for source in source
        ),
        "recordCount": len(records),
        "datasetVersion": first.get("dataset_version"),
    }


def evaluate(thresholds: dict, dataset: dict, metrics: dict) -> dict:
    reasons: list[str] = []
    human = thresholds.get("human_review", {})
    required = int(human.get("minimum_independent_annotators", 2))
    ready = (
        dataset.get("kind") == "real"
        and dataset.get("status") == "labeled"
        and dataset.get("annotators", 0) >= required
        and dataset.get("adjudicated")
        and dataset.get("agreementReport")
        and dataset.get("lockedHoldout")
        and dataset.get("licensed")
    )
    if not ready:
        reasons.append("real_double_annotated_licensed_locked_holdout_required")
    for flag, reason in (
        ("require_semantic_review", "semantic_review_required"),
        ("require_staging_health_check", "staging_health_check_required"),
        ("require_canary_observation", "canary_observation_required"),
        ("require_rollback_drill", "rollback_drill_required"),
    ):
        if thresholds.get("release_policy", {}).get(flag) is True and not dataset.get(
            flag.removeprefix("require_"), False
        ):
            reasons.append(reason)
    failed: list[dict] = []
    for section in ("clustering", "framing", "report", "calibration"):
        for name, rule in thresholds.get(section, {}).items():
            if isinstance(rule, dict) and "operator" in rule:
                operator = rule["operator"]
                expected = rule["value"]
            elif isinstance(rule, (int, float)) and not isinstance(rule, bool):
                operator = "lte" if name.endswith("_max") else "gte"
                expected = rule
            else:
                continue
            actual = metrics.get(section, {}).get(name)
            passed = isinstance(actual, (int, float)) and (
                actual >= expected if operator == "gte" else actual <= expected
            )
            if not passed:
                failed.append(
                    {
                        "metric": f"{section}.{name}",
                        "actual": actual,
                        "expected": {"operator": operator, "value": expected},
                    }
                )
    if failed:
        reasons.append("metric_threshold_failed")
    if thresholds.get("calibration", {}).get(
        "required_before_numeric_confidence"
    ) and not metrics.get("calibration", {}).get("ready", False):
        reasons.append("calibration_required_before_numeric_confidence")
    return {
        "release_eligible": not reasons,
        "status": "pass" if not reasons else "blocked",
        "reasons": reasons,
        "failed_checks": failed,
        "dataset": dataset,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--thresholds", type=Path, default=Path("evals/thresholds.yaml"))
    parser.add_argument("--holdout", type=Path, default=Path("evals/holdout/manifest.jsonl"))
    parser.add_argument("--metrics", type=Path)
    parser.add_argument("--allow-blocked", action="store_true")
    args = parser.parse_args()
    thresholds = yaml.safe_load(args.thresholds.read_text(encoding="utf-8"))
    metrics = json.loads(args.metrics.read_text(encoding="utf-8")) if args.metrics else {}
    result = evaluate(thresholds, dataset_state(_records(args.holdout)), metrics)
    print(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True))
    return 0 if result["release_eligible"] or args.allow_blocked else 2


if __name__ == "__main__":
    raise SystemExit(main())
