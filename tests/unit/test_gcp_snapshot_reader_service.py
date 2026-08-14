from __future__ import annotations

import hashlib
import json
import unittest
from typing import Any, Mapping

from backend.gcp_snapshot_reader_service import public_snapshot_response


def _digest(value: object) -> str:
    body = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(body.encode("utf-8")).hexdigest()


class Store:
    def __init__(
        self, pointer: Mapping[str, Any], objects: Mapping[str, Mapping[str, Any]]
    ) -> None:
        self.pointer = dict(pointer)
        self.objects = {key: dict(value) for key, value in objects.items()}

    def read_current_pointer(self) -> Mapping[str, Any] | None:
        return self.pointer

    def read_public_object(self, reference: str) -> Mapping[str, Any]:
        return self.objects[reference]


def store() -> Store:
    snapshot_id = "0123456789abcdef0123456789abcdef"
    prefix = f"snapshots/2026-08-13/{snapshot_id}"
    issues = [
        {"issueId": f"issue-{index}", "rank": index, "payloadKey": f"issues/issue-{index}.json"}
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
    return Store(pointer, {pointer["manifest"]: manifest, pointer["active"]: active})


class SnapshotReaderServiceTests(unittest.TestCase):
    def test_valid_snapshot_is_body_free_json_response(self) -> None:
        status, headers, body = public_snapshot_response(store())
        self.assertEqual(status, 200)
        self.assertEqual(headers["Cache-Control"], "no-store, max-age=0")
        self.assertIn("snapshotId", json.loads(body))
        self.assertNotIn("raw_body", body.decode("utf-8"))

    def test_invalid_snapshot_returns_generic_no_store_503(self) -> None:
        bad = store()
        bad.pointer["manifestSha256"] = "0" * 64
        status, headers, body = public_snapshot_response(bad)
        self.assertEqual(status, 503)
        self.assertEqual(headers["Cache-Control"], "no-store")
        self.assertEqual(json.loads(body), {"status": "unavailable"})


if __name__ == "__main__":
    unittest.main()
