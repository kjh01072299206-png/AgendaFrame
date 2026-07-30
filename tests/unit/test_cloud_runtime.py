from __future__ import annotations

import json
import unittest
from datetime import UTC, datetime
from pathlib import Path

from ai.framing import FRAME_DIMENSIONS, FrameResult, validate_frame_result
from backend.config import RuntimeConfig
from backend.cost_guard import CostGuard, CostLimitExceeded
from backend.memory_store import MemoryAnalysisStore
from backend.pipeline import BatchPipeline
from backend.publisher import publication_row
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

    def test_invalid_config_schema_is_rejected(self) -> None:
        path = ROOT / "tests" / "fixtures" / "config" / "invalid-runtime.yaml"
        with self.assertRaises(ValueError):
            RuntimeConfig.from_yaml(path)


if __name__ == "__main__":
    unittest.main()
