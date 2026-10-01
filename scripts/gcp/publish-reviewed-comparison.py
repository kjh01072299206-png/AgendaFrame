"""Stage a body-free reviewed comparison candidate; promotion is explicit and CAS-protected."""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "src"))
from backend.gcp_live_dependencies import GcsImmutableSnapshotWriter  # noqa: E402
from backend.gcp_snapshot_reader import read_current_public_snapshot  # noqa: E402
from backend.gcp_snapshot_reader_service import public_snapshot_response  # noqa: E402


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def digest(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def batch_module():
    spec = importlib.util.spec_from_file_location(
        "comparison_batch", ROOT / "scripts/run-current-display-framing-live.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def build_plan(candidate: Path, summary: dict):
    batch = batch_module()
    manifest = json.loads((candidate / "manifest.json").read_text(encoding="utf-8"))
    rows = manifest.get("issues", [])
    if len(rows) != 5 or len({r["issueId"] for r in rows}) != 5:
        raise ValueError("five unique candidate issues are required")
    for row in rows:
        issue_id = row["issueId"]
        if (
            any(char in issue_id for char in ("/", "\\"))
            or row.get("payloadKey") != f"issues/{issue_id}.json"
        ):
            raise ValueError("candidate payload references must stay within its issue directory")
    if (
        summary.get("runId") != manifest.get("analysisRunId")
        or summary.get("rawArticleBodyWritten") is not False
    ):
        raise ValueError("candidate verification run identity is invalid")
    verified = {r["issueId"]: r for r in summary.get("verification", [])}
    if set(verified) != {r["issueId"] for r in rows} or not all(
        r.get("passed") for r in verified.values()
    ):
        raise ValueError("every candidate issue needs a passed live evidence verification")
    bundles = {
        r["issueId"]: json.loads((candidate / r["payloadKey"]).read_text(encoding="utf-8"))
        for r in rows
    }
    statuses = []
    for issue_id, bundle in bundles.items():
        if (
            bundle.get("issue", {}).get("issueId") != issue_id
            or bundle.get("lineage", {}).get("runId") != summary["runId"]
        ):
            raise ValueError("candidate bundle identity is inconsistent")
        status, error = batch._comparison_result_gate(bundle)
        if error or status == "analysis_failed":
            raise ValueError("candidate comparison contract is not publishable")
        statuses.append(status)
    if not any(s in {"difference_confirmed", "no_clear_difference"} for s in statuses):
        raise ValueError("an all-held candidate cannot be promoted")
    snapshot_id = digest({"manifest": manifest, "bundles": bundles})[:32]
    prefix = f"snapshots/{manifest['basisDate']}/{snapshot_id}"
    quality = {
        "status": "pass",
        "rawBodyAbsent": True,
        "evidenceLineageComplete": True,
        "publicSnapshotReady": True,
        "source": "current-display-live-anchor-contract",
        "modelQualityMeasured": False,
        "humanReviewRequired": True,
    }
    manifest = {
        **manifest,
        "schemaVersion": "agenda.frame.active-snapshot.v1",
        "snapshotId": snapshot_id,
        "runId": summary["runId"],
        "qualityGate": quality,
    }
    active = {
        "schemaVersion": manifest["schemaVersion"],
        "snapshotId": snapshot_id,
        "basisDate": manifest["basisDate"],
        "generatedAt": manifest["analysisGeneratedAt"],
        "runId": summary["runId"],
        "qualityGate": quality,
        "manifest": manifest,
        "bundles": bundles,
        "top5": rows,
    }
    objects = {f"{prefix}/manifest.json": manifest, f"{prefix}/active.json": active}
    objects.update({f"{prefix}/issues/{key}.json": value for key, value in bundles.items()})
    pointer = {
        "schemaVersion": "agenda.frame.active-snapshot-pointer.v1",
        "snapshotId": snapshot_id,
        "runId": summary["runId"],
        "basisDate": manifest["basisDate"],
        "prefix": prefix,
        "manifest": f"{prefix}/manifest.json",
        "active": f"{prefix}/active.json",
        "manifestSha256": digest(manifest),
        "publishedAt": manifest["analysisGeneratedAt"],
    }

    class Store:
        def read_current_pointer(self):
            return pointer

        def read_public_object(self, key):
            return objects[key]

    read_current_public_snapshot(Store())
    return pointer, objects


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--candidate-dir", type=Path, required=True)
    parser.add_argument("--verification-summary", type=Path, required=True)
    parser.add_argument("--stage-dir", type=Path, required=True)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--promote", action="store_true")
    parser.add_argument("--expected-current-snapshot-id")
    parser.add_argument("--reviewed-commit")
    parser.add_argument("--gcloud-bin", type=Path, default=Path("gcloud"))
    parser.add_argument("--gcloud-config", type=Path)
    parser.add_argument("--access-token-env", default="AGENDAFRAME_ACCESS_TOKEN")
    args = parser.parse_args()
    batch = batch_module()
    summary = json.loads(args.verification_summary.read_text(encoding="utf-8"))
    pointer, objects = build_plan(args.candidate_dir, summary)
    args.stage_dir.mkdir(parents=True, exist_ok=True)
    for key, value in objects.items():
        batch.atomic_write_json(args.stage_dir / key, value)
    batch.atomic_write_json(args.stage_dir / "pointer.json", pointer)
    batch.atomic_write_json(args.stage_dir / "active.json", objects[pointer["active"]])
    if not args.apply:
        print(
            json.dumps(
                {
                    "dryRun": True,
                    "snapshotId": pointer["snapshotId"],
                    "immutableObjects": len(objects),
                }
            )
        )
        return 0
    if os.environ.get("AGENDAFRAME_LIVE_TESTS") != "1":
        raise ValueError("explicit live opt-in is required")
    head = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
    dirty = subprocess.check_output(
        ["git", "status", "--porcelain", "--untracked-files=no"], cwd=ROOT, text=True
    ).strip()
    if head != args.reviewed_commit or dirty:
        raise ValueError("immutable publication requires a clean reviewed commit")
    public = ROOT / "site/public/initial-five"
    if digest(json.loads((public / "manifest.json").read_text(encoding="utf-8"))) != digest(
        json.loads((args.candidate_dir / "manifest.json").read_text(encoding="utf-8"))
    ):
        raise ValueError("candidate manifest is not the reviewed commit's public artifact")
    for row in summary["verification"]:
        key = f"issues/{row['issueId']}.json"
        if digest(json.loads((public / key).read_text(encoding="utf-8"))) != digest(
            json.loads((args.candidate_dir / key).read_text(encoding="utf-8"))
        ):
            raise ValueError("candidate bundle is not the reviewed commit's public artifact")
    from google.cloud import storage
    from google.oauth2.credentials import Credentials

    config = batch.RuntimeConfig.from_yaml(batch.DEFAULT_CONFIG)
    token = batch.resolve_access_token(args)
    client = storage.Client(project=config.project_id, credentials=Credentials(token=token))
    writer = GcsImmutableSnapshotWriter(client, bucket_name=config.bucket)
    writer.put_immutable(objects)

    class StagingStore:
        def read_current_pointer(self):
            return pointer

        def read_public_object(self, key):
            return writer.read_public_object(key)

    status, _, response = public_snapshot_response(StagingStore())
    if status != 200 or json.loads(response).get("snapshotId") != pointer["snapshotId"]:
        raise ValueError("uploaded immutable snapshot failed the staging reader")
    receipt = {
        "snapshotId": pointer["snapshotId"],
        "immutableObjects": len(objects),
        "stagingReaderStatus": status,
        "reviewedCommit": head,
        "promoted": False,
    }
    if args.promote:
        blob = client.bucket(config.bucket).blob("snapshots/current.json")
        blob.reload()
        generation = blob.generation
        previous = json.loads(
            blob.download_as_text(encoding="utf-8", if_generation_match=generation)
        )
        if previous.get("snapshotId") != args.expected_current_snapshot_id:
            raise ValueError("current pointer changed; promotion aborted without overwriting it")
        batch.atomic_write_json(args.stage_dir / "previous-pointer.json", previous)
        blob.cache_control = "no-store, max-age=0"
        blob.upload_from_string(
            canonical(pointer),
            content_type="application/json; charset=utf-8",
            if_generation_match=generation,
        )
        receipt["promoted"] = True
        receipt["previousSnapshotId"] = previous["snapshotId"]
    batch.atomic_write_json(args.stage_dir / "publication-receipt.json", receipt)
    print(json.dumps(receipt))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
