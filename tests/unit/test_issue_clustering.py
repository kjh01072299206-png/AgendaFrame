from __future__ import annotations

import unittest

from ai.issue_clustering import (
    MetadataArticle,
    MetadataIssueClusterer,
    MetadataIssueGroup,
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


if __name__ == "__main__":
    unittest.main()
