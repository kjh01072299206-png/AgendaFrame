from __future__ import annotations

import json
import unittest
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping, Sequence

from ai.framing import FRAME_DIMENSIONS, FrameResult
from ai.issue_clustering import MetadataIssueGroup
from backend.gcp_orchestration import assert_body_safe, evaluate_quality_gate
from backend.gcp_stage_adapters import (
    FrameSemanticAdapter,
    GcpAnalysisStoreMetadataSink,
    MetadataClusterRankAdapter,
    MetadataPersistenceAdapter,
    PolicyCollectionAdapter,
    SnapshotPublishAdapter,
    StageAdapterError,
    StageDependencies,
)
from crawler.models import ArticleDocument

ROOT = Path(__file__).resolve().parents[2]
POLICY = ROOT / "site" / "data" / "discovery-sources.json"
COLLECTED_AT = datetime(2026, 8, 13, 0, 0, tzinfo=timezone.utc)


def article(source_id: str, index: int, domain: str | None = None) -> ArticleDocument:
    domain = domain or {
        "khan": "khan.co.kr",
        "kbs": "kbs.co.kr",
    }.get(source_id, "example.com")
    return ArticleDocument(
        article_id=f"article-{index}",
        source_id=source_id,
        canonical_url=f"https://{domain}/article/{index}",
        title=f"Event {index}",
        published_at=COLLECTED_AT,
        collected_at=COLLECTED_AT,
        section="society",
        body_text=f"Event {index} was described by an official.",
        text_scope="authorized_transient_body",
    )


class Fetcher:
    def __init__(self) -> None:
        self.calls: list[str] = []

    def fetch(self, url: str, *, source_id: str) -> object:
        self.calls.append(url)
        return {"url": url, "source_id": source_id}


class Parser:
    def __init__(self) -> None:
        self.calls = 0

    def parse(self, response, *, source, endpoint_url, collected_at):
        self.calls += 1
        # One deterministic article per source; remaining endpoint responses
        # are empty. This exercises RSS/site parser injection without network.
        if endpoint_url != source.endpoint_urls[0]:
            return ()
        return (article(source.source_id, self.calls, source.domains[0]),)


class Vault:
    def __init__(self) -> None:
        self.rows: dict[tuple[str, str], ArticleDocument] = {}
        self.put_calls = 0

    def put(self, run_id: str, value: ArticleDocument) -> str:
        self.put_calls += 1
        self.rows[(run_id, value.article_id)] = value
        return f"gs://private/{run_id}/{value.article_id}"

    def get(self, run_id: str, article_id: str) -> ArticleDocument:
        return self.rows[(run_id, article_id)]


class Sink:
    def __init__(self) -> None:
        self.calls: list[tuple[str, int]] = []

    def persist_articles(self, run_id, articles, *, private_object_refs):
        self.calls.append((run_id, len(articles)))
        return {"metadataRows": len(articles), "bodyObjects": len(private_object_refs)}


class CandidateBuilder:
    def build(self, articles, *, basis_date):
        return tuple(
            MetadataIssueGroup(
                issue_id=f"candidate-{index}",
                issue_title=f"Candidate {index}",
                articles=(item,),
            )
            for index, item in enumerate(articles[:5], 1)
        )


class ClusteringResult:
    def __init__(self, articles: Sequence[Any]) -> None:
        self.clusters = [
            {
                "cluster_id": f"issue-{index}",
                "label": f"Issue {index}",
                "coherence": "high",
                "article_assignments": [
                    {"article_id": article.article_id, "relation": "same_event"}
                ],
            }
            for index, article in enumerate(articles[:5], 1)
        ]

    def as_dict(self):
        return {"clusters": list(self.clusters), "approval": {"body_free": True}}


class Clusterer:
    def analyze(self, articles, candidate_groups):
        return ClusteringResult(articles)


class PersistenceStore:
    def __init__(self) -> None:
        self.objects: dict[str, Mapping[str, Any]] = {}
        self.pointer: Mapping[str, Any] | None = None

    def persist_articles(self, run_id, articles, *, private_object_refs):
        return {"persisted": len(articles)}

    def put_immutable(self, objects):
        self.objects.update(objects)

    def read_current_pointer(self):
        return self.pointer

    def update_current_pointer(self, pointer):
        self.pointer = dict(pointer)

    def read_public_manifest(self, pointer):
        return self.objects[pointer["manifest"]]


class MetadataStoreFake:
    def __init__(self) -> None:
        self.rows = []

    def _insert_json(self, table, row, row_id):
        self.rows.append((table, row, row_id))


class FrameFake:
    def analyze(self, value: ArticleDocument) -> FrameResult:
        supported = {
            "dimension": "problem_definition",
            "status": "supported",
            "value": "공공 안전 문제로 설명됨",
            "voice_kind": "journalist_narration",
            "frame_family": "safety_harm",
            "evidence": [
                {
                    "article_id": value.article_id,
                    "start": 0,
                    "end": 8,
                    "text": value.body_text[:8],
                }
            ],
        }
        dimensions = tuple(
            supported
            if name == "problem_definition"
            else {
                "dimension": name,
                "status": "explicit_not_stated",
                "value": None,
                "evidence": [],
            }
            for name in sorted(FRAME_DIMENSIONS)
        )
        return FrameResult(
            article_id=value.article_id,
            decision="analyze",
            dimensions=dimensions,
            model_id="fake-gemini",
            prompt_version="test",
            schema_version=3,
            text_scope=value.text_scope,
            analyzed_character_count=len(value.body_text or ""),
            input_truncated=False,
        )


