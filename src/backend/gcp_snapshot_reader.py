"""Body-free reader for the immutable GCP public snapshot.

The collector publishes an immutable ``manifest.json`` and ``active.json``
under a content-addressed prefix, then moves ``snapshots/current.json``.  This
module is the read boundary used by a future Cloud Run snapshot-reader
service.  It deliberately accepts a tiny storage protocol so every rule is
testable without GCS credentials or network access.

Only the already-public envelope crosses this boundary.  Article bodies,
HTML, prompt payloads, and sentence text are rejected recursively before the
response can be returned to Vercel.
"""

from __future__ import annotations

import hashlib
import json
import re
from typing import Any, Mapping, Protocol

from backend.gcp_orchestration import QualityGateError, assert_body_safe

POINTER_SCHEMA = "agenda.frame.active-snapshot-pointer.v1"
SNAPSHOT_SCHEMA = "agenda.frame.active-snapshot.v1"
SNAPSHOT_ID_PATTERN = re.compile(r"^[0-9a-f]{32}$")
SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")
_FORBIDDEN_REFERENCE_PARTS = frozenset({"", ".", ".."})


class SnapshotReaderError(RuntimeError):
    """The current pointer or immutable public objects are not serveable."""


class PublicSnapshotStore(Protocol):
    def read_current_pointer(self) -> Mapping[str, Any] | None: ...

    def read_public_object(self, reference: str) -> Mapping[str, Any]: ...


def _canonical_json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str)


def _digest(value: object) -> str:
    return hashlib.sha256(_canonical_json(value).encode("utf-8")).hexdigest()


def _reference(value: object, *, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise SnapshotReaderError(f"pointer {field} is missing")
    reference = value.strip()
    if reference.startswith("/") or "\\" in reference:
        raise SnapshotReaderError(f"pointer {field} is not a safe object reference")
    if any(part in _FORBIDDEN_REFERENCE_PARTS for part in reference.split("/")):
        raise SnapshotReaderError(f"pointer {field} contains an unsafe path component")
    return reference


def _mapping(value: object, *, context: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise SnapshotReaderError(f"{context} must be an object")
    return value


def _assert_public(value: object, *, context: str) -> None:
    try:
        assert_body_safe(value, context=context)
    except QualityGateError as error:
        raise SnapshotReaderError(str(error)) from error


def _validate_pointer(pointer: Mapping[str, Any]) -> tuple[str, str, str]:
    _assert_public(pointer, context="active snapshot pointer")
    if pointer.get("schemaVersion") != POINTER_SCHEMA:
        raise SnapshotReaderError("active snapshot pointer schema is invalid")
    snapshot_id = pointer.get("snapshotId")
    if not isinstance(snapshot_id, str) or not SNAPSHOT_ID_PATTERN.fullmatch(snapshot_id):
        raise SnapshotReaderError("active snapshot pointer snapshotId is invalid")
    prefix = _reference(pointer.get("prefix"), field="prefix")
    manifest = _reference(pointer.get("manifest"), field="manifest")
    active = _reference(pointer.get("active"), field="active")
    if manifest != f"{prefix}/manifest.json" or active != f"{prefix}/active.json":
        raise SnapshotReaderError("active snapshot pointer references do not match prefix")
    manifest_sha256 = pointer.get("manifestSha256")
    if not isinstance(manifest_sha256, str) or not SHA256_PATTERN.fullmatch(manifest_sha256):
        raise SnapshotReaderError("active snapshot pointer manifestSha256 is invalid")
    return snapshot_id, manifest, active


def _validate_manifest(
    manifest: Mapping[str, Any],
    *,
    snapshot_id: str,
    manifest_sha256: str,
) -> set[str]:
    _assert_public(manifest, context="active snapshot manifest")
    if manifest.get("schemaVersion") != SNAPSHOT_SCHEMA:
        raise SnapshotReaderError("active snapshot manifest schema is invalid")
    if manifest.get("snapshotId") != snapshot_id:
        raise SnapshotReaderError("active snapshot manifest snapshotId does not match pointer")
    if _digest(manifest) != manifest_sha256:
        raise SnapshotReaderError("active snapshot manifest digest does not match pointer")
    quality = manifest.get("qualityGate")
    if not isinstance(quality, Mapping) or quality.get("status") != "pass":
        raise SnapshotReaderError("active snapshot manifest quality gate is not publishable")
    if quality.get("rawBodyAbsent") is not True or quality.get("evidenceLineageComplete") is not True:
        raise SnapshotReaderError("active snapshot manifest has incomplete public quality metadata")
    issues = manifest.get("issues")
    if manifest.get("issueCount") != 5 or not isinstance(issues, list) or len(issues) != 5:
        raise SnapshotReaderError("active snapshot manifest must contain exactly five issues")
    issue_ids: set[str] = set()
    for index, issue in enumerate(issues, 1):
        row = _mapping(issue, context=f"active snapshot issue {index}")
        issue_id = row.get("issueId")
        payload_key = row.get("payloadKey")
        if not isinstance(issue_id, str) or not issue_id.strip() or issue_id in issue_ids:
            raise SnapshotReaderError("active snapshot issue IDs must be unique and non-empty")
        if payload_key != f"issues/{issue_id}.json":
            raise SnapshotReaderError("active snapshot issue payloadKey is inconsistent")
        issue_ids.add(issue_id)
    return issue_ids


def read_current_public_snapshot(store: PublicSnapshotStore) -> Mapping[str, Any]:
    """Read and validate the current pointer, manifest, and public payload."""

    pointer = store.read_current_pointer()
    if pointer is None:
        raise SnapshotReaderError("active snapshot pointer is not published")
    pointer_map = _mapping(pointer, context="active snapshot pointer")
    snapshot_id, manifest_ref, active_ref = _validate_pointer(pointer_map)
    manifest = _mapping(store.read_public_object(manifest_ref), context="active snapshot manifest")
    issue_ids = _validate_manifest(
        manifest,
        snapshot_id=snapshot_id,
        manifest_sha256=str(pointer_map["manifestSha256"]),
    )
    active = _mapping(store.read_public_object(active_ref), context="active snapshot payload")
    _assert_public(active, context="active snapshot payload")
    if active.get("schemaVersion") != SNAPSHOT_SCHEMA or active.get("snapshotId") != snapshot_id:
        raise SnapshotReaderError("active snapshot payload identity does not match pointer")
    if active.get("manifest") != manifest:
        raise SnapshotReaderError("active snapshot payload manifest does not match immutable manifest")
    bundles = active.get("bundles")
    if not isinstance(bundles, Mapping) or set(bundles) != issue_ids:
        raise SnapshotReaderError("active snapshot payload bundles do not match manifest issues")
    return dict(active)


__all__ = ["POINTER_SCHEMA", "SNAPSHOT_SCHEMA", "PublicSnapshotStore", "SnapshotReaderError", "read_current_public_snapshot"]
