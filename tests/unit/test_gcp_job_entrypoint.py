from __future__ import annotations

import io
import json
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from typing import Any, Mapping

from backend.gcp_job_entrypoint import (
    MigrationOwnershipError,
    RuntimeWiringError,
    build_runtime_config,
    main,
    run_job,
)
from backend.gcp_orchestration import PipelineAdapters

ROOT = Path(__file__).resolve().parents[2]
POLICY = str(ROOT / "site" / "data" / "discovery-sources.json")


class SnapshotFake:
    def __init__(self) -> None:
        self.current: Mapping[str, Any] | None = None
        self.objects: dict[str, Mapping[str, Any]] = {}

    def put_immutable(self, objects: Mapping[str, Mapping[str, Any]]) -> None:
        self.objects.update(objects)

    def read_current_pointer(self) -> Mapping[str, Any] | None:
        return self.current

    def update_current_pointer(self, pointer: Mapping[str, Any]) -> None:
        self.current = dict(pointer)

    def read_public_manifest(self, pointer: Mapping[str, Any]) -> Mapping[str, Any]:
        return self.objects[pointer["manifest"]]


def env(**overrides: str) -> dict[str, str]:
    values = {
        "AGENDAFRAME_DISCOVERY_POLICY": POLICY,
        "AGENDAFRAME_RUN_ID": "cloud-run:2026-08-13T06:00:00+09:00",
        "AGENDAFRAME_BASIS_DATE": "2026-08-13",
        "AGENDAFRAME_PIPELINE_OWNER": "gcp",
        "AGENDAFRAME_CLOUDFLARE_CRON_ENABLED": "false",
        "AGENDAFRAME_LEGACY_SCHEDULE_ENABLED": "false",
        "AGENDAFRAME_ADAPTER_MODE": "injected",
    }
    values.update(overrides)
    return values


class FakeAdapters:
    def __init__(self, snapshots: SnapshotFake) -> None:
        self.snapshots = snapshots
        self.semantic = {
            "unsupportedClaimRate": 0.0,
            "manifest": {"schemaVersion": "agenda.frame.active-snapshot.v1", "issueCount": 5},
            "bundles": {f"issue-{i}": {"issueId": f"issue-{i}"} for i in range(1, 6)},
            "top5": [
                {
                    "issueId": f"issue-{i}",
                    "articles": [
                        {
                            "articleId": f"article-{i}",
                            "evidence": {
                                "locator": {"paragraph": 1, "sentence": 1},
                                "sentence_sha256": "a" * 64,
                            },
                        }
                    ],
                }
                for i in range(1, 6)
            ],
        }

    def as_pipeline(self) -> PipelineAdapters:
        owner = self

        class Collection:
            def collect(self, request, *, idempotency_key):
                return {"articleCount": 5}

        class Persistence:
            def persist(self, request, collected, *, idempotency_key):
                return {"persistedArticleCount": collected["articleCount"]}

        class Cluster:
            def cluster_rank(self, request, persisted, *, idempotency_key):
                return {"top5Candidates": 5}

        class Semantic:
            def analyze_top5(self, request, ranked, *, idempotency_key):
                return owner.semantic

        return PipelineAdapters(Collection(), Persistence(), Cluster(), Semantic(), self.snapshots)


class GcpJobEntrypointTests(unittest.TestCase):
    def test_policy_is_wired_into_request_and_validated_as_twelve_sources(self) -> None:
        config = build_runtime_config(env())
        self.assertEqual(config.policy.source_count, 12)
        self.assertEqual(config.policy.general_daily_count, 10)
        self.assertEqual(config.policy.broadcaster_count, 2)
        self.assertEqual(config.request.source_policy_version, "2026-08-13.1")
        self.assertEqual(config.request.raw_content_delete_after, "2026-10-31T23:59:59+09:00")
        self.assertEqual(config.request.top5_limit, 5)

    def test_migration_ownership_fails_closed_when_cloudflare_still_enabled(self) -> None:
        with self.assertRaises(MigrationOwnershipError):
            build_runtime_config(env(AGENDAFRAME_CLOUDFLARE_CRON_ENABLED="true"))

    def test_basis_date_must_stay_inside_collection_window(self) -> None:
        with self.assertRaises(RuntimeWiringError):
            build_runtime_config(env(AGENDAFRAME_BASIS_DATE="2026-11-01"))
        with self.assertRaises(RuntimeWiringError):
            build_runtime_config(env(AGENDAFRAME_BASIS_DATE="not-a-date"))

    def test_run_job_publishes_and_validates_active_manifest_without_raw_body(self) -> None:
        snapshots = SnapshotFake()
        adapters = FakeAdapters(snapshots).as_pipeline()

        def factory(config):
            self.assertEqual(config.policy.source_count, 12)
            return adapters

        config, result = run_job(env(), adapter_factory=factory)
        self.assertEqual(result.status, "succeeded")
        self.assertEqual(result.snapshot_id, snapshots.current["snapshotId"])
        self.assertTrue(snapshots.current["manifest"].endswith("/manifest.json"))
        manifest = snapshots.objects[snapshots.current["manifest"]]
        self.assertEqual(len(manifest["issues"]), 5)
        self.assertEqual(
            [row["payloadKey"] for row in manifest["issues"]],
            [f"issues/issue-{i}.json" for i in range(1, 6)],
        )
        serialized = repr(snapshots.objects)
        self.assertNotIn("body_text", serialized)
        self.assertNotIn("raw_body", serialized)
        self.assertEqual(config.public_metadata()["sourceCount"], 12)

    def test_missing_adapter_factory_is_not_silently_networked(self) -> None:
        with self.assertRaises(RuntimeWiringError):
            run_job(env())

    def test_main_emits_body_free_structured_runtime_events(self) -> None:
        snapshots = SnapshotFake()
        adapters = FakeAdapters(snapshots).as_pipeline()

        output = io.StringIO()
        with redirect_stdout(output):
            exit_code = main(env=env(), adapter_factory=lambda _config: adapters)

        self.assertEqual(exit_code, 0)
        records = [json.loads(line) for line in output.getvalue().splitlines()]
        events = {record.get("event") for record in records if "event" in record}
        self.assertTrue(
            {
                "collection_run_succeeded",
                "active_snapshot_published",
            }.issubset(events)
        )
        for record in records:
            serialized = json.dumps(record, ensure_ascii=False).casefold()
            for forbidden in ("body_text", "raw_body", "html", "sentence_text", "prompt_payload"):
                self.assertNotIn(forbidden, serialized)


if __name__ == "__main__":
    unittest.main()
