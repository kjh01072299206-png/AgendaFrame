from __future__ import annotations

import json
import unittest
from dataclasses import replace
from datetime import UTC, datetime
from pathlib import Path
from unittest.mock import patch

from ai.framing import FRAME_DIMENSIONS, FrameResult, VertexFrameAnalyzer, validate_frame_result
from backend.analysis_state import AnalysisState, analysis_idempotency_fingerprint
from backend.config import RuntimeConfig
from backend.main import _read_articles
from backend.memory_store import MemoryAnalysisStore
from backend.pilot import load_pilot_approvals, validate_approval_articles, validate_pilot_articles
from backend.pipeline import BatchPipeline
from backend.publisher import publication_row
from crawler.authorization import DatasetAnalysisAuthorization
from crawler.models import ArticleDocument, RightsLevel, SourcePolicy
from crawler.policy import SourcePolicyRegistry

ROOT = Path(__file__).resolve().parents[2]


def make_article(
    body: str = "정부는 안전 대책을 강화하겠다고 발표했다. 계획은 내일 시작된다.",
) -> ArticleDocument:
    timestamp = datetime(2026, 7, 26, 12, 0, tzinfo=UTC)
    return ArticleDocument(
        article_id="pilot-article-1",
        source_id="fixture",
        canonical_url="https://news.example.invalid/pilot-article-1",
        title="안전 대책 발표",
        published_at=timestamp,
        collected_at=timestamp,
        section="사회",
        body_text=body,
        text_scope="provider_export",
    )


