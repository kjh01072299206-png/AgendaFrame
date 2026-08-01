"""Validate evaluation assets and exercise metric wiring without model calls."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import yaml

from agendaframe_tooling.evaluation import (
    clustering_metrics,
    multilabel_macro_f1,
    pairs_from_clusters,
)

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_EVAL_ROOT = ROOT / "evals"
FRAME_LABELS = {
    "conflict",
    "responsibility",
    "economic",
    "legal_institutional",
    "policy_effect",
    "citizen_impact",
}


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    for line_number, raw_line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not raw_line.strip():
            continue
        try:
            record = json.loads(raw_line)
        except json.JSONDecodeError as error:
            raise ValueError(f"{path}:{line_number}: invalid JSON: {error}") from error
        if not isinstance(record, dict):
            raise ValueError(f"{path}:{line_number}: expected a JSON object")
        records.append(record)
    if not records:
        raise ValueError(f"{path}: dataset must not be empty")
    return records


def validate_gold(eval_root: Path) -> dict[str, Any]:
    thresholds = yaml.safe_load((eval_root / "thresholds.yaml").read_text(encoding="utf-8"))
    if thresholds["dataset_status"] == "synthetic_schema_only" and thresholds["release_eligible"]:
        raise ValueError("synthetic-only evaluation data cannot be release eligible")

    clustering_records = read_jsonl(eval_root / "clustering" / "gold.jsonl")
    clustering_case_scores: dict[str, float] = {}
    for record in clustering_records:
        cluster_ids = [cluster["article_ids"] for cluster in record["gold_clusters"]]
        gold_pairs = pairs_from_clusters(cluster_ids)
        score = clustering_metrics(gold_pairs, gold_pairs)
        clustering_case_scores[record["case_id"]] = score.pairwise.f1

    framing_records = read_jsonl(eval_root / "framing" / "gold.jsonl")
    framing_gold = {
        record["case_id"]: {label["label"] for label in record["gold"]["labels"]}
        for record in framing_records
    }
    framing_oracle_f1, _ = multilabel_macro_f1(
        framing_gold,
        framing_gold,
        labels=FRAME_LABELS,
    )

    report_records = read_jsonl(eval_root / "report" / "gold.jsonl")
    holdout_path = eval_root / "holdout" / "manifest.jsonl"
    holdout_records = read_jsonl(holdout_path) if holdout_path.is_file() else []
    for record in holdout_records:
        if record.get("source", {}).get("kind") != "real":
            raise ValueError(f"{holdout_path}: holdout records must be real article records")
        if record.get("split") != "locked_holdout" or record.get("locked") is not True:
            raise ValueError(f"{holdout_path}: records must be locked holdout records")
        article = record.get("article", {})
        if "body" in article or "html" in article or record.get("body") is not None:
            raise ValueError(f"{holdout_path}: raw article body must not be committed")
    holdout_status = "unlabeled"
    if holdout_records and all(
        record.get("annotation", {}).get("status") in {"labeled", "adjudicated"}
        for record in holdout_records
    ):
        holdout_status = "labeled_pending_gate"
    prompt_manifest = yaml.safe_load(
        (eval_root / "prompts" / "manifest.yaml").read_text(encoding="utf-8")
    )
    for prompt in prompt_manifest["prompts"]:
        if not (eval_root / "prompts" / prompt["path"]).is_file():
            raise ValueError(f"missing prompt file: {prompt['path']}")
        if not (eval_root / "prompts" / prompt["output_schema"]).is_file():
            raise ValueError(f"missing prompt output schema: {prompt['output_schema']}")

    if any(score != 1.0 for score in clustering_case_scores.values()):
        raise AssertionError("clustering evaluator oracle wiring must score 1.0")
    if framing_oracle_f1 != 1.0:
        raise AssertionError("framing evaluator oracle wiring must score 1.0")

    return {
        "validation_mode": "gold_schema_and_metric_wiring",
        "model_quality_measured": False,
        "dataset_status": thresholds["dataset_status"],
        "release_eligible": thresholds["release_eligible"],
        "holdout_packet": {
            "records": len(holdout_records),
            "status": holdout_status,
            "raw_body_committed": False,
            "release_ready": False,
        },
        "case_counts": {
            "clustering": len(clustering_records),
            "framing": len(framing_records),
            "report": len(report_records),
        },
        "prompt_versions": {
            prompt["id"]: prompt["version"] for prompt in prompt_manifest["prompts"]
        },
        "oracle_wiring": {
            "clustering_pairwise_f1": min(clustering_case_scores.values()),
            "framing_macro_f1": framing_oracle_f1,
        },
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Validate AgendaFrame evaluation assets without external model calls."
    )
    parser.add_argument(
        "--eval-root",
        type=Path,
        default=DEFAULT_EVAL_ROOT,
        help="Evaluation asset directory (default: repository evals directory).",
    )
    parser.add_argument(
        "--output",
        type=Path,
        help="Optional path for a JSON validation manifest.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    summary = validate_gold(args.eval_root.resolve())
    serialized = json.dumps(summary, ensure_ascii=False, indent=2) + "\n"
    if args.output:
        output_path = args.output.resolve()
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(serialized, encoding="utf-8")
    print(serialized, end="")


if __name__ == "__main__":
    main()
