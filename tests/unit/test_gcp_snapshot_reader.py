from __future__ import annotations

import hashlib
import json
import unittest
from typing import Any, Mapping

from backend.gcp_snapshot_reader import SnapshotReaderError, read_current_public_snapshot


def _digest(value: object) -> str:
    body = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(body.encode("utf-8")).hexdigest()


class SnapshotStoreFake:
    def __init__(
        self, pointer: Mapping[str, Any], objects: Mapping[str, Mapping[str, Any]]
    ) -> None:
        self.pointer = dict(pointer)
        self.objects = {key: dict(value) for key, value in objects.items()}

    def read_current_pointer(self) -> Mapping[str, Any] | None:
        return self.pointer

    def read_public_object(self, reference: str) -> Mapping[str, Any]:
        return self.objects[reference]


def valid_store() -> SnapshotStoreFake:
    snapshot_id = "0123456789abcdef0123456789abcdef"
    prefix = f"snapshots/2026-08-13/{snapshot_id}"
    issues = [
        {
            "issueId": f"issue-{index}",
            "rank": index,
            "payloadKey": f"issues/issue-{index}.json",
        }
        for index in range(1, 6)
    ]
    manifest = {
        "schemaVersion": "agenda.frame.active-snapshot.v1",
        "snapshotId": snapshot_id,
        "issueCount": 5,
        "issues": issues,
        "qualityGate": {
            "status": "pass",
            "rawBodyAbsent": True,
            "evidenceLineageComplete": True,
        },
    }
    active = {
        "schemaVersion": "agenda.frame.active-snapshot.v1",
        "snapshotId": snapshot_id,
        "manifest": manifest,
        "bundles": {issue["issueId"]: {"issue": issue} for issue in issues},
    }
    pointer = {
        "schemaVersion": "agenda.frame.active-snapshot-pointer.v1",
        "snapshotId": snapshot_id,
        "prefix": prefix,
        "manifest": f"{prefix}/manifest.json",
        "active": f"{prefix}/active.json",
        "manifestSha256": _digest(manifest),
    }
    return SnapshotStoreFake(
        pointer,
        {
            pointer["manifest"]: manifest,
            pointer["active"]: active,
        },
    )


class GcpSnapshotReaderTests(unittest.TestCase):
    def test_reads_current_pointer_and_returns_public_envelope(self) -> None:
        payload = read_current_public_snapshot(valid_store())
        self.assertEqual(payload["snapshotId"], "0123456789abcdef0123456789abcdef")
        self.assertEqual(len(payload["bundles"]), 5)

    def test_rejects_manifest_digest_mismatch(self) -> None:
        store = valid_store()
        store.pointer["manifestSha256"] = "0" * 64
        with self.assertRaisesRegex(SnapshotReaderError, "digest"):
            read_current_public_snapshot(store)

    def test_rejects_active_payload_manifest_substitution(self) -> None:
        store = valid_store()
        store.objects[store.pointer["active"]]["manifest"] = {"snapshotId": "other"}
        with self.assertRaisesRegex(SnapshotReaderError, "manifest"):
            read_current_public_snapshot(store)

    def test_rejects_raw_body_fields_before_serving(self) -> None:
        store = valid_store()
        store.objects[store.pointer["active"]]["bundles"]["issue-1"]["raw_body"] = "secret"
        with self.assertRaisesRegex(SnapshotReaderError, "forbidden raw-body"):
            read_current_public_snapshot(store)

    def test_rejects_path_traversal_pointer(self) -> None:
        store = valid_store()
        store.pointer["active"] = f"{store.pointer['prefix']}/../active.json"
        with self.assertRaisesRegex(SnapshotReaderError, "unsafe"):
            read_current_public_snapshot(store)


if __name__ == "__main__":
    unittest.main()
