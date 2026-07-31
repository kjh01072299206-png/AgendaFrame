from __future__ import annotations

import json
import unittest
from dataclasses import replace
from datetime import UTC, datetime
from pathlib import Path
from unittest.mock import patch

from ai.framing import (
    FRAME_DIMENSIONS,
    FrameResult,
    _align_payload_evidence,
    validate_frame_result,
)
from backend.config import RuntimeConfig
from backend.cost_guard import CostGuard, CostLimitExceeded
from backend.main import _validate_publication_rows_against_approval
from backend.memory_store import MemoryAnalysisStore
from backend.pipeline import BatchPipeline
from backend.publisher import StructuredPublisher, publication_row
from crawler.authorization import DatasetAnalysisAuthorization
from crawler.models import (
    ArticleDocument,
    RightsLevel,
    SourcePolicy,
    canonicalize_url,
)
from crawler.policy import SourcePolicyRegistry

ROOT = Path(__file__).resolve().parents[2]


def article(body: str | None = "정부는 안전 대책을 강화하겠다고 발표했다.") -> ArticleDocument:
    timestamp = datetime(2026, 7, 30, tzinfo=UTC)
    return ArticleDocument(
        article_id="article-1",
        source_id="fixture",
        canonical_url="https://news.example.invalid/article-1",
        title="정부, 안전 대책 발표",
        published_at=timestamp,
        collected_at=timestamp,
        section="사회",
        body_text=body,
        text_scope="synthetic_fixture",
    )


def supported_result(value: ArticleDocument) -> FrameResult:
    text = value.body_text or ""
    excerpt = "안전 대책"
    start = text.index(excerpt)
    dimensions = []
    for name in sorted(FRAME_DIMENSIONS):
        if name == "problem_definition":
            dimensions.append(
                {
                    "dimension": name,
                    "status": "supported",
                    "value": "안전 대책의 강화",
                    "voice_kind": "journalist_narration",
                    "evidence": [
                        {
                            "article_id": value.article_id,
                            "start": start,
                            "end": start + len(excerpt),
                            "text": excerpt,
                        }
                    ],
                    "reason": None,
                }
            )
        else:
            dimensions.append(
                {
                    "dimension": name,
                    "status": "explicit_not_stated",
                    "value": None,
                    "voice_kind": None,
                    "evidence": [],
                    "reason": "직접 근거 없음",
                }
            )
    return FrameResult(
        article_id=value.article_id,
        decision="analyze",
        dimensions=tuple(dimensions),
        model_id="fake-model",
        prompt_version="2.0.0",
        schema_version=2,
    )


class FakeAnalyzer:
    def analyze(self, value: ArticleDocument) -> FrameResult:
        return supported_result(value)


