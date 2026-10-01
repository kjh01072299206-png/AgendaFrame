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


def test_live_prompt_specifies_the_comparison_shape_not_just_its_version() -> None:
    from ai.event_synthesis import TRANSPORT_PROMPT_VERSION, _build_prompt

    prompt = _build_prompt({"profiles": [], "articles": []})
    assert "OUTPUT_SHAPE=" in prompt
    assert '"dimensions"' in prompt
    assert '"voice_basis"' in prompt
    assert '"analyzed_outlet_count"' in prompt
    assert TRANSPORT_PROMPT_VERSION in prompt


def test_transport_evidence_ids_expand_only_to_original_source_anchors() -> None:
    from ai.event_synthesis import _expand_transport_evidence, _transport_evidence_table

    anchor = evidence("a1", HASH_A)
    request = {"profiles": [{"items": [{**anchor, "public_paraphrase": "fixture"}, dict(anchor)]}]}
    table = _transport_evidence_table(request)
    assert table == [anchor]
    expanded = _expand_transport_evidence(
        {"evidence": [0, 99, -1, True], "voice_basis": {"evidence": [0]}}, table
    )
    assert expanded["evidence"] == [anchor, {}, {}, {}]
    assert expanded["voice_basis"]["evidence"] == [anchor]


def test_compact_transport_requires_exact_comparison_and_voice_fields() -> None:
    from ai.event_synthesis import _compact_response_schema

    schema = _compact_response_schema()
    result = schema["properties"]["comparison_result"]
    assert "dimensions" in result["required"]
    point = result["properties"]["dimensions"]["items"]["properties"]["points"]["items"]
    assert "voice_basis" in point["required"]
    assert point["properties"]["article_ids"]["maxItems"] == 2
    assert point["properties"]["evidence"]["items"]["type"] == "integer"


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

    def test_live_synthesizer_rejects_legacy_v2_without_explicit_comparison(self) -> None:
        class LegacySynthesizer:
            config = SimpleNamespace(vertex=SimpleNamespace(max_attempts=1))

            def synthesize(self, request):
                return {
                    "prompt_version": "event-synthesis-v2.0.0",
                    "schema_version": "agendaframe.event-synthesis.v2",
                    "event_paragraphs": [
                        {"text": "사건 설명", "evidence": [evidence("a1", HASH_A)]},
                        {"text": "추가 경위", "evidence": [evidence("a2", HASH_B)]},
                    ],
                    "terms": [
                        {
                            "term": "사건",
                            "gloss": "공개 프로필에 있는 용어",
                            "evidence": [evidence("a1", HASH_A)],
                        }
                    ],
                    "common_ground": {
                        "text": "공통으로 확인된 설명",
                        "evidence": [evidence("a1", HASH_A), evidence("a2", HASH_B)],
                    },
                }

        with self.assertRaises(EventSynthesisError):
            build_bound_comparison(
                profiles=[profile("a1", HASH_A), profile("a2", HASH_B)],
                articles=[article("a1", "한겨레"), article("a2", "KBS")],
                title="사건",
                issue_id="issue-legacy-v2",
                synthesizer=LegacySynthesizer(),
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

    def test_same_core_outlet_coverage_cannot_validate_a_one_outlet_difference(self) -> None:
        result = {
            "status": "difference_confirmed",
            "dimensions": [
                {
                    "dimension": "problem_definition",
                    "status": "difference_confirmed",
                    "points": [
                        {
                            "text": "두 매체가 예산 축소를 공통 핵심으로 다룸",
                            "relation": "same_core",
                            "article_ids": ["a1", "a2"],
                            "voice_basis": {"kind": "journalist_narration"},
                            "evidence": [evidence("a1", HASH_A), evidence("a2", HASH_B)],
                        },
                        {
                            "text": "A 매체 기사만 지역 격차를 추가로 강조함",
                            "relation": "different_emphasis",
                            "article_ids": ["a1"],
                            "voice_basis": {"kind": "journalist_narration"},
                            "evidence": [evidence("a1", HASH_A)],
                        },
                    ],
                }
            ],
        }
        bound = bind_event_synthesis(
            {"comparison_result": result},
            profiles=[profile("a1", HASH_A), profile("a2", HASH_B)],
            articles=[article("a1", "A 매체"), article("a2", "B 매체")],
        )

        self.assertEqual(bound["comparison_result"]["status"], "held_for_analysis")
        self.assertEqual(bound["comparison_result"]["dimensions"][0]["status"], "held_for_analysis")

    def test_held_root_discards_stale_dimension_points(self) -> None:
        bound = bind_event_synthesis(
            {
                "comparison_result": {
                    "status": "held_for_analysis",
                    "dimensions": [
                        {
                            "dimension": "problem_definition",
                            "status": "difference_confirmed",
                            "points": [
                                {
                                    "text": "서로 다른 설명",
                                    "relation": "different_emphasis",
                                    "article_ids": ["a1", "a2"],
                                    "voice_basis": {"kind": "journalist_narration"},
                                    "evidence": [evidence("a1", HASH_A), evidence("a2", HASH_B)],
                                }
                            ],
                        }
                    ],
                }
            },
            profiles=[profile("a1", HASH_A), profile("a2", HASH_B)],
            articles=[article("a1", "A 매체"), article("a2", "B 매체")],
        )

        comparison = bound["comparison_result"]
        self.assertEqual(comparison["status"], "held_for_analysis")
        self.assertEqual(comparison["dimensions"][0]["status"], "held_for_analysis")
        self.assertEqual(comparison["dimensions"][0]["points"], [])

    def test_no_clear_difference_requires_supported_shared_core(self) -> None:
        shared = bind_event_synthesis(
            {
                "comparison_result": {
                    "status": "no_clear_difference",
                    "dimensions": [
                        {
                            "dimension": "problem_definition",
                            "status": "no_clear_difference",
                            "points": [
                                {
                                    "text": "두 매체가 같은 핵심을 설명함",
                                    "relation": "same_core",
                                    "article_ids": ["a1", "a2"],
                                    "voice_basis": {"kind": "journalist_narration"},
                                    "evidence": [evidence("a1", HASH_A), evidence("a2", HASH_B)],
                                }
                            ],
                        }
                    ],
                }
            },
            profiles=[profile("a1", HASH_A), profile("a2", HASH_B)],
            articles=[article("a1", "A 매체"), article("a2", "B 매체")],
        )["comparison_result"]
        self.assertEqual(shared["status"], "no_clear_difference")
        self.assertEqual(shared["dimensions"][0]["status"], "no_clear_difference")

        unsupported = bind_event_synthesis(
            {"comparison_result": {"status": "no_clear_difference", "dimensions": []}},
            profiles=[profile("a1", HASH_A), profile("a2", HASH_B)],
            articles=[article("a1", "A 매체"), article("a2", "B 매체")],
        )["comparison_result"]
        self.assertEqual(unsupported["status"], "held_for_analysis")

    def test_failed_or_conflicting_comparison_points_are_discarded(self) -> None:
        stale_points = [
            {
                "text": "A 매체 강조",
                "relation": "different_emphasis",
                "article_ids": ["a1"],
                "voice_basis": {"kind": "journalist_narration"},
                "evidence": [evidence("a1", HASH_A)],
            },
            {
                "text": "B 매체 강조",
                "relation": "different_emphasis",
                "article_ids": ["a2"],
                "voice_basis": {"kind": "journalist_narration"},
                "evidence": [evidence("a2", HASH_B)],
            },
        ]
        for failed_state in ("analysis_failed", "conflicting"):
            with self.subTest(failed_state=failed_state):
                bound = bind_event_synthesis(
                    {
                        "comparison_result": {
                            "status": "difference_confirmed",
                            "dimensions": [
                                {
                                    "dimension": "problem_definition",
                                    "status": failed_state,
                                    "points": stale_points,
                                }
                            ],
                        }
                    },
                    profiles=[profile("a1", HASH_A), profile("a2", HASH_B)],
                    articles=[article("a1", "A 매체"), article("a2", "B 매체")],
                )
                dimension = bound["comparison_result"]["dimensions"][0]
                self.assertEqual(bound["comparison_result"]["status"], "analysis_failed")
                self.assertEqual(dimension["status"], "analysis_failed")
                self.assertEqual(dimension["points"], [])
                self.assertEqual(dimension["evidence"], [])

        for failed_state in ("analysis_failed", "conflicting"):
            with self.subTest(result_state=failed_state):
                bound = bind_event_synthesis(
                    {
                        "comparison_result": {
                            "status": failed_state,
                            "dimensions": [
                                {
                                    "dimension": "problem_definition",
                                    "status": "difference_confirmed",
                                    "points": stale_points,
                                }
                            ],
                        }
                    },
                    profiles=[profile("a1", HASH_A), profile("a2", HASH_B)],
                    articles=[article("a1", "A 매체"), article("a2", "B 매체")],
                )
                dimension = bound["comparison_result"]["dimensions"][0]
                self.assertNotEqual(bound["comparison_result"]["status"], "difference_confirmed")
                self.assertEqual(dimension["points"], [])
                self.assertEqual(dimension["evidence"], [])

    def test_missing_voice_basis_does_not_confirm_or_retain_a_comparison_point(self) -> None:
        bound = bind_event_synthesis(
            {
                "comparison_result": {
                    "status": "difference_confirmed",
                    "dimensions": [
                        {
                            "dimension": "problem_definition",
                            "status": "difference_confirmed",
                            "points": [
                                {
                                    "text": "A 매체 강조",
                                    "relation": "different_emphasis",
                                    "article_ids": ["a1"],
                                    "evidence": [evidence("a1", HASH_A)],
                                },
                                {
                                    "text": "B 매체 강조",
                                    "relation": "different_emphasis",
                                    "article_ids": ["a2"],
                                    "evidence": [evidence("a2", HASH_B)],
                                },
                            ],
                        }
                    ],
                }
            },
            profiles=[profile("a1", HASH_A), profile("a2", HASH_B)],
            articles=[article("a1", "A 매체"), article("a2", "B 매체")],
        )

        comparison = bound["comparison_result"]
        self.assertEqual(comparison["status"], "held_for_analysis")
        self.assertEqual(comparison["dimensions"][0]["status"], "held_for_analysis")
        self.assertEqual(comparison["dimensions"][0]["points"], [])

    def test_composer_does_not_build_camps_from_rank1_profiles(self) -> None:
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
        self.assertFalse(bound["opposition"])
        self.assertEqual(bound["camps"], [])
        self.assertEqual(bound["comparison_result"]["status"], "held_for_analysis")
        self.assertEqual(bound["split_line"]["status"], "explicit_not_stated")
        payload = public_comparison_payload(
            bound,
            article_count=bundle["issue"]["articleCount"],
            outlet_count=bundle["issue"]["outletCount"],
        )
        self.assertFalse(payload["summary_30_seconds"]["divergence_detected"])
        self.assertEqual(payload["camps"], [])
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
        self.assertEqual(payload["camps"], [])
        self.assertEqual(payload["comparison_result"]["status"], "held_for_analysis")
        self.assertFalse(payload["summary_30_seconds"]["divergence_detected"])
        self.assertTrue(payload["whatHappened"])
        self.assertTrue(payload["splitLine"])
        self.assertRegex(payload["splitLine"], r"대립 구도")
        self.assertNotIn("집계합니다", json.dumps(payload, ensure_ascii=False))
        self.assertNotIn(
            "검증된 기사별 관측 항목과 취재원 귀속을 비교합니다",
            json.dumps(payload, ensure_ascii=False),
        )

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


def test_provider_spend_cap_stops_issue_synthesis_after_one_attempt() -> None:
    calls = []

    class CappedSynthesizer:
        config = SimpleNamespace(vertex=SimpleNamespace(max_attempts=3))

        def synthesize(self, request):
            calls.append(request)
            return {"usable": False, "_failure_reason": "provider_spend_cap_breached"}

    with unittest.TestCase().assertRaisesRegex(EventSynthesisError, "provider_spend_cap_breached"):
        build_bound_comparison(profiles=[], articles=[], synthesizer=CappedSynthesizer())
    assert len(calls) == 1


if __name__ == "__main__":
    unittest.main()
