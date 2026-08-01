"""Validate the human annotation completion contract without reading article text."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def records(path: Path) -> list[dict]:
    return [
        json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()
    ]


def validate(items: list[dict]) -> dict:
    errors: list[str] = []
    labeled = 0
    for index, item in enumerate(items, 1):
        if item.get("source", {}).get("kind") != "real":
            errors.append(f"record {index}: source.kind must be real")
        if item.get("split") != "locked_holdout" or item.get("locked") is not True:
            errors.append(f"record {index}: locked holdout metadata is missing")
        article = item.get("article", {})
        if any(key in article for key in ("body", "body_text", "html")):
            errors.append(f"record {index}: raw article content is present")
        annotation = item.get("annotation", {})
        if annotation.get("status") in {"labeled", "adjudicated"}:
            labeled += 1
            annotators = annotation.get("annotator_ids", [])
            if len(annotators) != 2 or len(set(annotators)) != 2:
                errors.append(f"record {index}: two independent annotators are required")
            if annotation.get("adjudicated") is not True:
                errors.append(f"record {index}: adjudication is missing")
            if not isinstance(annotation.get("agreement"), dict):
                errors.append(f"record {index}: agreement report is missing")
    return {
        "records": len(items),
        "labeled_records": labeled,
        "errors": errors,
        "valid": bool(items) and not errors,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("manifest", type=Path)
    args = parser.parse_args()
    result = validate(records(args.manifest))
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["valid"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
