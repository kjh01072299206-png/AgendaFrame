from __future__ import annotations

import json
import unittest
from pathlib import Path
from typing import Any, Mapping

from backend.gcp_orchestration import (
    GcpPipelineOrchestrator,
    InMemoryIdempotencyStore,
    OrchestrationRequest,
    PipelineAdapters,
    StagePolicy,
)

ROOT = Path(__file__).resolve().parents[2]


def _receipt(model: str, prompt_version: str = "framing-v2") -> dict[str, Any]:
    return {
        "provider": "vertex_ai",
        "model": model,
        "prompt_version": prompt_version,
        "attempt": 1,
        "request_sha256": "a" * 64,
        "response_sha256": "b" * 64,
        "completed_at": "2026-08-13T06:00:00+09:00",
    }


def _verified_semantic_fixture() -> dict[str, Any]:
    bundles: dict[str, Any] = {}
    top5: list[dict[str, Any]] = []
    for index in range(1, 6):
        issue_id = f"issue-{index}"
        cluster_engine = {
            "engineLabel": "ai_semantic",
            "semanticAi": True,
            "status": "succeeded",
            "model": "fake-cluster",
            "promptVersion": "framing-v2",
            "runId": "run-2026-08-13-0600",
            "invocation": _receipt("fake-cluster"),
        }
        semantic_engine = {
            "engineLabel": "ai_semantic",
            "semanticAi": True,
            "status": "succeeded",
            "model": "fake-gemini",
            "promptVersion": "framing-v2",
            "runId": "run-2026-08-13-0600",
            "invocations": [_receipt("fake-gemini")],
        }
        articles: list[dict[str, Any]] = []
        profiles: list[dict[str, Any]] = []
        for member in range(1, 4):
            article_id = f"article-{index}-{member}"
            evidence = {
                "articleId": article_id,
                "locator": {"paragraph": 1, "sentence": member},
                "sentenceSha256": "a" * 64,
            }
            articles.append(
                {
                    "articleId": article_id,
                    "sourceId": f"source-{index}-{1 if member < 3 else 2}",
                    "outlet": f"source-{index}-{1 if member < 3 else 2}",
                    "title": f"Observed event {index} report {member}",
                    "evidence": {
                        "locator": {"paragraph": 1, "sentence": member},
                        "sentence_sha256": "a" * 64,
                    },
                }
            )
            profiles.append(
                {
                    "articleId": article_id,
                    "status": "succeeded",
                    "engine": {
                        **semantic_engine,
                        "articleId": article_id,
                        "invocation": _receipt("fake-gemini"),
                    },
                    "evidence": [evidence],
                }
            )
        bundle = {
            "schemaVersion": "agendaframe.initial-five.public.v1",
            "basisDate": "2026-08-13",
            "status": "succeeded",
            "issue": {
                "issueId": issue_id,
                "agendaScore": 20,
                "outletCount": 2,
            },
            "analysisStatus": {"cluster": cluster_engine, "semantic": semantic_engine},
            "semanticProfiles": profiles,
        }
        bundles[issue_id] = bundle
        top5.append(
            {
                "issueId": issue_id,
                "rank": index,
                "title": f"Issue {index}",
                "status": "succeeded",
                "agendaScore": 20,
                "outletCount": 2,
                "clusterAi": cluster_engine,
                "semantic": semantic_engine,
                "articles": articles,
            }
        )
    return {
        "unsupportedClaimRate": 0.0,
        "manifest": {
            "schemaVersion": "agenda.frame.active-snapshot.v1",
            "issueCount": 5,
            "rawBodyAbsent": True,
        },
        "bundles": bundles,
        "top5": top5,
    }


class FakeSnapshots:
    def __init__(self, current: Mapping[str, Any] | None = None) -> None:
        self.current = dict(current) if current else None
        self.objects: list[Mapping[str, Mapping[str, Any]]] = []
        self.pointer_updates: list[Mapping[str, Any]] = []

    def put_immutable(self, objects: Mapping[str, Mapping[str, Any]]) -> None:
        self.objects.append(dict(objects))

    def read_current_pointer(self) -> Mapping[str, Any] | None:
        return self.current

    def update_current_pointer(self, pointer: Mapping[str, Any]) -> None:
        self.pointer_updates.append(dict(pointer))
        self.current = dict(pointer)


