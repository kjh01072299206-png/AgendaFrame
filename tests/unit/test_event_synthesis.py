from __future__ import annotations

import json
import unittest
from pathlib import Path
from types import SimpleNamespace

from ai.event_synthesis import (
    PROMPT_VERSION,
    SCHEMA_VERSION,
    EventSynthesisError,
    bind_event_synthesis,
    build_bound_comparison,
    compose_event_synthesis,
    public_comparison_payload,
    source_lens_from_profiles,
    synthesis_request,
)

ROOT = Path(__file__).resolve().parents[2]
RANK1 = ROOT / "site" / "public" / "initial-five" / "issues" / "bigkinds-2026-07-26-top-1.json"

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
    def test_binds_v2_event_contract_with_camp_proof(self) -> None:
        draft = {
            "prompt_version": PROMPT_VERSION,
            "schema_version": SCHEMA_VERSION,
            "event_paragraphs": [
                {"text": "두 매체가 같은 사건을 다뤘다", "evidence": [evidence("a1", HASH_A)]},
                {
                    "text": "기사들은 사건의 경위를 서로 다른 위치에서 설명했다",
                    "evidence": [evidence("a2", HASH_B)],
                },
            ],
            "terms": [
                {
                    "term": "보완수사권",
                    "gloss": "수사 과정에서 추가 확인을 할 수 있는 권한",
                    "evidence": [evidence("a1", HASH_A)],
                }
            ],
            "comparison_axis": {
                "label": "정치적 책임과 제도 안전장치",
                "points": [
                    {"text": "정치적 책임을 먼저 설명", "evidence": [evidence("a1", HASH_A)]},
                    {"text": "제도 안전장치를 먼저 설명", "evidence": [evidence("a2", HASH_B)]},
                ],
                "question": "이 사건을 정치 책임으로 읽을까, 제도 문제로 읽을까",
                "evidence": [evidence("a1", HASH_A), evidence("a2", HASH_B)],
            },
            "common_ground": {
                "text": "두 기사는 같은 제도 논쟁을 다뤘다",
                "evidence": [evidence("a1", HASH_A), evidence("a2", HASH_B)],
            },
            "camps": [
                {
                    "name": "정치 책임을 앞세운 쪽",
                    "headline": "정치적 책임을 먼저 묻는 갈래",
                    "summary": "대통령의 태도와 정치적 책임을 기사 앞부분에 배치했다",
                    "decisive_difference": "제도 설명보다 책임 주체를 먼저 보이게 했다",
                    "article_ids": ["a1"],
                    "voice_basis": {
                        "kind": "journalist_narration",
                        "label": "기자 서술 중심",
                        "evidence": [evidence("a1", HASH_A)],
                    },
                    "evidence": [evidence("a1", HASH_A)],
                    "headline_evidence": [evidence("a1", HASH_A)],
                    "summary_evidence": [evidence("a1", HASH_A)],
                    "decisive_difference_evidence": [evidence("a1", HASH_A)],
                    "proof_rows": [
                        {
                            "article_id": "a1",
                            "outlet": "조선일보",
                            "dimension": "책임 귀속",
                            "public_paraphrase": "대통령의 태도에 책임을 연결했다",
                            "evidence": [evidence("a1", HASH_A)],
                        }
                    ],
                },
                {
                    "name": "제도 문제를 앞세운 쪽",
                    "headline": "제도 안전장치를 먼저 보여 준 갈래",
                    "summary": "권한 축소가 수사 제도에 미칠 영향을 기사 앞부분에 배치했다",
                    "decisive_difference": "정치적 공방보다 제도 작동 방식을 먼저 보이게 했다",
                    "article_ids": ["a2"],
                    "voice_basis": {
                        "kind": "source_attributed",
                        "label": "취재원 발언 중심",
                        "evidence": [evidence("a2", HASH_B)],
                    },
                    "evidence": [evidence("a2", HASH_B)],
                    "headline_evidence": [evidence("a2", HASH_B)],
                    "summary_evidence": [evidence("a2", HASH_B)],
                    "decisive_difference_evidence": [evidence("a2", HASH_B)],
                    "proof_rows": [
                        {
                            "article_id": "a2",
                            "outlet": "중앙일보",
                            "dimension": "문제 정의",
                            "public_paraphrase": "제도 안전장치 약화를 문제로 설명했다",
                            "evidence": [evidence("a2", HASH_B)],
                        }
                    ],
                },
            ],
        }
        bound = bind_event_synthesis(
            draft,
            profiles=[profile("a1", HASH_A), profile("a2", HASH_B)],
            articles=[article("a1", "조선일보"), article("a2", "중앙일보")],
        )
        self.assertEqual(bound["schemaVersion"], SCHEMA_VERSION)
        self.assertEqual(len(bound["event_paragraphs"]), 2)
        self.assertEqual(bound["common_ground"]["status"], "observed")
        self.assertTrue(bound["comparison_axis"]["question"])
        self.assertTrue(bound["camps"][0]["headline_evidence"])
        self.assertTrue(bound["camps"][0]["proof_rows"][0]["public_paraphrase"])

        no_axis = dict(draft)
        no_axis.pop("comparison_axis")
        closed = bind_event_synthesis(
            no_axis,
            profiles=[profile("a1", HASH_A), profile("a2", HASH_B)],
            articles=[article("a1", "議곗꽑?쇰낫"), article("a2", "以묒븰?쇰낫")],
        )
        self.assertFalse(closed["opposition"])
        self.assertEqual(closed["camps"], [])

    def test_live_synthesizer_does_not_fall_back_to_profile_composition(self) -> None:
        class InvalidSynthesizer:
            config = SimpleNamespace(vertex=SimpleNamespace(max_attempts=1))

            def synthesize(self, request):
                return {"prompt_version": "event-synthesis-v1.0.0", "usable": True}

        with self.assertRaises(EventSynthesisError):
            build_bound_comparison(
                profiles=[profile("a1", HASH_A)],
                articles=[article("a1", "한겨레")],
                title="사건",
                issue_id="issue-1",
                synthesizer=InvalidSynthesizer(),
            )

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
        safe_bound = bind_event_synthesis(
            {
                "what_happened": "기사에 공통으로 확인된 사건 설명",
                "what_happened_evidence": [evidence("a1", HASH_A)],
                "terms": [
                    {
                        "term": "government",
                        "gloss": "내부 코드",
                        "evidence": [evidence("a1", HASH_A)],
                    }
                ],
                "camps": [
                    {
                        "name": "effectiveness_positive",
                        "gist": "내부 코드 갈래",
                        "article_ids": ["a1"],
                        "evidence": [evidence("a1", HASH_A)],
                    }
                ],
            },
            profiles=[profile("a1", HASH_A)],
            articles=[article("a1", "서울신문")],
        )
        self.assertNotIn("effectiveness_positive", str(safe_bound))
        self.assertNotIn('"term": "government"', str(safe_bound))
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

    def test_composer_builds_three_camps_from_rank1_profiles(self) -> None:
        bundle = json.loads(RANK1.read_text(encoding="utf-8"))
        draft = compose_event_synthesis(
            profiles=bundle["semanticProfiles"],
            articles=bundle["articles"],
            title=bundle["issue"]["title"],
        )
        bound = bind_event_synthesis(
            draft,
            profiles=bundle["semanticProfiles"],
            articles=bundle["articles"],
        )
        self.assertTrue(bound["usable"])
        self.assertTrue(bound["opposition"])
        names = [camp["name"] for camp in bound["camps"]]
        self.assertEqual(len(bound["camps"]), 3)
        self.assertTrue(any("거부권" in name or "침묵" in name for name in names))
        self.assertTrue(any("제도" in name for name in names))
        self.assertTrue(any("경고" in name for name in names))
        self.assertEqual(bound["agreed_line"]["status"], "observed")
        self.assertIn("책임", bound["agreed_line"]["text"] or "")
        payload = public_comparison_payload(
            bound,
            article_count=bundle["issue"]["articleCount"],
            outlet_count=bundle["issue"]["outletCount"],
        )
        self.assertTrue(payload["summary_30_seconds"]["divergence_detected"])
        self.assertNotIn("집계합니다", payload["summary_30_seconds"]["common_ground"] or "")
        lens = source_lens_from_profiles(bundle["semanticProfiles"], bundle["articles"])
        self.assertGreaterEqual(len(lens["by_outlet"]), 5)
        encoded = json.dumps(bound, ensure_ascii=False)
        self.assertNotIn("raw_body", encoded)
        self.assertNotIn("진보", encoded)
        self.assertNotIn("보수", encoded)

    def test_shipped_comparison_entry_emits_html_fields_for_rank1(self) -> None:
        bundle = json.loads(RANK1.read_text(encoding="utf-8"))
        bound = build_bound_comparison(
            profiles=bundle["semanticProfiles"],
            articles=bundle["articles"],
            title=bundle["issue"]["title"],
            issue_id=bundle["issue"]["issueId"],
        )
        self.assertIsNotNone(bound)
        assert bound is not None
        self.assertEqual(bound["source"], "gcp:profile-event-composition")
        payload = public_comparison_payload(
            bound,
            article_count=len(bundle["articles"]),
            outlet_count=bundle["issue"]["outletCount"],
        )
        self.assertGreaterEqual(len(payload["camps"]), 2)
        self.assertTrue(payload["agreedLine"])
        self.assertTrue(payload["whatHappened"])
        self.assertTrue(payload["splitLine"])
        self.assertRegex(payload["splitLine"], r"앞세웠고")
        self.assertRegex(payload["splitLine"], r"경고를 전했")
        self.assertNotIn("쪽는", payload["splitLine"])
        self.assertTrue(payload["factRows"])
        self.assertTrue(payload["frameFunctions"])
        self.assertNotIn("집계합니다", json.dumps(payload, ensure_ascii=False))
        self.assertNotIn(
            "검증된 기사별 관측 항목과 취재원 귀속을 비교합니다",
            json.dumps(payload, ensure_ascii=False),
        )
        self.assertTrue(all(camp.get("evidence") for camp in payload["camps"]))

    def test_shipped_comparison_entry_keeps_rank4_as_shared_coverage(self) -> None:
        bundle = json.loads(
            (
                ROOT
                / "site"
                / "public"
                / "initial-five"
                / "issues"
                / "bigkinds-2026-07-26-top-4.json"
            ).read_text(encoding="utf-8")
        )
        bound = build_bound_comparison(
            profiles=bundle["semanticProfiles"],
            articles=bundle["articles"],
            title=bundle["issue"]["title"],
            issue_id=bundle["issue"]["issueId"],
        )
        self.assertIsNotNone(bound)
        assert bound is not None
        payload = public_comparison_payload(
            bound,
            article_count=len(bundle["articles"]),
            outlet_count=bundle["issue"]["outletCount"],
        )
        self.assertFalse(bound["opposition"])
        self.assertLess(len(payload["camps"]), 2)
        self.assertIn("대립 구도", payload["splitLine"])
        self.assertNotIn("집계합니다", json.dumps(payload, ensure_ascii=False))
        self.assertNotIn("대통령·여당", payload["agreedLine"] or "")


if __name__ == "__main__":
    unittest.main()
