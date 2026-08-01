"""Run a final evidence/meaning review before an external promotion."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import yaml

REQUIRED_FILES = (
    Path("docs/final-release-review.md"),
    Path("site/docs/release-and-operations.md"),
    Path("evals/holdout/manifest.jsonl"),
    Path("site/worker/release-guard.mjs"),
    Path("site/worker/evidence-chat.mjs"),
)


def run(root: Path) -> dict:
    blockers: list[str] = []
    for relative in REQUIRED_FILES:
        if not (root / relative).is_file():
            blockers.append(f"missing:{relative.as_posix()}")
    thresholds = yaml.safe_load((root / "evals/thresholds.yaml").read_text(encoding="utf-8"))
    if thresholds.get("release_eligible") is not True:
        blockers.append("thresholds.release_eligible_false")
    manifest = root / "evals/holdout/manifest.jsonl"
    records = [
        json.loads(line)
        for line in manifest.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    if not records:
        blockers.append("holdout_empty")
    if any(
        any(key in record.get("article", {}) for key in ("body", "body_text", "html"))
        for record in records
    ):
        blockers.append("raw_body_in_holdout")
    artifact = root / "site/dist/server/index.js"
    if artifact.is_file():
        built = artifact.read_text(encoding="utf-8")
        for marker in ("/api/chat", "/community", "/api/admin/release/evaluate"):
            if marker not in built:
                blockers.append(f"build_missing:{marker}")
    else:
        blockers.append("site_build_missing")
    return {
        "release_ready": not blockers,
        "blockers": blockers,
        "holdout_records": len(records),
        "semantic_review_required": True,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--allow-blocked", action="store_true")
    args = parser.parse_args()
    result = run(args.root.resolve())
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["release_ready"] or args.allow_blocked else 2


if __name__ == "__main__":
    raise SystemExit(main())
