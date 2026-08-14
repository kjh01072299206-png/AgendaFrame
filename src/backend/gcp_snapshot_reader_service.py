"""Minimal Cloud Run read service for the private GCS active snapshot.

The service exposes only ``GET /active`` and ``GET /healthz``.  GCS remains
private; the service account reads the current pointer and immutable public
objects, and the body-free validator runs before any response is written.
The HTTP surface is intentionally small so the Vercel environment variable
``AGENDAFRAME_ACTIVE_SNAPSHOT_URL`` can point at one stable endpoint.
"""

from __future__ import annotations

import json
import os
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Mapping

from backend.config import RuntimeConfig
from backend.gcp_live_dependencies import GcsActivePointerStore, GcsImmutableSnapshotWriter
from backend.gcp_production_adapters import build_storage_client
from backend.gcp_snapshot_reader import (
    PublicSnapshotStore,
    SnapshotReaderError,
    read_current_public_snapshot,
)


def public_snapshot_response(store: PublicSnapshotStore) -> tuple[int, Mapping[str, str], bytes]:
    """Return a safe HTTP response tuple without exposing storage errors."""

    try:
        payload = read_current_public_snapshot(store)
    except (SnapshotReaderError, RuntimeError, ValueError, KeyError, TypeError):
        body = json.dumps({"status": "unavailable"}, separators=(",", ":")).encode("utf-8")
        return (
            int(HTTPStatus.SERVICE_UNAVAILABLE),
            {"Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store"},
            body,
        )
    body = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode(
        "utf-8"
    )
    return (
        int(HTTPStatus.OK),
        {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store, max-age=0",
            "X-AgendaFrame-Snapshot": str(payload["snapshotId"]),
        },
        body,
    )


class SnapshotReaderHandler(BaseHTTPRequestHandler):
    store: PublicSnapshotStore | None = None

    def do_GET(self) -> None:  # noqa: N802 - stdlib handler API
        if self.path == "/healthz":
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(b'{"status":"ok"}')
            return
        if self.path != "/active" or self.store is None:
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        status, headers, body = public_snapshot_response(self.store)
        self.send_response(status)
        for name, value in headers.items():
            self.send_header(name, value)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self) -> None:  # noqa: N802 - stdlib handler API
        self.send_error(HTTPStatus.METHOD_NOT_ALLOWED)

    def log_message(self, _format: str, *_args: Any) -> None:
        # Do not log URLs, query strings, or response payloads by default.
        return


class GcsPublicSnapshotStore:
    """Compose the existing GCS pointer/object adapters for the reader."""

    def __init__(self, storage_client: Any, *, bucket_name: str) -> None:
        self.pointer = GcsActivePointerStore(storage_client, bucket_name=bucket_name)
        self.objects = GcsImmutableSnapshotWriter(storage_client, bucket_name=bucket_name)

    def read_current_pointer(self) -> Mapping[str, Any] | None:
        return self.pointer.read_current_pointer()

    def read_public_object(self, reference: str) -> Mapping[str, Any]:
        return self.objects.read_public_object(reference)


def build_store() -> GcsPublicSnapshotStore:
    config = RuntimeConfig.from_yaml(
        os.environ.get("AGENDAFRAME_RUNTIME_CONFIG", "config/gcp-runtime.yaml")
    )
    storage = build_storage_client(config)
    return GcsPublicSnapshotStore(storage, bucket_name=config.bucket)


def main() -> None:
    port = int(os.environ.get("PORT", "8080"))
    SnapshotReaderHandler.store = build_store()
    server = ThreadingHTTPServer(("0.0.0.0", port), SnapshotReaderHandler)
    server.serve_forever()


if __name__ == "__main__":
    main()


__all__ = [
    "GcsPublicSnapshotStore",
    "SnapshotReaderHandler",
    "build_store",
    "main",
    "public_snapshot_response",
]