class FakeAdapters:
    def __init__(
        self, snapshots: FakeSnapshots, *, semantic: Mapping[str, Any] | None = None
    ) -> None:
        self.snapshots = snapshots
        self.semantic = semantic or _verified_semantic_fixture()
        self.calls: list[str] = []
        self.fail_once: set[str] = set()
        self.attempts: dict[str, int] = {}

    def _call(self, name: str, value: Mapping[str, Any]) -> Mapping[str, Any]:
        self.calls.append(name)
        self.attempts[name] = self.attempts.get(name, 0) + 1
        if name in self.fail_once and self.attempts[name] == 1:
            raise RuntimeError(f"temporary {name} failure")
        return value

    def pipeline(self) -> PipelineAdapters:
        owner = self

        class Collection:
            def collect(
                self, request: OrchestrationRequest, *, idempotency_key: str
            ) -> Mapping[str, Any]:
                return owner._call("collect", {"articleCount": 5, "metadata": [{"articleId": "a"}]})

        class Persistence:
            def persist(
                self,
                request: OrchestrationRequest,
                collected: Mapping[str, Any],
                *,
                idempotency_key: str,
            ) -> Mapping[str, Any]:
                return owner._call("persist", {"persistedArticleCount": collected["articleCount"]})

        class Cluster:
            def cluster_rank(
                self,
                request: OrchestrationRequest,
                persisted: Mapping[str, Any],
                *,
                idempotency_key: str,
            ) -> Mapping[str, Any]:
                return owner._call("cluster_rank", {"top5Candidates": 5})

        class Semantic:
            def analyze_top5(
                self,
                request: OrchestrationRequest,
                ranked: Mapping[str, Any],
                *,
                idempotency_key: str,
            ) -> Mapping[str, Any]:
                return owner._call("top5_semantic", owner.semantic)

        return PipelineAdapters(Collection(), Persistence(), Cluster(), Semantic(), self.snapshots)


def request() -> OrchestrationRequest:
    return OrchestrationRequest(
        run_id="run-2026-08-13-0600",
        basis_date="2026-08-13",
        source_policy_version="2026-08-13.1",
        model_revision="gemini-2.5-flash-lite@reviewed",
        prompt_version="framing-v2",
        started_at="2026-08-13T06:00:00+09:00",
    )


