from __future__ import annotations

import hashlib
import json
import unittest
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping, Sequence

from ai.event_synthesis import EventSynthesisError
from ai.framing import FRAME_DIMENSIONS, FrameResult
from ai.issue_clustering import MetadataIssueGroup
from backend.gcp_job_entrypoint import RuntimeAdapterUnavailable
from backend.gcp_orchestration import QualityGateError, assert_body_safe, evaluate_quality_gate
from backend.gcp_stage_adapters import (
    ArchivedArticleReplayAdapter,
    ArchivedReplayVault,
    FrameSemanticAdapter,
    GcpAnalysisStoreMetadataSink,
    MetadataClusterRankAdapter,
    MetadataPersistenceAdapter,
    PolicyCollectionAdapter,
    SnapshotPublishAdapter,
    StageAdapterError,
    StageDependencies,
    load_source_definitions,
)
from crawler.models import ArticleDocument

ROOT = Path(__file__).resolve().parents[2]
POLICY = ROOT / "site" / "data" / "discovery-sources.json"
COLLECTED_AT = datetime(2026, 8, 13, 0, 0, tzinfo=timezone.utc)


def invocation(model: str, prompt_version: str = "test") -> dict[str, Any]:
    return {
        "provider": "vertex_ai",
        "model": model,
        "prompt_version": prompt_version,
        "attempt": 1,
        "request_sha256": "a" * 64,
        "response_sha256": "b" * 64,
        "completed_at": "2026-08-13T00:00:00+00:00",
    }


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
        return tuple(
            article(source.source_id, self.calls * 10 + offset, source.domains[0])
            for offset in range(2)
        )


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
        self.clusters = []
        for index in range(5):
            members = articles[index * 3 : index * 3 + 3]
            self.clusters.append(
                {
                    "cluster_id": f"issue-{index + 1}",
                    "label": f"Issue {index + 1}",
                    "coherence": "high",
                    "article_assignments": [
                        {"article_id": article.article_id, "relation": "same_event"}
                        for article in members
                    ],
                }
            )
        self.analysis_state = "succeeded"
        self.fallback_reason = None

    def as_dict(self):
        return {
            "schema_version": "agendaframe.initial-five-cluster.v2",
            "prompt_version": "test",
            "analysis_state": self.analysis_state,
            "model": "fake-cluster",
            "invocation": invocation("fake-cluster"),
            "clusters": list(self.clusters),
            "approval": {"body_free": True, "status": "approved_same_event"},
            "engine": {
                "model": "fake-cluster",
                "prompt_version": "test",
                "schema_version": "agendaframe.initial-five-cluster.v2",
                "semantic_ai": True,
            },
        }


