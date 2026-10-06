"""Synthetic contract regressions, not evidence of live model accuracy."""

import hashlib
from copy import deepcopy

import pytest

from ai.event_synthesis import synthesis_request
from ai.fine_comparison import AXES, VERSION, bind_fine_comparison, response_schema


def fixture():
    refs = [
        {"article_id": key, "locator": {"paragraph": 1, "sentence": 1}, "sentence_sha256": key * 64}
        for key in ("a", "b")
    ]
    index = {(ref["article_id"], 1, 1, ref["sentence_sha256"]): ref for ref in refs}
    articles = [{"articleId": "a", "outlet": "A"}, {"articleId": "b", "outlet": "B"}]
    draft = {
        "version": VERSION,
        "observations": [
            {
                "observation_id": "synthetic",
                "axis": "certainty",
                "status": "expression_only",
                "headline": "확실성 표현",
                "common": "같은 정책과 가격 관계를 말한다.",
                "articles": [
                    {
                        "article_id": "a",
                        "outlet": "A",
                        "description": "가능성을 남긴다.",
                        "voice": "journalist_narration",
                        "evidence": [refs[0]],
                        "scope": "문장 한 개",
                    },
                    {
                        "article_id": "b",
                        "outlet": "B",
                        "description": "단정형으로 제시한다.",
                        "voice": "journalist_narration",
                        "evidence": [refs[1]],
                        "scope": "문장 한 개",
                    },
                ],
                "difference": "확실성 표현의 차이다.",
                "importance": {"level": "low", "reason": "불확실성 범위만 달라진다."},
                "interpretation": "찬반이나 정치적 성향은 판단할 수 없다.",
                "limitations": "본문 전체 효과를 판단하지 않는다.",
            }
        ],
    }
    return draft, articles, index


@pytest.mark.parametrize("axis", AXES)
def test_sensitive_candidate_contract_keeps_independent_observations(axis):
    draft, articles, index = fixture()
    draft["observations"][0]["axis"] = axis
    result = bind_fine_comparison(draft, articles=articles, index=index)
    assert result["observations"][0]["status"] == "expression_only"
    assert result["observations"][0]["axis"] == axis


@pytest.mark.parametrize("failure", ["outlet", "hash", "duplicate", "missing_context", "version"])
def test_invalid_details_do_not_pass_binding(failure):
    draft, articles, index = fixture()
    item = draft["observations"][0]
    if failure == "outlet":
        item["articles"][0]["outlet"] = "wrong"
    elif failure == "hash":
        item["articles"][0]["evidence"][0]["sentence_sha256"] = "c" * 64
    elif failure == "duplicate":
        item["articles"][1]["description"] = item["articles"][0]["description"]
    elif failure == "missing_context":
        item["limitations"] = ""
    else:
        draft["version"] = "stale"
    result = bind_fine_comparison(draft, articles=articles, index=index)
    assert result is None or not result["observations"]


def test_fine_comparison_contract_preserves_wide_coverage_limits():
    evidence_refs = {"type": "array", "items": {"type": "integer"}, "maxItems": 8}
    schema = response_schema(evidence_refs)["properties"]
    assert schema["observations"]["maxItems"] == 24
    observation = schema["observations"]["items"]["properties"]
    assert observation["articles"]["items"]["properties"]["evidence"] == evidence_refs
    draft, articles, index = fixture()
    valid = deepcopy(draft["observations"][0])
    draft["observations"][0]["articles"][0]["outlet"] = "wrong"
    valid["observation_id"] = "valid-sibling"
    draft["observations"].append(valid)
    result = bind_fine_comparison(draft, articles=articles, index=index)
    assert len(result["observations"]) == 1
    assert len(result["rejected"]) == 1


@pytest.mark.parametrize(
    "failure", [None, "failed", "body", "prompt", "identity", "schema", "voice", "review"]
)
def test_real_profile_binding_contract_checks_generation_and_voice(failure):
    draft, articles, index = fixture()
    profiles = []
    for article, row in zip(articles, draft["observations"][0]["articles"], strict=True):
        key = article["articleId"]
        article["bodySha256"] = key * 64
        ref = row["evidence"][0]
        profiles.append(
            {
                "articleId": key,
                "status": "succeeded",
                "engine": {
                    "status": "succeeded",
                    "articleId": key,
                    "bodySha256": key * 64,
                    "promptVersion": "2.6.0:sentence-anchor-v1.3.0",
                    "schemaVersion": "agendaframe.article-frame-profile.v2",
                },
                "profile": {
                    "article": {"article_id": key, "body_sha256": key * 64},
                    "engine": {
                        "prompt_version": "2.6.0:sentence-anchor-v1.3.0",
                        "analysis_schema_version": 3,
                    },
                    "dimensions": {
                        "problem_definition": {
                            "model_status": "supported",
                            "items": [
                                {
                                    "evidence": {
                                        "locator": ref["locator"],
                                        "sentence_sha256": ref["sentence_sha256"],
                                    },
                                    "voice": {"kind": "journalist_narration"},
                                }
                            ],
                        }
                    },
                },
            }
        )
    entry = profiles[0]
    if failure == "failed":
        entry["status"] = "failed"
    elif failure == "body":
        entry["engine"]["bodySha256"] = "c" * 64
    elif failure == "prompt":
        entry["engine"]["promptVersion"] = "stale"
    elif failure == "identity":
        entry["profile"]["article"]["article_id"] = "other"
    elif failure == "schema":
        entry["profile"]["engine"]["analysis_schema_version"] = 2
    elif failure == "voice":
        entry["profile"]["dimensions"]["problem_definition"]["items"][0]["voice"]["kind"] = (
            "direct_quote"
        )
    elif failure == "review":
        entry["profile"]["review"] = {"status": "review_needed"}
    result = bind_fine_comparison(draft, articles=articles, index=index, profiles=profiles)
    assert bool(result["observations"]) == (failure is None)


@pytest.mark.parametrize("failure", [None, "title", "hash", "axis", "voice", "missing"])
def test_title_selection_binds_article_id_title_and_namespaced_digest(failure):
    draft, articles, index = fixture()
    item = draft["observations"][0]
    item["axis"] = "title_lead"
    for article, row in zip(articles, item["articles"], strict=True):
        article["title"] = f"합성 제목 {article['articleId']}"
        digest = hashlib.sha256(
            f"agendaframe:title:v2:{article['articleId']}:{article['title']}".encode()
        ).hexdigest()
        row.update(
            voice="title_selection",
            evidence=[],
            title_basis={"title": article["title"], "title_sha256": digest},
        )
    row = item["articles"][0]
    if failure == "title":
        row["title_basis"]["title"] = "다른 제목"
    elif failure == "hash":
        row["title_basis"]["title_sha256"] = "c" * 64
    elif failure == "axis":
        item["axis"] = "placement"
    elif failure == "voice":
        row["voice"] = "journalist_narration"
    elif failure == "missing":
        row.pop("title_basis")
    result = bind_fine_comparison(draft, articles=articles, index=index)
    assert bool(result["observations"]) == (failure is None)


def test_title_digest_is_supplied_to_the_model_instead_of_generated_by_it():
    articles = [{"articleId": "a", "outlet": "A", "title": "합성 테스트 제목"}]
    request = synthesis_request(
        issue_id="synthetic-only", title="합성 테스트", articles=articles, profiles=[]
    )
    expected = hashlib.sha256("agendaframe:title:v2:a:합성 테스트 제목".encode()).hexdigest()
    assert request["articles"][0]["title_sha256"] == expected
