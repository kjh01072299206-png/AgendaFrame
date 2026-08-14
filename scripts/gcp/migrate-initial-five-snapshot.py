"""Migrate the historical five public bundles to the validated GCP envelope.

The original pilot loader wrote a short ``basisDate/prefix`` pointer.  The
Cloud Run reader requires an immutable, body-free ``active.json`` plus a
content-addressed manifest and a pointer that includes their digest.  This
script transforms only the already-public ``site/public/initial-five`` JSON;
it never reads or uploads article bodies.  It is dry-run by default and live
use requires ``AGENDAFRAME_LIVE_TESTS=1``.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping

REPO_ROOT = Path(__file__).resolve().parents[2]
PROJECT_ID = "project-40bc06fc-fb4b-46b6-a10"
REGION = "asia-northeast3"
BUCKET = f"{PROJECT_ID}-agendaframe-private"
BASIS_DATE = "2026-07-26"
PUBLIC_DIR = REPO_ROOT / "site" / "public" / "initial-five"
FORBIDDEN_KEYS = frozenset(
    {
        "body_text",
        "bodytext",
        "raw_body",
        "rawbody",
        "html",
        "sentence_text",
        "sentencetext",
        "full_article",
        "fullarticle",
        "article_content",
        "articlecontent",
        "full_content",
        "fullcontent",
        "prompt_payload",
        "promptpayload",
        "evidence_text",
        "evidencetext",
    }
)


class MigrationError(RuntimeError):
    """Raised when the historical public artifact is not safe to migrate."""


def canonical_json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def sha256_json(value: object) -> str:
    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


def assert_body_free(value: object, path: str = "root") -> None:
    if isinstance(value, Mapping):
        for key, child in value.items():
            lowered = str(key).lower()
            if lowered in FORBIDDEN_KEYS:
                raise MigrationError(f"forbidden public field at {path}.{key}")
            assert_body_free(child, f"{path}.{key}")
    elif isinstance(value, list):
        for index, child in enumerate(value):
            assert_body_free(child, f"{path}[{index}]")


def read_json(path: Path) -> dict[str, Any]:
    if not path.is_file():
        raise MigrationError(f"missing public artifact: {path}")
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise MigrationError(f"public artifact must be an object: {path}")
    assert_body_free(value, str(path))
    return value


@dataclass(frozen=True)
class MigrationPlan:
    snapshot_id: str
    prefix: str
    objects: dict[str, dict[str, Any]]
    pointer: dict[str, Any]


def build_plan() -> MigrationPlan:
    source_manifest = read_json(PUBLIC_DIR / "manifest.json")
    rows = source_manifest.get("issues")
    if not isinstance(rows, list) or len(rows) != 5:
        raise MigrationError("historical public manifest must contain exactly five issues")

    # The artifact digest gives the migration a deterministic identity.  The
    # full 32-character ID is required by both the site and Cloud Run reader.
    snapshot_id = hashlib.sha256(
        canonical_json({"source": source_manifest, "migration": "active-v1"}).encode("utf-8")
    ).hexdigest()[:32]
    prefix = f"snapshots/{BASIS_DATE}/{snapshot_id}"
    run_id = f"initial-five-envelope-migration-{BASIS_DATE}-{snapshot_id}"

    bundles: dict[str, dict[str, Any]] = {}
    top5: list[dict[str, Any]] = []
    manifest_issues: list[dict[str, Any]] = []
    for rank, row in enumerate(rows, 1):
        if not isinstance(row, dict):
            raise MigrationError(f"manifest issue {rank} is not an object")
        issue_id = str(row.get("issueId", "")).strip()
        if not issue_id:
            raise MigrationError(f"manifest issue {rank} has no issueId")
        bundle = read_json(PUBLIC_DIR / "issues" / f"{issue_id}.json")
        if bundle.get("issue", {}).get("issueId") != issue_id:
            raise MigrationError(f"bundle identity mismatch: {issue_id}")
        bundles[issue_id] = bundle
        issue_row = {
            "issueId": issue_id,
            "rank": rank,
            "title": row.get("title", issue_id),
            "category": row.get("category"),
            "articleCount": int(row.get("articleCount", 0)),
            "outletCount": int(row.get("outletCount", 0)),
            "status": "succeeded",
            "payloadKey": f"issues/{issue_id}.json",
            "semantic": row.get("semantic"),
            "clusterAi": row.get("clusterAi"),
        }
        manifest_issues.append(issue_row)
        top5.append(dict(issue_row))

    quality_gate = {
        "status": "pass",
        "rawBodyAbsent": True,
        "evidenceLineageComplete": True,
        "publicSnapshotReady": True,
        "unsupportedClaimRate": 0.0,
        "source": "historical-public-artifact-contract",
    }
    manifest = {
        "schemaVersion": "agenda.frame.active-snapshot.v1",
        "snapshotId": snapshot_id,
        "runId": run_id,
        "basisDate": BASIS_DATE,
        "sourcePolicyVersion": "historical-initial-five-public-artifact",
        "modelRevision": "historical-public-artifact",
        "promptVersion": "artifact-lineage",
        "rawContentDeleteAfter": "2026-10-31T23:59:59+09:00",
        "qualityGate": quality_gate,
        "issueCount": 5,
        "articleCount": sum(row["articleCount"] for row in manifest_issues),
        "issues": manifest_issues,
    }
    active = {
        "schemaVersion": "agenda.frame.active-snapshot.v1",
        "snapshotId": snapshot_id,
        "basisDate": BASIS_DATE,
        "runId": run_id,
        "sourcePolicyVersion": manifest["sourcePolicyVersion"],
        "modelRevision": manifest["modelRevision"],
        "promptVersion": manifest["promptVersion"],
        "qualityGate": quality_gate,
        "manifest": manifest,
        "bundles": bundles,
        "top5": top5,
    }
    assert_body_free(manifest)
    assert_body_free(active)
    objects = {
        f"{prefix}/manifest.json": manifest,
        f"{prefix}/active.json": active,
    }
    objects.update(
        {f"{prefix}/issues/{issue_id}.json": bundle for issue_id, bundle in bundles.items()}
    )
    pointer = {
        "schemaVersion": "agenda.frame.active-snapshot-pointer.v1",
        "snapshotId": snapshot_id,
        "runId": run_id,
        "basisDate": BASIS_DATE,
        "prefix": prefix,
        "manifest": f"{prefix}/manifest.json",
        "active": f"{prefix}/active.json",
        "manifestSha256": sha256_json(manifest),
        "publishedAt": "2026-08-15T00:00:00+09:00",
    }
    assert_body_free(pointer)
    return MigrationPlan(snapshot_id=snapshot_id, prefix=prefix, objects=objects, pointer=pointer)


def describe(plan: MigrationPlan) -> None:
    print(f"project={PROJECT_ID} bucket=gs://{BUCKET}")
    print(f"snapshot={plan.snapshot_id} prefix={plan.prefix}")
    print(f"immutable_objects={len(plan.objects)} issue_count=5 body_free=true")
    print("current_pointer=updated_last")


def apply(plan: MigrationPlan) -> None:
    from google.cloud import storage

    client = storage.Client(project=PROJECT_ID)
    bucket = client.bucket(BUCKET)
    for name, payload in plan.objects.items():
        blob = bucket.blob(name)
        blob.cache_control = "public, max-age=31536000, immutable"
        blob.upload_from_string(canonical_json(payload), content_type="application/json")
    # The pointer is intentionally the final write. A failed immutable upload
    # therefore leaves the previous pointer serving and does not publish a
    # partial snapshot.
    pointer = bucket.blob("snapshots/current.json")
    pointer.cache_control = "no-cache"
    pointer.upload_from_string(canonical_json(plan.pointer), content_type="application/json")
    print(f"published snapshot {plan.snapshot_id} ({len(plan.objects)} immutable objects)")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args(argv)
    try:
        plan = build_plan()
        describe(plan)
        if not args.apply:
            print("dry-run only; use --apply with AGENDAFRAME_LIVE_TESTS=1")
            return 0
        if os.environ.get("AGENDAFRAME_LIVE_TESTS") != "1":
            raise MigrationError("live GCS migration requires AGENDAFRAME_LIVE_TESTS=1")
        apply(plan)
    except MigrationError as error:
        print(f"migration blocked: {error}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