class GcpOrchestrationTests(unittest.TestCase):
    def test_runs_stages_in_order_and_publishes_pointer_last(self) -> None:
        snapshots = FakeSnapshots()
        fakes = FakeAdapters(snapshots)
        result = GcpPipelineOrchestrator(
            fakes.pipeline(), idempotency=InMemoryIdempotencyStore()
        ).run(request())
        self.assertEqual(result.status, "succeeded")
        self.assertEqual(
            [record.name for record in result.stage_records],
            ["collect", "persist", "cluster_rank", "top5_semantic", "quality_gate", "publish"],
        )
        self.assertEqual(len(snapshots.objects), 1)
        self.assertEqual(len(snapshots.pointer_updates), 1)
        self.assertEqual(snapshots.pointer_updates[0]["snapshotId"], result.snapshot_id)
        self.assertTrue(all("body_text" not in json.dumps(obj) for obj in snapshots.objects))
        active = next(
            value
            for objects in snapshots.objects
            for key, value in objects.items()
            if key.endswith("/active.json")
        )
        self.assertEqual(active["snapshotId"], result.snapshot_id)
        self.assertEqual(active["manifest"]["issueCount"], 5)
        self.assertEqual(len(active["manifest"]["issues"]), 5)
        manifest = next(
            value
            for objects in snapshots.objects
            for key, value in objects.items()
            if key.endswith("/manifest.json")
        )
        # The active payload, immutable manifest and pointer must converge on
        # one snapshot identity.  This catches a subtle bug where hashing an
        # active payload before adding its own snapshotId produced three
        # apparently valid but non-joinable references.
        self.assertEqual(active["snapshotId"], manifest["snapshotId"])
        self.assertEqual(snapshots.pointer_updates[0]["snapshotId"], manifest["snapshotId"])
        self.assertEqual(manifest["issueCount"], 5)
        self.assertEqual([row["rank"] for row in manifest["issues"]], [1, 2, 3, 4, 5])
        self.assertTrue(
            all("articleCount" in row and "semantic" in row for row in manifest["issues"])
        )

    def test_retries_are_bounded_and_second_run_reuses_idempotent_results(self) -> None:
        snapshots = FakeSnapshots()
        fakes = FakeAdapters(snapshots)
        fakes.fail_once.add("collect")
        store = InMemoryIdempotencyStore()
        policies = {
            name: StagePolicy(1)
            for name in (
                "collect",
                "persist",
                "cluster_rank",
                "top5_semantic",
                "quality_gate",
                "publish",
            )
        }
        policies["collect"] = StagePolicy(2)
        orchestrator = GcpPipelineOrchestrator(
            fakes.pipeline(), idempotency=store, stage_policies=policies
        )
        first = orchestrator.run(request())
        second = orchestrator.run(request())
        self.assertEqual(first.status, "succeeded")
        self.assertEqual(second.status, "succeeded")
        self.assertEqual(fakes.attempts["collect"], 2)
        self.assertEqual(fakes.calls.count("persist"), 1)
        self.assertTrue(all(record.reused for record in second.stage_records))
        self.assertEqual(len(snapshots.pointer_updates), 1)

    def test_quality_failure_preserves_previous_pointer_and_does_not_publish(self) -> None:
        old = {"snapshotId": "previous"}
        snapshots = FakeSnapshots(old)
        semantic = {
            "unsupportedClaimRate": 0.5,
            "manifest": {"schemaVersion": "agenda.frame.active-snapshot.v1", "issueCount": 5},
            "bundles": {
                f"issue-{index}": {"issue": {"issueId": f"issue-{index}"}} for index in range(1, 6)
            },
            "top5": [
                {
                    "issueId": f"issue-{index}",
                    "articles": [{"articleId": f"article-{index}", "evidence": {"locator": "p1"}}],
                }
                for index in range(1, 6)
            ],
        }
        fakes = FakeAdapters(snapshots, semantic=semantic)
        result = GcpPipelineOrchestrator(
            fakes.pipeline(), idempotency=InMemoryIdempotencyStore()
        ).run(request())
        self.assertEqual(result.status, "quarantined")
        self.assertEqual(snapshots.current, old)
        self.assertEqual(snapshots.objects, [])
        self.assertEqual(snapshots.pointer_updates, [])

    def test_raw_body_in_any_stage_is_rejected_without_pointer_change(self) -> None:
        snapshots = FakeSnapshots({"snapshotId": "previous"})
        fakes = FakeAdapters(snapshots)

        class UnsafeCollection:
            def collect(
                self, request: OrchestrationRequest, *, idempotency_key: str
            ) -> Mapping[str, Any]:
                return {"articleCount": 1, "body_text": "비공개 본문"}

        adapters = fakes.pipeline()
        adapters = PipelineAdapters(
            UnsafeCollection(),
            adapters.persistence,
            adapters.cluster_rank,
            adapters.semantic,
            snapshots,
        )
        result = GcpPipelineOrchestrator(adapters, idempotency=InMemoryIdempotencyStore()).run(
            request()
        )
        self.assertEqual(result.status, "failed")
        self.assertEqual(snapshots.current, {"snapshotId": "previous"})
        self.assertEqual(snapshots.objects, [])

    def test_quality_gate_rejects_locator_without_sentence_hash(self) -> None:
        from backend.gcp_orchestration import QualityGateError, evaluate_quality_gate

        semantic = FakeAdapters(FakeSnapshots()).semantic
        semantic = dict(semantic)
        semantic["top5"] = [
            dict(
                issue,
                articles=[
                    {"articleId": "a", "evidence": {"locator": {"paragraph": 1, "sentence": 1}}}
                ],
            )
            for issue in semantic["top5"]
        ]
        with self.assertRaises(QualityGateError):
            evaluate_quality_gate(semantic)

    def test_quality_gate_rejects_sentence_hash_without_locator(self) -> None:
        from backend.gcp_orchestration import QualityGateError, evaluate_quality_gate

        semantic = FakeAdapters(FakeSnapshots()).semantic
        semantic = dict(semantic)
        semantic["top5"] = [
            dict(issue, articles=[{"articleId": "a", "evidence": {"sentence_sha256": "a" * 64}}])
            for issue in semantic["top5"]
        ]
        with self.assertRaises(QualityGateError):
            evaluate_quality_gate(semantic)


class CloudSqlSchemaContractTests(unittest.TestCase):
    def test_schema_has_metadata_lineage_active_pointer_and_no_body_columns(self) -> None:
        path = ROOT / "infra" / "gcp" / "cloud-sql-schema.sql"
        schema = path.read_text(encoding="utf-8")
        for table in (
            "collection_runs",
            "article_metadata",
            "issue_candidates",
            "issue_articles",
            "semantic_profiles",
            "quality_gate_results",
            "public_snapshots",
            "snapshot_objects",
            "active_snapshot_pointer",
        ):
            self.assertRegex(schema, rf"CREATE TABLE IF NOT EXISTS {table}")
        self.assertIn("body_sha256", schema)
        self.assertIn("private_body_object", schema)
        self.assertIn("2026-10-31", schema)
        self.assertIn("status = 'published'", schema)
        for forbidden in (
            "body_text TEXT",
            "raw_body TEXT",
            "sentence_text TEXT",
            "evidence_text TEXT",
        ):
            self.assertNotIn(forbidden, schema)

    def test_schema_public_json_checks_reject_forbidden_body_fields(self) -> None:
        schema = (ROOT / "infra" / "gcp" / "cloud-sql-schema.sql").read_text(encoding="utf-8")
        self.assertGreaterEqual(schema.count("public_json::TEXT NOT ILIKE"), 1)
        self.assertGreaterEqual(schema.count("public_profile::TEXT NOT ILIKE"), 1)
        self.assertIn("pointer_id SMALLINT PRIMARY KEY CHECK (pointer_id = 1)", schema)


if __name__ == "__main__":
    unittest.main()
