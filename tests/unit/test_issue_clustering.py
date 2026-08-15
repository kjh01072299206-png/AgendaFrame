from __future__ import annotations

import json
import unittest
from types import SimpleNamespace

from ai.issue_clustering import (
    INITIAL_FIVE_CLUSTER_SCHEMA_VERSION,
    InitialFiveClusterer,
    MetadataArticle,
    MetadataIssueClusterer,
    MetadataIssueGroup,
    build_initial_five_approval_manifest,
    build_initial_five_prompt,
    to_metadata_clusters_public_shape,
    validate_initial_five_payload,
    validate_metadata_payload,
)
from backend.config import RuntimeConfig


class MetadataIssueClusteringTests(unittest.TestCase):
    def setUp(self) -> None:
        self.config = RuntimeConfig.from_yaml("config/gcp-runtime.yaml")
        self.groups = (
            MetadataIssueGroup(
                issue_id="issue-1",
                issue_title="제도 논쟁",
                articles=(
                    MetadataArticle("a-1", "제도 폐지 논쟁", "매체A", "2026-07-26T10:00:00+09:00"),
                    MetadataArticle(
                        "a-2", "여당, 제도 유지 주장", "매체B", "2026-07-26T11:00:00+09:00"
                    ),
                ),
            ),
        )

    def test_metadata_payload_preserves_candidate_membership(self) -> None:
        payload = {
            "clusters": [
                {
                    "issue_id": "issue-1",
                    "decision": "analyze",
                    "coherence": "high",
                    "summary": "제도 유지와 폐지를 둘러싼 정치권 논쟁",
                    "common_subjects": ["제도", "폐지·유지 논쟁"],
                    "narrative_variants": [
                        {
                            "label": "폐지 우려",
                            "description": "제도 폐지의 파장을 앞세운 제목",
                            "article_ids": ["a-1"],
                        },
                        {
                            "label": "유지 주장",
                            "description": "제도 유지 필요성을 앞세운 제목",
                            "article_ids": ["a-2"],
                        },
                    ],
                    "outlier_article_ids": [],
                }
            ]
        }
        result = validate_metadata_payload(self.groups, payload, "fake-model")
        self.assertEqual(result[0].decision, "analyze")
        self.assertEqual(result[0].narrative_variants[0]["article_ids"], ["a-1"])
        self.assertEqual(result[0].text_scope, "title_source_published_at_only")
        self.assertTrue(result[0].as_dict()["engine"]["semantic_ai"])

    def test_invalid_variant_becomes_review_needed_without_invented_summary(self) -> None:
        payload = {
            "clusters": [
                {
                    "issue_id": "issue-1",
                    "decision": "analyze",
                    "coherence": "high",
                    "summary": "제도 논쟁",
                    "common_subjects": ["제도"],
                    "narrative_variants": [
                        {
                            "label": "확인 필요",
                            "description": "제공되지 않은 기사를 가리킴",
                            "article_ids": ["not-in-group"],
                        }
                    ],
                    "outlier_article_ids": [],
                }
            ]
        }
        result = validate_metadata_payload(self.groups, payload, "fake-model")
        self.assertEqual(result[0].decision, "review_needed")
        self.assertIsNone(result[0].summary)
        self.assertEqual(result[0].narrative_variants, ())

    def test_client_failure_keeps_deterministic_group_available(self) -> None:
        clusterer = MetadataIssueClusterer(
            self.config, client_factory=lambda _: (_ for _ in ()).throw(RuntimeError("offline"))
        )
        result = clusterer.analyze(self.groups)
        self.assertEqual(result[0].decision, "review_needed")
        self.assertIsNone(result[0].summary)
        self.assertIn("RuntimeError", result[0].fallback_reason or "")

    def test_payload_must_cover_every_candidate_issue(self) -> None:
        with self.assertRaises(ValueError):
            validate_metadata_payload(self.groups, {"clusters": []}, "fake-model")

    def _initial_five_fixture(
        self,
    ) -> tuple[tuple[MetadataArticle, ...], tuple[MetadataIssueGroup, ...]]:
        articles = self.groups[0].articles
        groups = (
            MetadataIssueGroup(
                issue_id="candidate-1",
                issue_title="후보 사건",
                articles=articles,
            ),
        )
        return articles, groups

    @staticmethod
    def _signature() -> dict[str, object]:
        return {
            "actors_or_institutions": ["기관"],
            "actions": ["발언"],
            "targets": ["제도"],
            "locations": [],
            "time_range": "2026-07-26",
            "event_stage": "논쟁",
        }

    def _payload(self, *, second_relation: str = "same_event") -> dict[str, object]:
        articles, _ = self._initial_five_fixture()
        assignments = [
            {
                "article_id": articles[0].article_id,
                "relation": "same_event",
                "event_signature": self._signature(),
                "emphasis_difference": "첫 기사는 행위자의 발언을 제목 앞에 둡니다.",
            },
            {
                "article_id": articles[1].article_id,
                "relation": second_relation,
                "event_signature": self._signature(),
                "emphasis_difference": "둘째 기사는 제도 논쟁의 대상을 앞에 둡니다.",
            },
        ]
        return {
            "schema_version": INITIAL_FIVE_CLUSTER_SCHEMA_VERSION,
            "clusters": [
                {
                    "cluster_id": "ai-cluster-1",
                    "label": "제도 발언 논쟁",
                    "event_summary": "두 기사가 같은 제도 관련 발언을 다룹니다.",
                    "coherence": "high",
                    "grouping_reason": "두 제목에 같은 행위자와 제도 대상이 나타납니다.",
                    "common_event_elements": self._signature(),
                    "emphasis_variants": [
                        {
                            "label": "발언 중심",
                            "description": "행위자의 발언을 앞세운 제목입니다.",
                            "article_ids": [article.article_id for article in articles],
                        }
                    ],
                    "article_assignments": assignments,
                }
            ],
            "ambiguous_article_ids": (
                [articles[1].article_id] if second_relation == "ambiguous" else []
            ),
            "outlier_article_ids": [],
            "excluded_article_ids": [],
        }

    def test_initial_five_prompt_is_flat_and_body_free(self) -> None:
        articles, groups = self._initial_five_fixture()
        prompt = build_initial_five_prompt(articles)
        self.assertIn(articles[0].article_id, prompt)
        self.assertNotIn("candidate-1", prompt)
        self.assertNotIn("body_text", prompt)
        self.assertNotIn("issue_id", prompt)
        self.assertNotIn(groups[0].issue_title, prompt)
        self.assertIn("Do not stop at five", prompt)
        self.assertIn("complete-link", prompt)
        self.assertIn("광복절", prompt)
        self.assertIn("Prefer more precise smaller clusters", prompt)

    def test_initial_five_exact_partition_is_approved_and_public_shape_is_body_free(self) -> None:
        articles, groups = self._initial_five_fixture()
        payload = self._payload()
        calls: list[str] = []

        class FakeModels:
            def generate_content(self, **kwargs: object) -> SimpleNamespace:
                calls.append(str(kwargs["contents"]))
                return SimpleNamespace(text=json.dumps(payload, ensure_ascii=False))

        result = InitialFiveClusterer(
            self.config,
            client_factory=lambda _: SimpleNamespace(models=FakeModels()),
            sleep_fn=lambda _: None,
        ).analyze(articles, groups)

        self.assertEqual(result.approval_status, "approved_same_event")
        self.assertEqual(result.analysis_state, "succeeded")
        self.assertEqual(result.clusters[0]["article_assignments"][0]["relation"], "same_event")
        self.assertEqual(len(calls), 1)
        public = to_metadata_clusters_public_shape(result, generated_at="fixed")
        self.assertEqual(public["clusters"][0]["decision"], "analyze")
        self.assertNotIn("body_text", json.dumps(public, ensure_ascii=False))
        manifest = build_initial_five_approval_manifest(result, generated_at="fixed")
        self.assertEqual(manifest["cluster_review_status"], "approved_same_event")
        self.assertTrue(manifest["body_free"])

    def test_initial_five_ambiguous_assignment_requires_review(self) -> None:
        articles, groups = self._initial_five_fixture()
        payload = self._payload(second_relation="ambiguous")
        result = InitialFiveClusterer(
            self.config,
            client_factory=lambda _: SimpleNamespace(
                models=SimpleNamespace(
                    generate_content=lambda **_: SimpleNamespace(
                        text=json.dumps(payload, ensure_ascii=False)
                    )
                )
            ),
            sleep_fn=lambda _: None,
        ).analyze(articles, groups)

        self.assertEqual(result.approval_status, "review_needed")
        self.assertTrue(any(item["type"] == "relation_ambiguous" for item in result.mismatches))
        public = to_metadata_clusters_public_shape(result)
        self.assertEqual(public["clusters"][0]["decision"], "review_needed")
        self.assertFalse(public["clusters"][0]["engine"]["semantic_ai"])

    def test_initial_five_global_outlier_can_cover_unclustered_article(self) -> None:
        articles, _ = self._initial_five_fixture()
        payload = self._payload()
        cluster = payload["clusters"][0]
        cluster["article_assignments"] = cluster["article_assignments"][:1]
        cluster["emphasis_variants"][0]["article_ids"] = [articles[0].article_id]
        payload["outlier_article_ids"] = [articles[1].article_id]

        normalized = validate_initial_five_payload(articles, payload)

        self.assertEqual(normalized["outlier_article_ids"], [articles[1].article_id])
        self.assertEqual(
            normalized["clusters"][0]["article_assignments"][0]["article_id"],
            articles[0].article_id,
        )

    def test_initial_five_invalid_json_is_retried_with_feedback(self) -> None:
        articles, groups = self._initial_five_fixture()
        payload = self._payload()
        responses = iter(
            [
                SimpleNamespace(text="not-json"),
                SimpleNamespace(text=json.dumps(payload, ensure_ascii=False)),
            ]
        )
        prompts: list[str] = []

        class FakeModels:
            def generate_content(self, **kwargs: object) -> SimpleNamespace:
                prompts.append(str(kwargs["contents"]))
                return next(responses)

        result = InitialFiveClusterer(
            self.config,
            client_factory=lambda _: SimpleNamespace(models=FakeModels()),
            sleep_fn=lambda _: None,
        ).analyze(articles, groups)

        self.assertEqual(result.approval_status, "approved_same_event")
        self.assertEqual(result.attempts, 2)
        self.assertIn("RETRY_VALIDATION_FEEDBACK", prompts[1])
        self.assertIn("json_decode_error", prompts[1])

    def test_runtime_limit_accepts_fifty_metadata_articles(self) -> None:
        articles = tuple(
            MetadataArticle(
                f"runtime-{index}",
                f"런타임 기사 {index}",
                "매체A",
                "2026-08-15T00:00:00+09:00",
            )
            for index in range(50)
        )
        groups = (
            MetadataIssueGroup(
                issue_id="runtime-candidate",
                issue_title="런타임 후보",
                articles=articles,
            ),
        )

        def fail_client(_: RuntimeConfig) -> object:
            raise RuntimeError("offline")

        result = InitialFiveClusterer(
            self.config,
            client_factory=fail_client,
            max_articles=50,
        ).analyze(articles, groups)
        self.assertEqual(result.approval_status, "review_needed")
        self.assertIn("client_initialization_RuntimeError", result.fallback_reason or "")


if __name__ == "__main__":
    unittest.main()