class GcpStageAdapterTests(unittest.TestCase):
    def setUp(self) -> None:
        self.fetcher = Fetcher()
        self.parser = Parser()
        self.vault = Vault()
        self.sink = Sink()
        self.store = PersistenceStore()
        self.dependencies = StageDependencies(
            policy_path=str(POLICY),
            fetcher=self.fetcher,
            parser=self.parser,
            vault=self.vault,
            persistence_sink=self.sink,
            candidate_builder=CandidateBuilder(),
            initial_five_clusterer=Clusterer(),
            frame_analyzer=FrameFake(),
            immutable_writer=self.store,
            pointer_store=self.store,
        )
        self.request = type(
            "Request",
            (),
            {
                "run_id": "run-1",
                "basis_date": "2026-08-13",
            },
        )()

    def test_policy_collection_uses_injected_fetcher_parser_and_no_body_output(self) -> None:
        adapter = PolicyCollectionAdapter(self.dependencies, clock=lambda: COLLECTED_AT)
        result = adapter.collect(self.request, idempotency_key="run-1:collect")
        self.assertEqual(result["sourceCount"], 12)
        self.assertEqual(len(result["sourceIds"]), 12)
        self.assertGreaterEqual(result["articleCount"], 5)
        self.assertEqual(self.vault.put_calls, result["articleCount"])
        self.assertNotIn("body_text", json.dumps(result))
        self.assertNotIn("raw_body", json.dumps(result))

    def test_collection_rejects_parser_output_outside_source_domain(self) -> None:
        class BadParser(Parser):
            def parse(self, response, *, source, endpoint_url, collected_at):
                return (article("khan", 99),) if source.source_id != "khan" else ()

        deps = StageDependencies(**{**self.dependencies.__dict__, "parser": BadParser()})
        adapter = PolicyCollectionAdapter(deps, clock=lambda: COLLECTED_AT)
        with self.assertRaises(StageAdapterError):
            adapter.collect(self.request, idempotency_key="bad")

    def test_persist_cluster_rank_and_semantic_produce_top5_evidence_contract(self) -> None:
        collected = PolicyCollectionAdapter(self.dependencies, clock=lambda: COLLECTED_AT).collect(
            self.request, idempotency_key="collect"
        )
        persisted = MetadataPersistenceAdapter(self.dependencies).persist(
            self.request, collected, idempotency_key="persist"
        )
        ranked = MetadataClusterRankAdapter(self.dependencies).cluster_rank(
            self.request, persisted, idempotency_key="rank"
        )
        self.assertEqual(len(ranked["top5"]), 5)
        semantic = FrameSemanticAdapter(self.dependencies).analyze_top5(
            self.request, ranked, idempotency_key="semantic"
        )
        self.assertEqual(len(semantic["top5"]), 5)
        self.assertEqual(semantic["manifest"]["issueCount"], 5)
        bundle = semantic["bundles"]["issue-1"]
        for key in (
            "schemaVersion",
            "basisDate",
            "status",
            "issue",
            "analysisStatus",
            "clusterAi",
            "articles",
            "semanticProfiles",
            "ruleProfiles",
            "comparison",
            "lineage",
        ):
            self.assertIn(key, bundle)
        self.assertEqual(bundle["issue"]["issueId"], "issue-1")
        self.assertTrue(bundle["semanticProfiles"])
        assert_body_safe(bundle, context="public bundle")
        gate = evaluate_quality_gate(semantic)
        self.assertEqual(gate["status"], "pass")
        assert_body_safe(semantic, context="test semantic")
        self.assertNotIn("Event 1 was described", json.dumps(semantic, ensure_ascii=False))

    def test_publish_adapter_keeps_pointer_and_manifest_methods_injected(self) -> None:
        adapter = SnapshotPublishAdapter(self.store, self.store)
        object_payload = {"snapshots/test/manifest.json": {"schemaVersion": "test"}}
        adapter.put_immutable(object_payload)
        adapter.update_current_pointer({"snapshotId": "test"})
        self.assertEqual(adapter.read_current_pointer()["snapshotId"], "test")
        self.assertEqual(
            adapter.read_public_manifest({"manifest": "snapshots/test/manifest.json"}),
            object_payload["snapshots/test/manifest.json"],
        )

    def test_existing_gcp_analysis_store_bridge_writes_metadata_only(self) -> None:
        store = MetadataStoreFake()
        sink = GcpAnalysisStoreMetadataSink(store)
        result = sink.persist_articles(
            "run-1",
            [article("khan", 1)],
            private_object_refs={"article-1": "gs://private/run-1/article-1"},
        )
        self.assertEqual(result["metadataRows"], 1)
        self.assertEqual(store.rows[0][0], "articles")
        self.assertNotIn("body_text", store.rows[0][1])
        self.assertNotIn("raw_body", store.rows[0][1])
        self.assertEqual(store.rows[0][1]["body_object"], "gs://private/run-1/article-1")


if __name__ == "__main__":
    unittest.main()