def supported_dimensions(article: ArticleDocument) -> tuple[dict[str, object], ...]:
    body = article.body_text or ""
    excerpt = body.split(".", 1)[0] + "."
    dimensions: list[dict[str, object]] = []
    for name in sorted(FRAME_DIMENSIONS):
        if name == "problem_definition":
            dimensions.append(
                {
                    "dimension": name,
                    "status": "supported",
                    "value": "기사에서 안전 문제를 제시",
                    "frame_family": "safety_harm",
                    "voice_kind": "journalist_narration",
                    "evidence": [
                        {
                            "article_id": article.article_id,
                            "start": 0,
                            "end": len(excerpt),
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
                    "frame_family": None,
                    "voice_kind": None,
                    "evidence": [],
                    "reason": "직접 근거 없음",
                }
            )
    return tuple(dimensions)


def model_payload(article: ArticleDocument, *, observed: bool = True) -> dict[str, object]:
    if observed:
        dimensions = supported_dimensions(article)
    else:
        dimensions = tuple(
            {
                "dimension": name,
                "status": "explicit_not_stated",
                "value": None,
                "frame_family": None,
                "voice_kind": None,
                "evidence": [],
                "reason": "직접 근거 없음",
            }
            for name in sorted(FRAME_DIMENSIONS)
        )
    return {"decision": "analyze", "dimensions": dimensions, "actors": []}


class FakeResponse:
    def __init__(self, payload: object) -> None:
        self.text = payload if isinstance(payload, str) else json.dumps(payload, ensure_ascii=False)
        self.usage_metadata = None


class FakeModels:
    def __init__(self, responses: list[object]) -> None:
        self.responses = list(responses)
        self.attempts = 0

    def generate_content(self, **_kwargs: object) -> FakeResponse:
        self.attempts += 1
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return FakeResponse(response)


class FakeClient:
    def __init__(self, models: FakeModels) -> None:
        self.models = models


class PilotAnalysisTests(unittest.TestCase):
    def setUp(self) -> None:
        self.config = RuntimeConfig.from_yaml(ROOT / "config" / "gcp-runtime.yaml")

    def run_analyzer(self, responses: list[object]) -> tuple[FrameResult, FakeModels]:
        value = make_article()
        models = FakeModels(responses)
        with patch("google.genai.Client", return_value=FakeClient(models)):
            result = VertexFrameAnalyzer(self.config).analyze(value)
        return result, models

    def test_analyze_rejects_all_dimensions_unobserved(self) -> None:
        value = make_article()
        result = FrameResult(
            article_id=value.article_id,
            decision="analyze",
            dimensions=model_payload(value, observed=False)["dimensions"],
            model_id="fake-model",
            prompt_version="test",
            schema_version=3,
        )
        with self.assertRaisesRegex(ValueError, "at least one supported"):
            validate_frame_result(value, result)

        fallback, models = self.run_analyzer(
            [model_payload(value, observed=False) for _ in range(3)]
        )
        self.assertEqual(fallback.decision, "review_needed")
        self.assertEqual(fallback.analysis_state, AnalysisState.REVIEW_NEEDED.value)
        self.assertEqual(fallback.error_code, "all_dimensions_unobserved")
        self.assertEqual(fallback.attempt_count, 3)
        self.assertEqual(models.attempts, 3)

    def test_malformed_json_retries_and_publishes_only_recovered_success(self) -> None:
        value = make_article()
        models = FakeModels(["not-json", model_payload(value)])
        with (
            patch("google.genai.Client", return_value=FakeClient(models)),
            patch("ai.framing.time.sleep") as sleep,
        ):
            result = VertexFrameAnalyzer(self.config).analyze(value)
        self.assertEqual(result.decision, "analyze")
        self.assertEqual(result.analysis_state, AnalysisState.SUCCEEDED.value)
        self.assertEqual(result.attempt_count, 2)
        self.assertEqual(models.attempts, 2)
        sleep.assert_not_called()
        self.assertTrue(publication_row(value, result)["profile"]["engine"]["semantic_ai"])

    def test_429_retries_with_bounded_backoff_and_recovers(self) -> None:
        transient = RuntimeError("429 too many requests")
        transient.status_code = 429  # type: ignore[attr-defined]
        value = make_article()
        models = FakeModels([transient, model_payload(value)])
        with (
            patch("google.genai.Client", return_value=FakeClient(models)),
            patch("ai.framing.time.sleep") as sleep,
        ):
            result = VertexFrameAnalyzer(self.config).analyze(value)
        self.assertEqual(result.decision, "analyze")
        self.assertEqual(result.attempt_count, 2)
        sleep.assert_called_once_with(2.0)

    def test_503_retries_at_most_three_calls_and_stays_non_ai(self) -> None:
        errors = []
        for _ in range(3):
            error = RuntimeError("503 Service Unavailable")
            error.status_code = 503  # type: ignore[attr-defined]
            errors.append(error)
        with patch("ai.framing.time.sleep") as sleep:
            result, models = self.run_analyzer(errors)
        self.assertEqual(result.decision, "review_needed")
        self.assertEqual(result.analysis_state, AnalysisState.REVIEW_NEEDED.value)
        self.assertTrue(result.retryable_failure)
        self.assertEqual(result.error_code, "vertex_http_503")
        self.assertEqual(result.attempt_count, 3)
        self.assertEqual(models.attempts, 3)
        self.assertEqual(sleep.call_count, 2)

    def test_idempotency_fingerprint_binds_body_model_schema_and_approval(self) -> None:
        value = make_article()
        base = analysis_idempotency_fingerprint(
            value,
            model_id="gemini-test",
            prompt_version="prompt-1",
            schema_version=3,
        )
        same = analysis_idempotency_fingerprint(
            value,
            model_id="gemini-test",
            prompt_version="prompt-1",
            schema_version=3,
        )
        approved = analysis_idempotency_fingerprint(
            value,
            model_id="gemini-test",
            prompt_version="prompt-1",
            schema_version=3,
            approval_lineage={"fingerprint": "approval-a"},
        )
        changed_body = analysis_idempotency_fingerprint(
            replace(value, body_text="다른 본문입니다."),
            model_id="gemini-test",
            prompt_version="prompt-1",
            schema_version=3,
        )
        self.assertEqual(base, same)
        self.assertNotEqual(base, approved)
        self.assertNotEqual(base, changed_body)
        self.assertRegex(base, r"^[0-9a-f]{64}$")

    def test_resume_redrives_only_failed_row_and_publishes_recovered_result(self) -> None:
        value = make_article()
        approval = DatasetAnalysisAuthorization.from_json_text(
            json.dumps(
                {
                    "schema_version": 3,
                    "authorization_id": "pilot-test",
                    "cluster_id": "pilot-test-cluster",
                    "reviewed_by": "test",
                    "reviewed_at": "2026-07-26T00:00:00+09:00",
                    "purpose": "transient_framing_analysis",
                    "text_scope": "provider_export",
                    "valid_until": "2026-10-31",
                    "retain_body": False,
                    "cluster_review_status": "approved_same_event",
                    "approved_articles": {
                        value.article_id: {
                            "source_id": value.source_id,
                            "canonical_url": value.canonical_url,
                            "published_date": "2026-07-26",
                            "body_sha256": value.body_hash,
                        }
                    },
                }
            )
        )
        registry = SourcePolicyRegistry(
            {
                "fixture": SourcePolicy(
                    source_id="fixture",
                    display_name="Fixture",
                    domains=("example.invalid",),
                    rights_level=RightsLevel.METADATA_ONLY,
                    permission_status="fixture",
                )
            },
            "test-policy",
        )
        fallback_dimensions = tuple(
            {
                "dimension": name,
                "status": "explicit_not_stated",
                "value": None,
                "voice_kind": None,
                "evidence": [],
                "reason": "temporary provider failure",
            }
            for name in sorted(FRAME_DIMENSIONS)
        )
        failed = FrameResult(
            article_id=value.article_id,
            decision="review_needed",
            dimensions=fallback_dimensions,
            model_id="fake-model",
            prompt_version=self.config.vertex.prompt_version,
            schema_version=3,
            fallback_reason="temporary failure",
            attempt_count=1,
            retryable_failure=True,
        )
        recovered = FrameResult(
            article_id=value.article_id,
            decision="analyze",
            dimensions=supported_dimensions(value),
            model_id="fake-model",
            prompt_version=self.config.vertex.prompt_version,
            schema_version=3,
            attempt_count=1,
        )

        class RetryAnalyzer:
            def __init__(self) -> None:
                self.results = [failed, recovered]

            def analyze(self, _article: ArticleDocument) -> FrameResult:
                return self.results.pop(0)

        store = MemoryAnalysisStore()
        pipeline = BatchPipeline(
            self.config,
            registry,
            RetryAnalyzer(),
            store,
            dataset_authorization=approval,
        )
        first = pipeline.run([value])
        self.assertEqual(first["analyzed"], 1)
        self.assertEqual(store.records[0].analysis_state, AnalysisState.RETRY_WAIT)
        self.assertFalse(
            publication_row(value, store.records[0].result)["profile"]["engine"]["semantic_ai"]
        )

        second = pipeline.run([value], resume=True)
        self.assertEqual(second["redriven"], 1)
        self.assertEqual(store.records[0].analysis_state, AnalysisState.SUCCEEDED)
        self.assertEqual(store.records[0].attempt_count, 2)
        self.assertTrue(
            publication_row(value, store.records[0].result)["profile"]["engine"]["semantic_ai"]
        )

    def test_preflight_rejects_body_hash_drift_before_model_call(self) -> None:
        value = make_article()
        payload = {
            "schema_version": 3,
            "authorization_id": "pilot-test",
            "cluster_id": "pilot-test-cluster",
            "reviewed_by": "test",
            "reviewed_at": "2026-07-26T00:00:00+09:00",
            "purpose": "transient_framing_analysis",
            "text_scope": "provider_export",
            "valid_until": "2026-10-31",
            "retain_body": False,
            "cluster_review_status": "approved_same_event",
            "approved_articles": {
                value.article_id: {
                    "source_id": value.source_id,
                    "canonical_url": value.canonical_url,
                    "published_date": "2026-07-26",
                    "body_sha256": "0" * 64,
                }
            },
        }
        authorization = DatasetAnalysisAuthorization.from_json_text(json.dumps(payload))
        with self.assertRaisesRegex(ValueError, "source, URL, date, or body hash"):
            validate_approval_articles([value], authorization)

    def test_tracked_pilot_manifests_match_prepared_input_when_fixture_is_available(self) -> None:
        prepared = ROOT / "tmp" / "initial-five-prepared"
        input_path = prepared / "articles.jsonl"
        authorization_paths = [
            prepared / f"rank-{rank}" / "authorization.json" for rank in range(1, 6)
        ]
        if not input_path.is_file() or not all(path.is_file() for path in authorization_paths):
            self.skipTest("prepared pilot input is not present in this checkout")
        approvals = load_pilot_approvals(ROOT / "config" / "analysis-approvals")
        for rank, approval, authorization_path in zip(
            range(1, 6), approvals, authorization_paths, strict=True
        ):
            prepared_authorization = json.loads(authorization_path.read_text(encoding="utf-8"))
            self.assertEqual(
                approval.authorization.authorization_id,
                prepared_authorization["authorization_id"],
                f"rank-{rank} authorization id drifted from prepared input",
            )
            tracked_bindings = {
                article_id: {
                    "source_id": binding.source_id,
                    "canonical_url": binding.canonical_url,
                    "published_date": binding.published_date.isoformat(),
                    "body_sha256": binding.body_sha256,
                }
                for article_id, binding in approval.authorization.approved_articles.items()
            }
            self.assertEqual(
                tracked_bindings,
                prepared_authorization["approved_articles"],
                f"rank-{rank} approval bindings drifted from prepared authorization",
            )
        summary = validate_pilot_articles(_read_articles(input_path), approvals)
        self.assertEqual(summary["agenda_count"], 5)
        self.assertEqual(summary["article_count"], 25)
        self.assertEqual(
            [rank["article_count"] for rank in summary["ranks"]],
            [7, 6, 4, 4, 4],
        )


if __name__ == "__main__":
    unittest.main()
