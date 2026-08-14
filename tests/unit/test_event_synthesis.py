from __future__ import annotations

import unittest

from ai.event_synthesis import (
    SCHEMA_VERSION,
    EventSynthesisError,
    bind_event_synthesis,
    public_comparison_payload,
    synthesis_request,
)

HASH_A = "a" * 64
HASH_B = "b" * 64


def profile(article_id: str, digest: str, *, paragraph: int = 1, sentence: int = 1) -> dict:
    return {
        "articleId": article_id,
        "evidence": [
            {
                "articleId": article_id,
                "locator": {"paragraph": paragraph, "sentence": sentence},
                "sentenceSha256": digest,
            }
        ],
        "profile": {
            "dimensions": {
                "problem_definition": {
                    "status": "observed",
                    "items": [
                        {
                            "public_paraphrase": f"{article_id} problem",
                            "voice": {"kind": "journalist_narration"},
                            "evidence": {
                                "locator": {"paragraph": paragraph, "sentence": sentence},
                                "sentence_sha256": digest,
                            },
                        }
                    ],
                }
            }
        },
    }


def article(article_id: str, outlet: str) -> dict:
    return {"articleId": article_id, "outlet": outlet, "title": article_id, "sourceId": outlet}


def evidence(article_id: str, digest: str, *, paragraph: int = 1, sentence: int = 1) -> dict:
    return {
        "article_id": article_id,
        "locator": {"paragraph": paragraph, "sentence": sentence},
        "sentence_sha256": digest,
    }


class EventSynthesisBindingTests(unittest.TestCase):
    def test_keeps_cited_camps_and_drops_uncited_prose(self) -> None:
        bound = bind_event_synthesis(
            {
                "what_happened": "여야가 보완수사권 폐지를 두고 맞붙었다",
                "what_happened_evidence": [evidence("a1", HASH_A)],
                "agreed_line": "원인과 책임을 대통령·여당에서 찾는다",
                "agreed_evidence": [evidence("a1", HASH_A), evidence("a2", HASH_B)],
                "split_line": "정치 책임과 제도 안전장치 중 어디에 초점을 두는지가 갈린다",
                "split_evidence": [evidence("a1", HASH_A), evidence("a2", HASH_B)],
                "so_what": "먼저 읽은 기사에 따라 대통령 태도 문제인지 수사 제도 문제인지가 달라진다",
                "so_what_evidence": [evidence("a2", HASH_B)],
                "camps": [
                    {
                        "name": "정치 책임을 앞세운 쪽",
                        "gist": "대통령의 침묵과 정치적 책임을 앞세웠다",
                        "article_ids": ["a1"],
                        "evidence": [evidence("a1", HASH_A)],
                    },
                    {
                        "name": "제도 약화를 앞세운 쪽",
                        "gist": "보완수사권 폐지에 따른 제도적 안전장치 약화를 앞세웠다",
                        "article_ids": ["a2"],
                        "evidence": [evidence("a2", HASH_B)],
                    },
                ],
                "fact_rows": [
                    {
                        "question": "누구 책임이라고 했나",
                        "common": "대통령과 여당 양쪽에 책임을 돌린다",
                        "evidence": [evidence("a1", HASH_A)],
                    }
                ],
                "invented": "본문에만 있는 문장",
            },
            profiles=[profile("a1", HASH_A), profile("a2", HASH_B)],
            articles=[article("a1", "조선일보"), article("a2", "중앙일보")],
        )
        self.assertTrue(bound["usable"])
        self.assertTrue(bound["opposition"])
        self.assertEqual(bound["schemaVersion"], SCHEMA_VERSION)
        self.assertEqual(bound["what_happened"]["status"], "observed")
        self.assertEqual(len(bound["camps"]), 2)
        self.assertEqual(bound["camps"][0]["outlets"], ["조선일보"])
        self.assertEqual(bound["fact_rows"][0]["status"], "observed")
        payload = public_comparison_payload(bound, article_count=2, outlet_count=2)
        self.assertTrue(payload["summary_30_seconds"]["divergence_detected"])
        self.assertIn("제도 안전장치", payload["summary_30_seconds"]["main_difference"])

    def test_rejects_uncited_claims_as_insufficient_evidence(self) -> None:
        bound = bind_event_synthesis(
            {
                "what_happened": "근거 없는 요약",
                "what_happened_evidence": [evidence("a1", "c" * 64)],
                "agreed_line": "근거 없는 공통선",
                "agreed_evidence": [],
            },
            profiles=[profile("a1", HASH_A)],
            articles=[article("a1", "한겨레")],
        )
        self.assertFalse(bound["usable"])
        self.assertEqual(bound["what_happened"]["status"], "insufficient_evidence")
        self.assertIsNone(bound["what_happened"]["text"])

    def test_does_not_force_opposition_without_two_evidence_groups(self) -> None:
        bound = bind_event_synthesis(
            {
                "what_happened": "한 줄로 같은 사건을 전한다",
                "what_happened_evidence": [evidence("a1", HASH_A)],
                "agreed_line": "모든 기사가 같은 원인을 쓴다",
                "agreed_evidence": [evidence("a1", HASH_A)],
                "split_line": "억지로 만든 대립",
                "split_evidence": [evidence("a1", HASH_A)],
                "camps": [
                    {
                        "name": "한쪽만 있는 캠프",
                        "gist": "한 매체만 근거가 있다",
                        "article_ids": ["a1"],
                        "evidence": [evidence("a1", HASH_A)],
                    }
                ],
            },
            profiles=[profile("a1", HASH_A), profile("a2", HASH_B)],
            articles=[article("a1", "KBS"), article("a2", "SBS")],
        )
        self.assertTrue(bound["usable"])
        self.assertFalse(bound["opposition"])
        self.assertEqual(bound["camps"], [])
        self.assertEqual(bound["split_line"]["status"], "explicit_not_stated")
        payload = public_comparison_payload(bound, article_count=2, outlet_count=2)
        self.assertFalse(payload["summary_30_seconds"]["divergence_detected"])
        self.assertIn("공통 보도", payload["summary_30_seconds"]["main_difference"])

    def test_blocks_ideology_labels_and_raw_body_fields(self) -> None:
        bound = bind_event_synthesis(
            {
                "what_happened": "보수 언론이 대통령을 공격했다",
                "what_happened_evidence": [evidence("a1", HASH_A)],
                "agreed_line": "관측된 공통 설명",
                "agreed_evidence": [evidence("a1", HASH_A)],
            },
            profiles=[profile("a1", HASH_A)],
            articles=[article("a1", "서울신문")],
        )
        self.assertEqual(bound["what_happened"]["status"], "review_needed")
        self.assertIsNone(bound["what_happened"]["text"])
        with self.assertRaises(EventSynthesisError):
            bind_event_synthesis(
                {"what_happened": "ok", "raw_body": "secret"},
                profiles=[profile("a1", HASH_A)],
                articles=[article("a1", "서울신문")],
            )

    def test_synthesis_request_is_body_free(self) -> None:
        request = synthesis_request(
            issue_id="issue-1",
            title="검찰 보완수사권",
            articles=[article("a1", "경향신문")],
            profiles=[profile("a1", HASH_A)],
        )
        encoded = str(request)
        self.assertNotIn("raw_body", encoded)
        self.assertNotIn("body_text", encoded)
        self.assertEqual(request["profiles"][0]["items"][0]["sentence_sha256"], HASH_A)


if __name__ == "__main__":
    unittest.main()