class CloudRuntimeTests(unittest.TestCase):
    def setUp(self) -> None:
        self.config = RuntimeConfig.from_yaml(ROOT / "config" / "gcp-runtime.yaml")

    def test_runtime_targets_only_reviewed_trial_project(self) -> None:
        self.assertEqual(self.config.project_id, "project-40bc06fc-fb4b-46b6-a10")
        self.assertEqual(self.config.region, "asia-northeast3")
        self.assertEqual(self.config.vertex.location, "global")
        self.assertEqual(self.config.vertex.model, "gemini-2.5-flash-lite")
        self.assertEqual(self.config.vertex.thinking_budget, 0)
        self.assertLessEqual(self.config.vertex.max_articles_per_run, 50)
        self.assertLessEqual(self.config.vertex.max_articles_per_day, 200)
        self.assertEqual(self.config.vertex.prompt_version, "2.2.0")

    def test_source_registry_defaults_all_real_sources_to_metadata_only(self) -> None:
        registry = SourcePolicyRegistry.from_yaml(ROOT / "config" / "source-policies.yaml")
        self.assertEqual(len(registry.all()), 22)
        self.assertFalse(any(policy.body_processing_allowed for policy in registry.all()))
        self.assertEqual(registry.require("hani").display_name, "한겨레")
        self.assertFalse(
            any("\ufffd" in policy.display_name for policy in registry.all()),
        )

    def test_url_normalization_removes_tracking_and_blocks_private_hosts(self) -> None:
        self.assertEqual(
            canonicalize_url("https://News.Example.com/a?utm_source=x&article=1#fragment"),
            "https://news.example.com/a?article=1",
        )
        with self.assertRaises(ValueError):
            canonicalize_url("http://news.example.com/a")
        with self.assertRaises(ValueError):
            canonicalize_url("https://127.0.0.1/article")

    def test_cost_guard_blocks_run_and_daily_caps_before_model_calls(self) -> None:
        guard = CostGuard(self.config)
        guard.enforce_run([1000] * 5, already_analyzed_today=0)
        with self.assertRaises(CostLimitExceeded):
            guard.enforce_run([1000] * 51, already_analyzed_today=0)
        with self.assertRaises(CostLimitExceeded):
            guard.enforce_run([1000] * 2, already_analyzed_today=199)

    def test_frame_evidence_must_be_exact_and_article_bound(self) -> None:
        value = article()
        result = supported_result(value)
        validate_frame_result(value, result)
        tampered = json.loads(json.dumps(result.dimensions))
        supported = next(dimension for dimension in tampered if dimension["status"] == "supported")
        supported["evidence"][0]["text"] = "존재하지 않는 문장"
        with self.assertRaises(ValueError):
            validate_frame_result(
                value,
                FrameResult(
                    article_id=value.article_id,
                    decision=result.decision,
                    dimensions=tuple(tampered),
                    model_id=result.model_id,
                    prompt_version=result.prompt_version,
                    schema_version=result.schema_version,
                ),
            )

    def test_model_evidence_offset_is_repaired_only_for_verbatim_text(self) -> None:
        body = "앞 문장이다. 정부는 안전 대책을 강화하겠다고 발표했다."
        payload = {
            "dimensions": [
                {
                    "evidence": [
                        {
                            "article_id": "wrong",
                            "start": 0,
                            "end": 2,
                            "text": "안전 대책",
                        }
                    ]
                }
            ]
        }
        aligned = _align_payload_evidence("article-1", body, payload)
        span = aligned["dimensions"][0]["evidence"][0]
        self.assertEqual(span["article_id"], "article-1")
        self.assertEqual(body[span["start"] : span["end"]], "안전 대책")
        with self.assertRaises(ValueError):
            _align_payload_evidence(
                "article-1",
                body,
                {"dimensions": [{"evidence": [{"text": "본문에 없는 표현"}]}]},
            )

    def test_pipeline_withholds_body_analysis_until_policy_allows_it(self) -> None:
        registry = SourcePolicyRegistry(
            {
                "fixture": SourcePolicy(
                    source_id="fixture",
                    display_name="Synthetic Fixture",
                    domains=("example.invalid",),
                    rights_level=RightsLevel.METADATA_ONLY,
                    permission_status="fixture",
                )
            },
            "fixture-v1",
        )
        store = MemoryAnalysisStore()
        result = BatchPipeline(
            self.config,
            registry,
            FakeAnalyzer(),
            store,
        ).run([article()])
        self.assertEqual(result["analyzed"], 0)
        self.assertEqual(result["deferred_by_policy"], 1)
        self.assertFalse(store.records)

    def test_pipeline_rejects_source_id_and_url_domain_mismatch(self) -> None:
        registry = SourcePolicyRegistry(
            {
                "fixture": SourcePolicy(
                    source_id="fixture",
                    display_name="Synthetic Fixture",
                    domains=("example.invalid",),
                    rights_level=RightsLevel.RETAINED_AUTHORIZED,
                    permission_status="fixture",
                    body_retention_until="2026-10-31",
                )
            },
            "fixture-v1",
        )
        mismatched = ArticleDocument(
            **{
                **article().__dict__,
                "canonical_url": "https://example.invalid.attacker.test/article-1",
            }
        )
        with self.assertRaisesRegex(ValueError, "domain does not match"):
            BatchPipeline(
                self.config,
                registry,
                FakeAnalyzer(),
                MemoryAnalysisStore(),
            ).run([mismatched])

    def test_hash_bound_dataset_authorization_allows_transient_analysis_only(self) -> None:
        value = article()
        authorization = DatasetAnalysisAuthorization.from_json_text(
            json.dumps(
                {
                    "schema_version": 3,
                    "authorization_id": "bigkinds-trial-20260726",
                    "cluster_id": "fixture-cluster",
                    "reviewed_by": "fixture-reviewer",
                    "reviewed_at": "2026-07-31T00:00:00+09:00",
                    "purpose": "transient_framing_analysis",
                    "text_scope": "provider_export",
                    "valid_until": "9999-12-31",
                    "retain_body": False,
                    "cluster_review_status": "approved_same_event",
                    "approved_articles": {
                        value.article_id: {
                            "source_id": value.source_id,
                            "canonical_url": value.canonical_url,
                            "published_date": "2026-07-30",
                            "body_sha256": value.body_hash,
                        },
                    },
                }
            )
        )
        provider_value = ArticleDocument(
            article_id=value.article_id,
            source_id=value.source_id,
            canonical_url=value.canonical_url,
            title=value.title,
            published_at=value.published_at,
            collected_at=value.collected_at,
            section=value.section,
            body_text=value.body_text,
            text_scope="provider_export",
        )
        registry = SourcePolicyRegistry(
            {
                "fixture": SourcePolicy(
                    source_id="fixture",
                    display_name="Synthetic Fixture",
                    domains=("example.invalid",),
                    rights_level=RightsLevel.METADATA_ONLY,
                    permission_status="fixture",
                )
            },
            "fixture-v1",
        )
        store = MemoryAnalysisStore()
        result = BatchPipeline(
            self.config,
            registry,
            FakeAnalyzer(),
            store,
            dataset_authorization=authorization,
        ).run([provider_value])
        self.assertEqual(result["analyzed"], 1)
        self.assertEqual(result["dataset_authorized"], 1)
        self.assertFalse(store.records[0].body_retained)
        self.assertEqual(
            store.records[0].result.approval_lineage,
            authorization.public_lineage(),
        )
        serialized = json.dumps(result, ensure_ascii=False)
        self.assertNotIn(provider_value.body_text or "", serialized)
        self.assertNotIn('"evidence"', serialized)
        self.assertNotIn('"dimensions"', serialized)

    def test_dataset_authorization_rejects_changed_body_or_unreviewed_cluster(self) -> None:
        value = article()
        payload = {
            "schema_version": 3,
            "authorization_id": "bigkinds-trial-20260726",
            "cluster_id": "fixture-cluster",
            "reviewed_by": "fixture-reviewer",
            "reviewed_at": "2026-07-31T00:00:00+09:00",
            "purpose": "transient_framing_analysis",
            "text_scope": "provider_export",
            "valid_until": "9999-12-31",
            "retain_body": False,
            "cluster_review_status": "approved_same_event",
            "approved_articles": {
                value.article_id: {
                    "source_id": value.source_id,
                    "canonical_url": value.canonical_url,
                    "published_date": "2026-07-30",
                    "body_sha256": "0" * 64,
                }
            },
        }
        authorization = DatasetAnalysisAuthorization.from_json_text(json.dumps(payload))
        provider_value = ArticleDocument(
            **{
                **value.__dict__,
                "text_scope": "provider_export",
            }
        )
        self.assertFalse(authorization.allows(provider_value))
        payload["approved_articles"][value.article_id]["body_sha256"] = value.body_hash
        payload["approved_articles"][value.article_id]["source_id"] = "another-source"
        misattributed = DatasetAnalysisAuthorization.from_json_text(json.dumps(payload))
        self.assertFalse(misattributed.allows(provider_value))
        payload["cluster_review_status"] = None
        unreviewed = DatasetAnalysisAuthorization.from_json_text(json.dumps(payload))
        self.assertFalse(unreviewed.allows(provider_value))

    def test_authorized_pipeline_deduplicates_and_marks_body_for_deletion(self) -> None:
        registry = SourcePolicyRegistry(
            {
                "fixture": SourcePolicy(
                    source_id="fixture",
                    display_name="Synthetic Fixture",
                    domains=("example.invalid",),
                    rights_level=RightsLevel.RETAINED_AUTHORIZED,
                    permission_status="synthetic_fixture",
                    body_retention_until="2026-10-31",
                )
            },
            "fixture-v1",
        )
        store = MemoryAnalysisStore()
        pipeline = BatchPipeline(self.config, registry, FakeAnalyzer(), store)
        self.assertEqual(pipeline.run([article()])["analyzed"], 1)
        self.assertEqual(pipeline.run([article()])["skipped_duplicate"], 1)
        self.assertTrue(store.records[0].body_retained)
        self.assertEqual(store.records[0].delete_on, "2026-10-31")

    def test_publication_payload_never_contains_article_body(self) -> None:
        value = article()
        payload = publication_row(value, supported_result(value))
        serialized = json.dumps(payload, ensure_ascii=False)
        self.assertNotIn(value.body_text or "", serialized)
        self.assertNotIn("body_text", serialized)
        self.assertNotIn('"start"', serialized)
        self.assertNotIn('"end"', serialized)
        self.assertNotIn('"text"', serialized)
        self.assertEqual(
            payload["profile"]["schema_version"],
            "agendaframe.article-frame-profile.v2",
        )
        self.assertTrue(payload["profile"]["engine"]["semantic_ai"])
        self.assertEqual(
            payload["profile"]["article"]["upstream_article_id"],
            value.article_id,
        )
        self.assertEqual(
            payload["profile"]["extraction"],
            {
                "text_scope": "synthetic_fixture",
                "analyzed_character_count": len(value.body_text or ""),
                "input_truncated": False,
            },
        )
        problem = payload["profile"]["dimensions"]["problem_definition"]
        self.assertRegex(problem["items"][0]["variant_key"], r"^semantic:problem_definition:")
        tampered = supported_result(value)
        tampered_dimensions = json.loads(json.dumps(tampered.dimensions))
        supported = next(
            dimension for dimension in tampered_dimensions if dimension["status"] == "supported"
        )
        supported["evidence"][0]["article_id"] = "different-article"
        with self.assertRaises(ValueError):
            publication_row(
                value,
                FrameResult(
                    article_id=tampered.article_id,
                    decision=tampered.decision,
                    dimensions=tuple(tampered_dimensions),
                    model_id=tampered.model_id,
                    prompt_version=tampered.prompt_version,
                    schema_version=tampered.schema_version,
                ),
            )

    def test_publication_rejects_long_verbatim_body_passages_and_values(self) -> None:
        copied_passage = (
            "정부는 안전 대책을 강화하고 지역별 대피 시설의 정기 점검 결과를 공개하겠다고 발표했다"
        )
        value = article(f"{copied_passage}. 후속 계획은 다음 달 공개한다.")
        result = supported_result(value)
        copied_dimensions = json.loads(json.dumps(result.dimensions))
        supported = next(
            dimension for dimension in copied_dimensions if dimension["status"] == "supported"
        )
        supported["value"] = copied_passage
        with self.assertRaisesRegex(ValueError, "long contiguous passages"):
            publication_row(
                value,
                replace(result, dimensions=tuple(copied_dimensions)),
            )

        oversized_dimensions = json.loads(json.dumps(result.dimensions))
        supported = next(
            dimension for dimension in oversized_dimensions if dimension["status"] == "supported"
        )
        supported["value"] = "독자적으로 재서술한 분석 설명 " * 20
        with self.assertRaisesRegex(ValueError, "no longer than"):
            publication_row(
                value,
                replace(result, dimensions=tuple(oversized_dimensions)),
            )

    def test_publication_preserves_provider_excerpt_and_truncation_scope(self) -> None:
        value = replace(
            article(
                "정부는 안전 대책을 강화하겠다고 발표했다. "
                "지역별 점검 결과와 후속 계획도 함께 공개했다."
            ),
            text_scope="provider_excerpt",
        )
        analyzed_character_count = len("정부는 안전 대책을 강화하겠다고 발표했다.")
        result = replace(
            supported_result(value),
            text_scope=value.text_scope,
            analyzed_character_count=analyzed_character_count,
            input_truncated=True,
        )
        payload = publication_row(value, result)
        self.assertEqual(
            payload["profile"]["extraction"],
            {
                "text_scope": "provider_excerpt",
                "analyzed_character_count": analyzed_character_count,
                "input_truncated": True,
            },
        )

    def test_structured_publisher_separates_import_and_reviewed_analysis_requests(self) -> None:
        captured = []

        class FakeResponse:
            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return None

            def read(self):
                return b'{"ok": true}'

        def fake_urlopen(request, timeout):
            captured.append(
                {
                    "url": request.full_url,
                    "headers": dict(request.header_items()),
                    "payload": json.loads(request.data.decode("utf-8")),
                    "timeout": timeout,
                }
            )
            return FakeResponse()

        publisher = StructuredPublisher(
            "https://agendaframe.example",
            "/api/import/analyzed",
            "secret",
        )
        with patch("backend.publisher.urlopen", side_effect=fake_urlopen):
            publisher.publish([{"article": {"article_id": "a-1"}, "profile": {}}])
            publisher.analyze(
                "2026-07-26",
                approved_same_event_clusters=[
                    {
                        "cluster_id": "fixture-cluster",
                        "authorization_id": "fixture-authorization",
                        "fingerprint": "a" * 64,
                        "reviewer": "fixture-reviewer",
                        "reviewed_at": "2026-07-31T00:00:00+09:00",
                        "approved_urls_sha256": "b" * 64,
                        "approved_urls": ["https://news.example/a", "https://news.example/b"],
                    }
                ],
            )

        self.assertEqual(captured[0]["url"], "https://agendaframe.example/api/import/analyzed")
        self.assertEqual(
            captured[0]["headers"]["X-agendaframe-source"],
            "gcp-batch-v1",
        )
        self.assertEqual(captured[1]["url"], "https://agendaframe.example/api/analyze")
        self.assertNotIn("X-agendaframe-source", captured[1]["headers"])
        self.assertEqual(captured[1]["payload"]["date"], "2026-07-26")
        self.assertEqual(
            len(captured[1]["payload"]["approved_same_event_clusters"][0]["approved_urls"]),
            2,
        )

    def test_publication_rows_must_match_the_exact_reviewed_cluster(self) -> None:
        approval = DatasetAnalysisAuthorization.from_path(
            ROOT / "config" / "analysis-approvals" / "2026-07-26-rank-1.json"
        )
        lineage = approval.public_lineage()
        rows = [
            {
                "article": {
                    "article_id": article_id,
                    "source_id": binding.source_id,
                    "canonical_url": binding.canonical_url,
                    "body_hash": binding.body_sha256,
                },
                "profile": {"lineage": {"approval": lineage}},
            }
            for article_id, binding in approval.approved_articles.items()
        ]
        _validate_publication_rows_against_approval(rows, approval)
        with self.assertRaisesRegex(ValueError, "approved article set"):
            _validate_publication_rows_against_approval(rows[:-1], approval)
        rows[0]["profile"] = {"lineage": {"approval": {**lineage, "cluster_id": "other"}}}
        with self.assertRaisesRegex(ValueError, "approved analysis lineage"):
            _validate_publication_rows_against_approval(rows, approval)

    def test_invalid_config_schema_is_rejected(self) -> None:
        path = ROOT / "tests" / "fixtures" / "config" / "invalid-runtime.yaml"
        with self.assertRaises(ValueError):
            RuntimeConfig.from_yaml(path)


if __name__ == "__main__":
    unittest.main()