class Clusterer:
    def analyze(self, articles, candidate_groups, **kwargs):
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
            analysis_state="succeeded",
            invocation_receipt=invocation("fake-gemini"),
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
                "model_revision": "fake-gemini",
                "prompt_version": "test",
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

    def test_policy_collection_honors_global_cost_cap(self) -> None:
        adapter = PolicyCollectionAdapter(
            self.dependencies,
            clock=lambda: COLLECTED_AT,
            max_articles_per_run=1,
        )
        result = adapter.collect(self.request, idempotency_key="capped")
        self.assertEqual(result["articleCount"], 1)
        self.assertEqual(self.vault.put_calls, 1)

    def test_policy_collection_distributes_capped_rows_across_all_sources(self) -> None:
        class ManyParser(Parser):
            def parse(self, response, *, source, endpoint_url, collected_at):
                self.calls += 1
                if endpoint_url != source.endpoint_urls[0]:
                    return ()
                return tuple(
                    article(
                        source.source_id,
                        self.calls * 100 + index,
                        source.domains[0],
                    )
                    for index in range(20)
                )

        parser = ManyParser()
        deps = StageDependencies(**{**self.dependencies.__dict__, "parser": parser})
        adapter = PolicyCollectionAdapter(
            deps,
            clock=lambda: COLLECTED_AT,
            max_articles_per_run=12,
        )
        result = adapter.collect(self.request, idempotency_key="balanced")
        counts = result["sourceArticleCounts"]
        self.assertEqual(result["articleCount"], 12)
        self.assertEqual(len(counts), 12)
        self.assertTrue(all(count == 1 for count in counts.values()))

    def test_policy_collection_redistributes_unused_budget_to_available_sources(self) -> None:
        class SparseParser(Parser):
            def parse(self, response, *, source, endpoint_url, collected_at):
                if source.source_id not in {"khan", "donga"}:
                    return ()
                return tuple(
                    article(
                        source.source_id,
                        index + (100 if endpoint_url != source.endpoint_urls[0] else 0),
                        source.domains[0],
                    )
                    for index in range(20)
                )

        parser = SparseParser()
        deps = StageDependencies(**{**self.dependencies.__dict__, "parser": parser})
        adapter = PolicyCollectionAdapter(
            deps,
            clock=lambda: COLLECTED_AT,
            max_articles_per_run=20,
        )

        result = adapter.collect(self.request, idempotency_key="redistributed")

        self.assertEqual(result["articleCount"], 20)
        self.assertGreater(max(result["sourceArticleCounts"].values()), 2)

    def test_policy_collection_continues_after_source_local_fetch_failure(self) -> None:
        class FailingFetcher(Fetcher):
            def fetch(self, url: str, *, source_id: str) -> object:
                if source_id == "khan":
                    raise RuntimeAdapterUnavailable("network failure")
                return super().fetch(url, source_id=source_id)

        deps = StageDependencies(**{**self.dependencies.__dict__, "fetcher": FailingFetcher()})
        result = PolicyCollectionAdapter(deps, clock=lambda: COLLECTED_AT).collect(
            self.request,
            idempotency_key="source-local-failure",
        )
        self.assertEqual(result["sourceErrorCounts"]["khan"], 4)
        self.assertGreater(result["articleCount"], 0)

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
        self.assertEqual(bundle["articles"][0]["collectedAt"], COLLECTED_AT.isoformat())
        assert_body_safe(bundle, context="public bundle")
        gate = evaluate_quality_gate(semantic)
        self.assertEqual(gate["status"], "pass")
        assert_body_safe(semantic, context="test semantic")
        self.assertNotIn("Event 1 was described", json.dumps(semantic, ensure_ascii=False))
        self.assertIn(
            bundle["comparison"]["engine"]["source"],
            {"gcp:profile-event-composition", "gcp:public-profile-aggregation"},
        )
        self.assertIsNotNone(bundle["comparison"]["data"]["summary_30_seconds"])

    def test_human_reviewed_cluster_provenance_is_not_reported_as_ai(self) -> None:
        class HumanReviewedResult(ClusteringResult):
            def as_dict(self):
                payload = super().as_dict()
                payload["model"] = ""
                payload["prompt_version"] = "initial-five-2026-10-05-single-reviewer-v1"
                payload["invocation"] = None
                payload["approval"]["status"] = "human_reviewed_provisional"
                payload["engine"].update(
                    {
                        "model": "",
                        "prompt_version": payload["prompt_version"],
                        "semantic_ai": False,
                        "analysis_source": "human_review",
                        "review_status": "single_reviewer_provisional",
                        "review_artifact": "initial-five-2026-10-05-single-reviewer-v1",
                        "review_artifact_sha256": "c" * 64,
                        "reviewer_count": 1,
                    }
                )
                return payload

        class HumanReviewedClusterer(Clusterer):
            def analyze(self, articles, candidate_groups, **kwargs):
                return HumanReviewedResult(articles)

        deps = StageDependencies(
            **{
                **self.dependencies.__dict__,
                "initial_five_clusterer": HumanReviewedClusterer(),
            }
        )
        collected = PolicyCollectionAdapter(deps, clock=lambda: COLLECTED_AT).collect(
            self.request, idempotency_key="collect-human-review"
        )
        persisted = MetadataPersistenceAdapter(deps).persist(
            self.request, collected, idempotency_key="persist-human-review"
        )
        ranked = MetadataClusterRankAdapter(deps).cluster_rank(
            self.request, persisted, idempotency_key="rank-human-review"
        )
        semantic = FrameSemanticAdapter(deps).analyze_top5(
            self.request, ranked, idempotency_key="semantic-human-review"
        )

        issue = semantic["top5"][0]
        self.assertEqual(issue["clusterAi"]["analysisSource"], "human_review")
        self.assertEqual(issue["clusterAi"]["engineLabel"], "human_review")
        self.assertFalse(issue["clusterAi"]["semanticAi"])
        self.assertEqual(issue["clusterAi"]["reviewStatus"], "single_reviewer_provisional")
        self.assertIsNone(issue["clusterAi"]["invocation"])
        self.assertTrue(issue["semantic"]["semanticAi"])
        gate = evaluate_quality_gate(semantic)
        self.assertEqual(gate["status"], "pass")
        self.assertEqual(gate["provisionalHumanClusterCount"], 5)
        self.assertTrue(gate["clusterReviewRequired"])

        issue["clusterAi"]["reviewArtifactSha256"] = "invalid"
        with self.assertRaisesRegex(QualityGateError, "cluster engine is not verified AI"):
            evaluate_quality_gate(semantic)

    def test_cluster_rank_quarantines_when_model_returns_no_clusters(self) -> None:
        class EmptyClusters:
            clusters: list = []
            analysis_state = "review_needed"
            fallback_reason = "model_request_unavailable"

            def as_dict(self):
                return {
                    "clusters": [],
                    "analysis_state": "review_needed",
                    "fallback_reason": self.fallback_reason,
                    "approval": {"body_free": True, "status": "review_needed"},
                }

        class EmptyClusterer:
            def analyze(self, articles, candidate_groups, **kwargs):
                return EmptyClusters()

        collected = PolicyCollectionAdapter(
            self.dependencies, clock=lambda: COLLECTED_AT, max_articles_per_run=12
        ).collect(self.request, idempotency_key="collect-empty")
        persisted = MetadataPersistenceAdapter(self.dependencies).persist(
            self.request, collected, idempotency_key="persist-empty"
        )
        deps = StageDependencies(
            **{**self.dependencies.__dict__, "initial_five_clusterer": EmptyClusterer()}
        )
        with self.assertRaises(StageAdapterError):
            MetadataClusterRankAdapter(deps).cluster_rank(
                self.request, persisted, idempotency_key="rank-empty"
            )

    def test_cluster_rank_quarantines_when_model_returns_fewer_than_five_clusters(self) -> None:
        class ShortClusters:
            def __init__(self, articles):
                lead = articles[0]
                self.clusters = [
                    {
                        "cluster_id": "only-one",
                        "label": lead.title,
                        "article_assignments": [
                            {"article_id": article.article_id, "relation": "same_event"}
                            for article in articles
                        ],
                    }
                ]

            analysis_state = "succeeded"
            fallback_reason = None

            def as_dict(self):
                return {
                    "clusters": self.clusters,
                    "analysis_state": "succeeded",
                    "model": "fake-cluster",
                    "prompt_version": "test",
                    "invocation": invocation("fake-cluster"),
                    "approval": {"body_free": True, "status": "approved_same_event"},
                    "engine": {
                        "model": "fake-cluster",
                        "prompt_version": "test",
                        "schema_version": "agendaframe.initial-five-cluster.v2",
                        "semantic_ai": True,
                    },
                }

        class ShortClusterer:
            def analyze(self, articles, candidate_groups, **kwargs):
                return ShortClusters(articles)

        collected = PolicyCollectionAdapter(
            self.dependencies, clock=lambda: COLLECTED_AT, max_articles_per_run=12
        ).collect(self.request, idempotency_key="collect-short")
        persisted = MetadataPersistenceAdapter(self.dependencies).persist(
            self.request, collected, idempotency_key="persist-short"
        )
        deps = StageDependencies(
            **{**self.dependencies.__dict__, "initial_five_clusterer": ShortClusterer()}
        )
        with self.assertRaises(StageAdapterError):
            MetadataClusterRankAdapter(deps).cluster_rank(
                self.request, persisted, idempotency_key="rank-short"
            )

    def test_cluster_rank_does_not_create_remainder_singletons(self) -> None:
        collected = PolicyCollectionAdapter(
            self.dependencies, clock=lambda: COLLECTED_AT, max_articles_per_run=24
        ).collect(self.request, idempotency_key="collect-remain")
        persisted = MetadataPersistenceAdapter(self.dependencies).persist(
            self.request, collected, idempotency_key="persist-remain"
        )
        ranked = MetadataClusterRankAdapter(self.dependencies).cluster_rank(
            self.request, persisted, idempotency_key="rank-remain"
        )
        self.assertEqual(len(ranked["top5"]), 5)
        self.assertEqual(len(ranked["candidates"]), 5)
        self.assertFalse(any("remainder" in str(row["issueId"]) for row in ranked["candidates"]))

    def test_semantic_quarantines_when_vertex_returns_no_evidence(self) -> None:
        class ReviewNeededFrame:
            def analyze(self, value: ArticleDocument) -> FrameResult:
                return FrameResult(
                    article_id=value.article_id,
                    decision="review_needed",
                    dimensions=tuple(
                        {
                            "dimension": name,
                            "status": "explicit_not_stated",
                            "value": None,
                            "evidence": [],
                            "reason": "Vertex output failed validation.",
                        }
                        for name in sorted(FRAME_DIMENSIONS)
                    ),
                    model_id="fake-gemini",
                    prompt_version="test",
                    schema_version=3,
                    text_scope=value.text_scope,
                    analyzed_character_count=len(value.body_text or ""),
                    input_truncated=False,
                    analysis_state="review_needed",
                    fallback_reason="Vertex output failed validation.",
                )

        deps = StageDependencies(
            **{**self.dependencies.__dict__, "frame_analyzer": ReviewNeededFrame()}
        )
        collected = PolicyCollectionAdapter(deps, clock=lambda: COLLECTED_AT).collect(
            self.request, idempotency_key="collect-proof"
        )
        persisted = MetadataPersistenceAdapter(deps).persist(
            self.request, collected, idempotency_key="persist-proof"
        )
        ranked = MetadataClusterRankAdapter(deps).cluster_rank(
            self.request, persisted, idempotency_key="rank-proof"
        )
        with self.assertRaises(StageAdapterError):
            FrameSemanticAdapter(deps).analyze_top5(
                self.request, ranked, idempotency_key="semantic-proof"
            )

    def test_semantic_adapter_uses_bound_event_synthesis_when_injected(self) -> None:
        class SynthesisFake:
            def synthesize(self, request):
                cited_rows = []
                for entry in request["profiles"]:
                    evidence = entry["evidence"][0]
                    cited_rows.append(
                        {
                            "article_id": entry["articleId"],
                            "locator": evidence["locator"],
                            "sentence_sha256": evidence["sentenceSha256"],
                        }
                    )
                first = cited_rows[0]
                second = cited_rows[1]
                return {
                    "prompt_version": "event-synthesis-v2.2.0",
                    "schema_version": "agendaframe.event-synthesis.v2.2",
                    "event_paragraphs": [
                        {"text": "같은 사건을 여러 기사가 다뤘다", "evidence": [first]},
                        {
                            "text": "기사들은 사건의 경위를 서로 다른 위치에서 설명했다",
                            "evidence": [second],
                        },
                    ],
                    "terms": [
                        {
                            "term": "사건 쟁점",
                            "gloss": "기사들이 서로 다르게 설명한 핵심 질문",
                            "evidence": [first],
                        }
                    ],
                    "comparison_result": {
                        "status": "difference_confirmed",
                        "primary_dimension": "problem_definition",
                        "reason": "두 매체의 기자 서술에서 문제를 앞세운 방식이 달랐다",
                        "analyzed_article_ids": [first["article_id"], second["article_id"]],
                        "dimensions": [
                            {
                                "dimension": "problem_definition",
                                "label": "문제 정의",
                                "question": "무엇을 문제로 설명했나",
                                "status": "difference_confirmed",
                                "relation": "different_emphasis",
                                "points": [
                                    {
                                        "observation_id": "fixture-political-accountability",
                                        "headline": "정치적 책임을 먼저 묻는 설명",
                                        "summary": "대통령의 침묵과 책임 주체를 함께 짚었다",
                                        "text": "정치적 책임을 먼저 설명했다",
                                        "relation": "different_emphasis",
                                        "article_ids": [first["article_id"]],
                                        "voice_basis": {
                                            "kind": "journalist_narration",
                                            "label": "기자 서술 중심",
                                            "evidence": [first],
                                        },
                                        "evidence": [first],
                                    },
                                    {
                                        "observation_id": "fixture-institutional-process",
                                        "headline": "제도 작동을 앞세운 설명",
                                        "summary": "책임 공방보다 제도 변화의 절차를 설명했다",
                                        "text": "제도 작동을 먼저 설명했다",
                                        "relation": "different_emphasis",
                                        "article_ids": [second["article_id"]],
                                        "voice_basis": {
                                            "kind": "journalist_narration",
                                            "label": "기자 서술 중심",
                                            "evidence": [second],
                                        },
                                        "evidence": [second],
                                    },
                                ],
                            }
                        ],
                    },
                    "comparison_axis": {
                        "label": "정치 책임과 제도 설명",
                        "points": [
                            {"text": "정치 책임을 먼저 설명", "evidence": [first]},
                            {"text": "제도 작동을 먼저 설명", "evidence": [second]},
                        ],
                        "question": "무엇을 먼저 설명했나",
                        "evidence": [first, second],
                    },
                    "common_ground": {
                        "text": "원인 귀속은 공통으로 관측된다",
                        "status": "observed",
                        "evidence": cited_rows,
                    },
                    "camps": [
                        {
                            "name": "정치 책임",
                            "headline": "정치적 책임을 먼저 묻는 갈래",
                            "summary": "대통령 침묵을 문제로 둔다",
                            "decisive_difference": "제도 설명보다 책임 주체를 먼저 보인다",
                            "article_ids": [first["article_id"]],
                            "evidence": [first],
                            "headline_evidence": [first],
                            "summary_evidence": [first],
                            "decisive_difference_evidence": [first],
                            "voice_basis": {
                                "kind": "journalist_narration",
                                "label": "기자 서술 중심",
                                "evidence": [first],
                            },
                            "proof_rows": [
                                {
                                    "article_id": first["article_id"],
                                    "outlet": "khan",
                                    "dimension": "문제 정의",
                                    "public_paraphrase": "대통령 침묵을 문제로 설명했다",
                                    "evidence": [first],
                                }
                            ],
                        },
                        {
                            "name": "제도 설명",
                            "headline": "제도 작동을 먼저 보여 주는 갈래",
                            "summary": "제도 안전장치의 작동 방식을 먼저 설명한다",
                            "decisive_difference": "정치 공방보다 제도 변화를 먼저 보인다",
                            "article_ids": [second["article_id"]],
                            "evidence": [second],
                            "headline_evidence": [second],
                            "summary_evidence": [second],
                            "decisive_difference_evidence": [second],
                            "voice_basis": {
                                "kind": "source_attributed",
                                "label": "취재원 발언 중심",
                                "evidence": [second],
                            },
                            "proof_rows": [
                                {
                                    "article_id": second["article_id"],
                                    "outlet": "kbs",
                                    "dimension": "문제 정의",
                                    "public_paraphrase": "제도 안전장치를 문제로 설명했다",
                                    "evidence": [second],
                                }
                            ],
                        },
                    ],
                }

        deps = StageDependencies(
            **{**self.dependencies.__dict__, "event_synthesizer": SynthesisFake()}
        )
        collected = PolicyCollectionAdapter(deps, clock=lambda: COLLECTED_AT).collect(
            self.request, idempotency_key="collect-synth"
        )
        persisted = MetadataPersistenceAdapter(deps).persist(
            self.request, collected, idempotency_key="persist-synth"
        )
        ranked = MetadataClusterRankAdapter(deps).cluster_rank(
            self.request, persisted, idempotency_key="rank-synth"
        )
        semantic = FrameSemanticAdapter(deps).analyze_top5(
            self.request, ranked, idempotency_key="semantic-synth"
        )
        bundle = next(iter(semantic["bundles"].values()))
        self.assertEqual(bundle["comparison"]["engine"]["source"], "gcp:event-synthesis")
        self.assertTrue(bundle["comparison"]["engine"]["semanticAi"])
        self.assertIn(
            "무엇을 먼저 설명했나",
            bundle["comparison"]["data"]["summary_30_seconds"]["main_difference"],
        )
        self.assertTrue(bundle["comparison"]["data"]["synthesis"]["opposition"])
        self.assertEqual(len(bundle["comparison"]["data"]["synthesis"]["camps"]), 2)
        self.assertTrue(bundle["clusterAi"]["summary"])
        assert_body_safe(bundle, context="synthesized public bundle")

    def test_semantic_adapter_falls_back_once_after_direct_synthesis_failure(self) -> None:
        class FailingSynthesis:
            calls = 0

            def synthesize(self, _request):
                self.calls += 1
                raise EventSynthesisError("provider response could not be used")

        synthesizer = FailingSynthesis()
        deps = StageDependencies(**{**self.dependencies.__dict__, "event_synthesizer": synthesizer})
        collected = PolicyCollectionAdapter(deps, clock=lambda: COLLECTED_AT).collect(
            self.request, idempotency_key="collect-synth-fallback"
        )
        persisted = MetadataPersistenceAdapter(deps).persist(
            self.request, collected, idempotency_key="persist-synth-fallback"
        )
        ranked = MetadataClusterRankAdapter(deps).cluster_rank(
            self.request, persisted, idempotency_key="rank-synth-fallback"
        )

        semantic = FrameSemanticAdapter(deps).analyze_top5(
            self.request, ranked, idempotency_key="semantic-synth-fallback"
        )

        self.assertEqual(synthesizer.calls, 1)
        self.assertEqual(len(semantic["bundles"]), 5)
        for bundle in semantic["bundles"].values():
            self.assertTrue(bundle["analysisStatus"]["semantic"]["semanticAi"])
            self.assertFalse(bundle["comparison"]["engine"]["semanticAi"])
            self.assertIn(
                bundle["comparison"]["engine"]["source"],
                {"gcp:profile-event-composition", "gcp:public-profile-aggregation"},
            )
            self.assertEqual(len(bundle["semanticProfiles"]), 3)

        self.assertEqual(evaluate_quality_gate(semantic)["status"], "pass")

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

    def test_archived_replay_deduplicates_and_reads_body_on_demand(self) -> None:
        body = "보관된 기사 본문이며 해시가 일치한다."
        body_hash = hashlib.sha256(body.encode("utf-8")).hexdigest()
        article_a = "a" * 32
        article_b = "b" * 32
        article_c = "c" * 32
        ref_a = f"gs://private/bodies/hankookilbo/2026/10/05/{article_a}.txt"
        ref_b = f"gs://private/bodies/hankookilbo/2026/10/05/{article_b}.txt"
        ref_c = f"gs://private/bodies/hankookilbo/2026/10/05/{article_c}/{'c' * 64}.txt"
        rows = [
            {
                "article_id": article_a,
                "source_id": "hankookilbo",
                "canonical_url": "https://www.hankookilbo.com/news/article/A2026100513220004301?dtypecode=politics",
                "title": "헤드라인 &quot;인용&quot;",
                "published_at": datetime(2026, 10, 5, 5, 15, tzinfo=timezone.utc),
                "collected_at": datetime(2026, 10, 5, 6, 0, tzinfo=timezone.utc),
                "section": "politics",
                "body_hash": body_hash,
                "body_object": ref_a,
                "text_scope": "authorized_transient_body",
            },
            {
                "article_id": article_b,
                "source_id": "hankookilbo",
                "canonical_url": "https://www.hankookilbo.com/news/article/A2026100513220004301?dtypecode=society",
                "title": "헤드라인 &quot;인용&quot;",
                "published_at": datetime(2026, 10, 5, 5, 15, tzinfo=timezone.utc),
                "collected_at": datetime(2026, 10, 5, 9, 0, tzinfo=timezone.utc),
                "section": "politics",
                "body_hash": body_hash,
                "body_object": ref_b,
                "text_scope": "authorized_transient_body",
            },
            {
                "article_id": article_c,
                "source_id": "hankookilbo",
                "canonical_url": "https://www.hankookilbo.com/news/article/A2026100513220004301?dtypecode=politics",
                "title": "헤드라인 &quot;인용&quot;",
                "published_at": datetime(2026, 10, 5, 5, 15, tzinfo=timezone.utc),
                "collected_at": datetime(2026, 10, 6, 1, 0, tzinfo=timezone.utc),
                "section": "politics",
                "body_hash": body_hash,
                "body_object": ref_c,
                "text_scope": "authorized_transient_body",
            },
        ]

        class QueryJob:
            def result(self):
                return rows

        class FakeBigQuery:
            def query(self, query, *, job_config):
                self.query_text = query
                self.config = job_config
                return QueryJob()

        class FakeBlob:
            def download_as_text(self, *, encoding):
                self.encoding = encoding
                return body

        class FakeBucket:
            name = "private"

            def blob(self, object_name):
                self.object_name = object_name
                return FakeBlob()

        class FakeStorage:
            def bucket(self, bucket_name):
                self.bucket_name = bucket_name
                return FakeBucket()

        vault = ArchivedReplayVault(FakeStorage(), bucket_name="private")
        bigquery = FakeBigQuery()
        adapter = ArchivedArticleReplayAdapter(
            bigquery_client=bigquery,
            query_config_factory=lambda basis_date, collection_end_date, article_ids, maximum_bytes_billed: {
                "basis_date": basis_date,
                "collection_end_date": collection_end_date,
                "article_ids": article_ids,
                "maximum_bytes_billed": maximum_bytes_billed,
            },
            vault=vault,
            project_id="project-40bc06fc-fb4b-46b6-a10",
            dataset="agendaframe",
            maximum_bytes_billed=1_073_741_824,
            basis_date="2026-10-05",
            collected_through_date="2026-10-06",
            reviewed_article_ids=[article_c],
            source_definitions=load_source_definitions(str(POLICY)),
        )
        request = type("Request", (), {"run_id": "replay", "basis_date": "2026-10-05"})()

        collected = adapter.collect(request, idempotency_key="replay:collect")
        persisted = adapter.persist(request, collected, idempotency_key="replay:persist")

        self.assertEqual(collected["articleCount"], 1)
        self.assertIn("@basis_date", bigquery.query_text)
        self.assertIn("@collection_end_date", bigquery.query_text)
        self.assertIn("@article_ids", bigquery.query_text)
        self.assertEqual(bigquery.config["collection_end_date"], "2026-10-06")
        self.assertEqual(bigquery.config["article_ids"], (article_c,))
        self.assertEqual(collected["articles"][0]["articleId"], article_c)
        self.assertEqual(collected["articles"][0]["collectedAt"], "2026-10-06T01:00:00+00:00")
        self.assertEqual(collected["articles"][0]["title"], '헤드라인 "인용"')
        self.assertEqual(
            collected["articles"][0]["canonicalUrl"],
            "https://www.hankookilbo.com/news/article/A2026100513220004301",
        )
        self.assertEqual(persisted["persistedArticleCount"], 1)
        self.assertNotIn(body, json.dumps(collected, ensure_ascii=False))
        self.assertNotIn(body, json.dumps(persisted, ensure_ascii=False))
        self.assertEqual(vault.get("replay", article_c).body_text, body)

    def test_archived_replay_collection_window_cannot_exceed_three_calendar_days(self) -> None:
        with self.assertRaisesRegex(StageAdapterError, "bounded to three days"):
            ArchivedArticleReplayAdapter(
                bigquery_client=object(),
                query_config_factory=lambda *_: {},
                vault=object(),
                project_id="project-40bc06fc-fb4b-46b6-a10",
                dataset="agendaframe",
                maximum_bytes_billed=1_073_741_824,
                basis_date="2026-10-05",
                collected_through_date="2026-10-08",
                source_definitions=load_source_definitions(str(POLICY)),
            )


if __name__ == "__main__":
    unittest.main()
