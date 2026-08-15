from __future__ import annotations

import json
import unittest
from dataclasses import replace
from datetime import UTC, datetime
from pathlib import Path
from unittest.mock import patch

from ai.framing import (
    FRAME_DIMENSIONS,
    FRAME_FAMILIES,
    FrameResult,
    VertexFrameAnalyzer,
    _align_payload_evidence,
    validate_frame_result,
)
from backend.config import RuntimeConfig, resolve_max_articles_per_run
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
        self.assertEqual(self.config.vertex.prompt_version, "2.6.0")

    def test_canary_env_can_lower_but_not_raise_articles_per_run(self) -> None:
        configured = self.config.vertex.max_articles_per_run
        self.assertEqual(resolve_max_articles_per_run(configured, {}), configured)
        self.assertEqual(
            resolve_max_articles_per_run(configured, {"AGENDAFRAME_MAX_ARTICLES_PER_RUN": "12"}),
            12,
        )
        lowered = RuntimeConfig.from_yaml(
            ROOT / "config" / "gcp-runtime.yaml",
            env={"AGENDAFRAME_MAX_ARTICLES_PER_RUN": "12"},
        )
        self.assertEqual(lowered.vertex.max_articles_per_run, 12)
        with self.assertRaises(ValueError):
            resolve_max_articles_per_run(configured, {"AGENDAFRAME_MAX_ARTICLES_PER_RUN": "0"})
        with self.assertRaises(ValueError):
            resolve_max_articles_per_run(configured, {"AGENDAFRAME_MAX_ARTICLES_PER_RUN": "51"})
        with self.assertRaises(ValueError):
            resolve_max_articles_per_run(configured, {"AGENDAFRAME_MAX_ARTICLES_PER_RUN": "all"})

    def test_response_schema_constrains_voice_kinds(self) -> None:
        from ai.framing import _response_schema

        schema = _response_schema()
        dimension_voice = schema["properties"]["dimensions"]["items"]["properties"]["voice_kind"]
        actor_voice = schema["properties"]["actors"]["items"]["properties"]["voice_kind"]
        self.assertEqual(
            set(dimension_voice["enum"]),
            {"journalist_narration", "direct_quote", "indirect_source", "uncertain_quote", None},
        )
        self.assertEqual(
            set(actor_voice["enum"]),
            {"direct_quote", "indirect_source", "uncertain_quote"},
        )
        self.assertEqual(self.config.vertex.schema_version, 3)
        self.assertIn("structured_context", schema["properties"])
        self.assertIn("framing_devices", schema["properties"]["structured_context"]["properties"])

    def test_structured_context_requires_evidence_for_observed_codes(self) -> None:
        value = article()
        result = supported_result(value)
        context = {
            "scope": {"code": "thematic", "evidence": []},
        }
        with self.assertRaisesRegex(ValueError, "Supported observations require evidence"):
            validate_frame_result(value, replace(result, structured_context=context))

    def test_structured_context_unknown_is_not_presented_as_observed(self) -> None:
        value = article()
        result = supported_result(value)
        context = {
            "scope": {"code": "unknown", "evidence": []},
            "context_depth": {"code": "unknown", "evidence": []},
            "generic_frames": [],
            "policy_frames": [],
            "framing_devices": [],
        }
        validate_frame_result(value, replace(result, structured_context=context))
        published = publication_row(value, replace(result, structured_context=context))
        self.assertEqual(published["profile"]["scope"]["code"], "unknown")

    def test_structured_context_publication_preserves_only_validated_locators(self) -> None:
        value = article()
        result = supported_result(value)
        excerpt = "안전 대책"
        start = (value.body_text or "").index(excerpt)
        span = {
            "article_id": value.article_id,
            "start": start,
            "end": start + len(excerpt),
            "text": excerpt,
        }
        context = {
            "genre": {"code": "straight_news", "label": "스트레이트", "evidence": [span]},
            "scope": {"code": "thematic", "label": "주제 중심", "evidence": [span]},
            "context_depth": {"code": "moderate", "label": "중간", "evidence": [span]},
            "generic_frames": [{"code": "responsibility", "label": "책임", "evidence": [span]}],
            "policy_frames": [],
            "framing_devices": [
                {
                    "code": "headline_emphasis",
                    "label": "제목 강조",
                    "appears_in_lead": True,
                    "evidence": [span],
                }
            ],
        }
        published = publication_row(value, replace(result, structured_context=context))
        profile = published["profile"]
        self.assertEqual(profile["scope"]["code"], "thematic")
        self.assertEqual(profile["context_depth"]["level"], "moderate")
        self.assertEqual(
            profile["secondary_descriptors"]["generic_frames"][0]["code"], "responsibility"
        )
        self.assertTrue(profile["framing_devices"][0]["appears_in_lead"])
        self.assertNotIn(value.body_text, json.dumps(published, ensure_ascii=False))

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
            guard.enforce_run(
                [self.config.vertex.max_input_characters_per_article] * 130,
                already_analyzed_today=0,
            )
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

    def test_model_evidence_whitespace_is_repaired_to_an_exact_source_slice(self) -> None:
        body = "첫 문장입니다.\n\n두  번째 문장입니다."
        payload = {
            "dimensions": [
                {
                    "evidence": [
                        {
                            "start": 0,
                            "end": 7,
                            "text": "두 번째 문장입니다.",
                        }
                    ]
                }
            ]
        }
        aligned = _align_payload_evidence("article-1", body, payload)
        span = aligned["dimensions"][0]["evidence"][0]
        self.assertEqual(span["text"], "두  번째 문장입니다.")
        self.assertEqual(body[span["start"] : span["end"]], span["text"])

    def test_vertex_malformed_output_becomes_review_needed_instead_of_aborting_batch(self) -> None:
        class FakeModels:
            def generate_content(self, **_kwargs):
                return type("Response", (), {"text": "not-json", "usage_metadata": None})()

        class FakeClient:
            models = FakeModels()

        with patch("google.genai.Client", return_value=FakeClient()):
            result = VertexFrameAnalyzer(self.config).analyze(article())

        self.assertEqual(result.decision, "review_needed")
        self.assertEqual(
            {dimension["dimension"] for dimension in result.dimensions},
            FRAME_DIMENSIONS,
        )
        self.assertTrue(
            all(dimension["status"] == "explicit_not_stated" for dimension in result.dimensions)
        )

    def test_vertex_output_validation_retries_and_can_recover(self) -> None:
        response_payload = {
            "decision": "analyze",
            "dimensions": [
                {
                    "dimension": dimension,
                    "status": "explicit_not_stated",
                    "value": None,
                    "frame_family": None,
                    "voice_kind": None,
                    "evidence": [],
                    "reason": "No direct evidence.",
                }
                for dimension in sorted(FRAME_DIMENSIONS)
            ],
            "actors": [],
        }
        observed_article = article()
        observed_text = (observed_article.body_text or "")[:10]
        observed_dimension = next(
            item
            for item in response_payload["dimensions"]
            if item["dimension"] == "problem_definition"
        )
        observed_dimension.update(
            {
                "status": "supported",
                "value": "기사에서 안전 문제를 관찰",
                "frame_family": "safety_harm",
                "voice_kind": "journalist_narration",
                "evidence": [
                    {
                        "article_id": observed_article.article_id,
                        "start": 0,
                        "end": len(observed_text),
                        "text": observed_text,
                    }
                ],
                "reason": None,
            }
        )

        class FakeModels:
            attempts = 0
            prompts: list[str] = []

            def generate_content(self, **kwargs):
                self.attempts += 1
                self.prompts.append(str(kwargs.get("contents", "")))
                if self.attempts == 1:
                    return type("Response", (), {"text": "not-json", "usage_metadata": None})()
                return type(
                    "Response",
                    (),
                    {"text": json.dumps(response_payload), "usage_metadata": None},
                )()

        models = FakeModels()

        class FakeClient:
            def __init__(self):
                self.models = models

        with patch("google.genai.Client", return_value=FakeClient()):
            result = VertexFrameAnalyzer(self.config).analyze(article())

        self.assertEqual(result.decision, "analyze")
        self.assertEqual(models.attempts, 2)
        self.assertIn("검증 오류", models.prompts[1])
        self.assertNotEqual(models.prompts[0], models.prompts[1])

    def test_vertex_non_retryable_failure_is_persistable_review_needed(self) -> None:
        class FakeModels:
            def generate_content(self, **_kwargs):
                raise PermissionError("permission denied")

        class FakeClient:
            models = FakeModels()

        with patch("google.genai.Client", return_value=FakeClient()):
            result = VertexFrameAnalyzer(self.config).analyze(article())

        self.assertEqual(result.decision, "review_needed")
        self.assertEqual(
            result.fallback_reason,
            "Vertex AI output failed validation (PermissionError); human review is required.",
        )
        payload = publication_row(article(), result)
        self.assertFalse(payload["profile"]["engine"]["semantic_ai"])
        self.assertEqual(payload["profile"]["engine"]["status"], "review_needed")
        self.assertEqual(payload["profile"]["review"]["fallback_reason"], result.fallback_reason)

    def test_vertex_transient_failure_retries_and_can_recover(self) -> None:
        response_payload = {
            "decision": "analyze",
            "dimensions": [
                {
                    "dimension": dimension,
                    "status": "explicit_not_stated",
                    "value": None,
                    "frame_family": None,
                    "voice_kind": None,
                    "evidence": [],
                    "reason": "직접 근거 없음",
                }
                for dimension in sorted(FRAME_DIMENSIONS)
            ],
            "actors": [],
        }
        observed_article = article()
        observed_text = (observed_article.body_text or "")[:10]
        observed_dimension = next(
            item
            for item in response_payload["dimensions"]
            if item["dimension"] == "problem_definition"
        )
        observed_dimension.update(
            {
                "status": "supported",
                "value": "기사에서 안전 문제를 관찰",
                "frame_family": "safety_harm",
                "voice_kind": "journalist_narration",
                "evidence": [
                    {
                        "article_id": observed_article.article_id,
                        "start": 0,
                        "end": len(observed_text),
                        "text": observed_text,
                    }
                ],
                "reason": None,
            }
        )

        class FakeModels:
            attempts = 0

            def generate_content(self, **_kwargs):
                self.attempts += 1
                if self.attempts == 1:
                    raise RuntimeError("503 Service Unavailable")
                return type(
                    "Response",
                    (),
                    {"text": json.dumps(response_payload), "usage_metadata": None},
                )()

        models = FakeModels()

        class FakeClient:
            def __init__(self):
                self.models = models

        with (
            patch("google.genai.Client", return_value=FakeClient()),
            patch("ai.framing.time.sleep") as sleep,
        ):
            result = VertexFrameAnalyzer(self.config).analyze(article())

        self.assertEqual(result.decision, "analyze")
        self.assertEqual(models.attempts, 2)
        sleep.assert_called_once_with(2.0)

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
        self.assertRegex(problem["items"][0]["claim_id"], r"^claim:[a-f0-9]{64}$")
        self.assertEqual(problem["model_status"], "supported")
        self.assertEqual(payload["profile"]["review"]["analysis_decision"], "analyze")
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

    def test_schema_three_preserves_frame_family_claim_and_role_only_sources(self) -> None:
        value = article('정부 관계자는 "안전 대책을 강화한다"고 말했다.')
        base = supported_result(value)
        dimensions = json.loads(json.dumps(base.dimensions))
        supported = next(
            dimension for dimension in dimensions if dimension["status"] == "supported"
        )
        supported["frame_family"] = "safety_harm"
        start = (value.body_text or "").index("안전 대책")
        result = replace(
            base,
            dimensions=tuple(dimensions),
            schema_version=3,
            actors=(
                {
                    "role": "government_official",
                    "voice_kind": "direct_quote",
                    "evidence": [
                        {
                            "article_id": value.article_id,
                            "start": start,
                            "end": start + len("안전 대책"),
                            "text": "안전 대책",
                        }
                    ],
                },
            ),
        )
        validate_frame_result(value, result)
        payload = publication_row(value, result)
        profile = payload["profile"]
        problem = profile["dimensions"]["problem_definition"]
        self.assertEqual(
            problem["items"][0]["variant_key"],
            "semantic:problem_definition:family:safety_harm",
        )
        self.assertEqual(problem["items"][0]["frame_family"], "safety_harm")
        self.assertRegex(problem["items"][0]["claim_id"], r"^claim:[a-f0-9]{64}$")
        self.assertEqual(problem["model_status"], "supported")
        self.assertEqual(profile["actors_and_sources"][0]["role"], "government_official")
        self.assertEqual(profile["actors_and_sources"][0]["role_label"], "정부·공공기관")
        self.assertEqual(profile["actors_and_sources"][0]["direct_quote_count"], 1)
        self.assertRegex(
            profile["actors_and_sources"][0]["evidence"][0]["sentence_sha256"],
            r"^[a-f0-9]{64}$",
        )
        serialized = json.dumps(payload, ensure_ascii=False)
        self.assertNotIn(value.body_text or "", serialized)
        self.assertNotIn("정부 관계자는", serialized)

    def test_schema_three_rejects_incompatible_frame_family(self) -> None:
        value = article()
        base = supported_result(value)
        dimensions = json.loads(json.dumps(base.dimensions))
        supported = next(
            dimension for dimension in dimensions if dimension["status"] == "supported"
        )
        supported["frame_family"] = "political_incentive"
        with self.assertRaisesRegex(ValueError, "valid frame family|incompatible"):
            validate_frame_result(
                value,
                replace(base, dimensions=tuple(dimensions), schema_version=3),
            )
        self.assertIn("safety_harm", FRAME_FAMILIES["problem_definition"])

    def test_invalid_config_schema_is_rejected(self) -> None:
        path = ROOT / "tests" / "fixtures" / "config" / "invalid-runtime.yaml"
        with self.assertRaises(ValueError):
            RuntimeConfig.from_yaml(path)


if __name__ == "__main__":
    unittest.main()
