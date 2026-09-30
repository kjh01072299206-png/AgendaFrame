from __future__ import annotations

import copy
import importlib.util
import json
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace

import pytest

from backend.config import RuntimeConfig
from crawler.models import ArticleDocument

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts" / "run-current-display-framing-live.py"


def load_batch_module():
    spec = importlib.util.spec_from_file_location("current_display_batch", SCRIPT)
    if spec is None or spec.loader is None:
        raise AssertionError("could not load current-display batch module")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def comparison_verification_bundle(module, comparison_result=None, *, include_nested_result=True):
    synthesis = {
        "usable": True,
        "source": "gcp:event-synthesis",
        "prompt_version": module.EVENT_PROMPT_VERSION,
        "schema_version": module.EVENT_SCHEMA_VERSION,
        "invocation": {
            "provider": "vertex_ai",
            "model": "fixture-model",
            "prompt_version": module.EVENT_PROMPT_VERSION,
            "request_sha256": "a" * 64,
            "response_sha256": "b" * 64,
        },
    }
    if include_nested_result and comparison_result is not None:
        synthesis["comparison_result"] = comparison_result
    data = {"synthesis": synthesis}
    if comparison_result is not None:
        data["comparison_result"] = comparison_result
    return {
        "issue": {"issueId": "verification-fixture"},
        "articles": [],
        "semanticProfiles": [],
        "comparison": {"data": data},
    }


def test_current_display_cost_guard_matches_configured_flash_lite_rates() -> None:
    module = load_batch_module()
    config = RuntimeConfig.from_yaml(ROOT / "config" / "gcp-runtime.yaml")
    articles = [{"title": "기사 제목"} for _ in range(40)]

    actual = module.projected_cost_usd(config, articles, issue_count=5, attempts=1)
    input_tokens = sum(
        min(len(str(row["title"])) + 20_000, config.vertex.max_input_characters_per_article) // 4
        for row in articles
    )
    article_output_tokens = len(articles) * config.vertex.max_output_tokens
    synthesis_input_tokens = len(articles) * 260
    synthesis_output_tokens = 5 * config.vertex.max_output_tokens
    expected = (
        input_tokens + synthesis_input_tokens * 5
    ) / 1_000_000 * config.vertex.input_usd_per_million_tokens + (
        article_output_tokens + synthesis_output_tokens
    ) / 1_000_000 * config.vertex.output_usd_per_million_tokens

    assert actual == expected
    assert actual < config.estimated_daily_vertex_limit_usd


def test_live_cli_defaults_to_the_configured_model_and_attempt_count() -> None:
    module = load_batch_module()
    config = RuntimeConfig.from_yaml(ROOT / "config" / "gcp-runtime.yaml")
    args = module.build_argument_parser().parse_args([])

    assert args.model is None
    assert module.selected_model(config, args.model) == config.vertex.model
    assert module.selected_attempts(config, args.max_attempts) == config.vertex.max_attempts
    estimated = module.projected_cost_usd(
        config,
        [{"title": "기사 제목"} for _ in range(40)],
        issue_count=5,
        attempts=module.selected_attempts(config, args.max_attempts),
    )
    assert estimated < config.estimated_daily_vertex_limit_usd


def test_live_cli_rejects_model_overrides_without_matching_cost_rates() -> None:
    module = load_batch_module()
    config = RuntimeConfig.from_yaml(ROOT / "config" / "gcp-runtime.yaml")

    with pytest.raises(module.BatchError, match="configured cost rates"):
        module.selected_model(config, "gemini-2.5-pro")


def test_live_opt_in_rejects_budget_above_configured_daily_limit(monkeypatch) -> None:
    module = load_batch_module()
    config = RuntimeConfig.from_yaml(ROOT / "config" / "gcp-runtime.yaml")
    monkeypatch.setenv("AGENDAFRAME_LIVE_TESTS", "1")
    monkeypatch.setenv("AGENDAFRAME_NONPROD_PROJECT_ID", config.project_id)
    args = SimpleNamespace(
        live=True,
        budget_usd=config.estimated_daily_vertex_limit_usd + 0.01,
    )

    with pytest.raises(module.BatchError, match="configured daily Vertex limit"):
        module.require_live_opt_in(config, args)


def test_live_default_output_is_a_candidate_not_the_public_snapshot() -> None:
    module = load_batch_module()

    assert module.DEFAULT_OUTPUT_ROOT == ROOT / "tmp" / "current-display-batch" / "candidate"
    assert "site" not in module.DEFAULT_OUTPUT_ROOT.parts


def test_issue_verification_rejects_legacy_synthesis_without_comparison_result() -> None:
    module = load_batch_module()
    bundle = comparison_verification_bundle(module)
    synthesis = bundle["comparison"]["data"]["synthesis"]
    synthesis["prompt_version"] = "event-synthesis-v2.0.0"
    synthesis["schema_version"] = "agendaframe.event-synthesis.v2"
    synthesis["comparison_axis"] = None
    synthesis["camps"] = []

    report = module.verify_issue(bundle, {})

    assert report["passed"] is False
    assert report["comparisonResultValid"] is False
    assert report["comparisonResultStatus"] is None


def test_issue_verification_accepts_an_explicit_held_comparison_result() -> None:
    module = load_batch_module()
    comparison_result = {
        "version": "comparison-v1.0.0",
        "status": "held_for_analysis",
        "dimensions": [],
        "analyzed_article_ids": [],
        "analyzed_outlet_count": 0,
    }
    bundle = comparison_verification_bundle(module, comparison_result)

    report = module.verify_issue(bundle, {})

    assert report["passed"] is True
    assert report["comparisonResultValid"] is True
    assert report["comparisonResultStatus"] == "held_for_analysis"


def test_issue_verification_requires_comparison_result_in_the_shared_synthesis() -> None:
    module = load_batch_module()
    comparison_result = {
        "version": "comparison-v1.0.0",
        "status": "held_for_analysis",
        "dimensions": [],
        "analyzed_article_ids": [],
        "analyzed_outlet_count": 0,
    }
    bundle = comparison_verification_bundle(
        module,
        comparison_result,
        include_nested_result=False,
    )

    report = module.verify_issue(bundle, {})

    assert report["passed"] is False
    assert report["comparisonResultValid"] is False


def checkpoint_fixture(module):
    config = RuntimeConfig.from_yaml(ROOT / "config" / "gcp-runtime.yaml")
    stamp = datetime(2026, 8, 15, tzinfo=UTC)
    document = ArticleDocument(
        "fixture-a",
        "fixture",
        "https://example.test/a",
        "fixture",
        stamp,
        stamp,
        None,
        "정부는 예산안을 발표했다.",
        "full_body",
    )
    evidence = module.collect_evidence(
        {
            "locator": {"paragraph": 0, "sentence": 0},
            "sentence_sha256": "a" * 64,
        },
        document.article_id,
    )
    paragraph, sentence, digest = next(iter(module.body_evidence_index(document)))
    evidence[0]["locator"] = {"paragraph": paragraph, "sentence": sentence}
    evidence[0]["sentenceSha256"] = digest
    checkpoint = module.load_checkpoint(None, "context")
    entry = {
        "articleId": document.article_id,
        "status": "succeeded",
        "engine": {
            "bodySha256": document.body_hash,
            "model": config.vertex.model,
            "promptVersion": config.vertex.prompt_version,
        },
        "evidence": evidence,
        "profile": {
            "lineage": {
                "batch_run_id": checkpoint["runId"],
                "invocation": {
                    "provider": "vertex_ai",
                    "model": config.vertex.model,
                    "prompt_version": config.vertex.prompt_version,
                    "request_sha256": "a" * 64,
                    "response_sha256": "b" * 64,
                },
            }
        },
    }
    checkpoint["articles"][document.article_id] = {"entry": entry}
    return config, document, checkpoint


def test_checkpoint_reuses_only_matching_body_and_verified_evidence() -> None:
    module = load_batch_module()
    config, document, checkpoint = checkpoint_fixture(module)
    entry = module.reusable_checkpoint_entry(checkpoint, document, config)
    assert entry is not None
    assert entry is not checkpoint["articles"][document.article_id]["entry"]
    changed = copy.deepcopy(checkpoint)
    changed["articles"][document.article_id]["entry"]["engine"]["bodySha256"] = "b" * 64
    assert module.reusable_checkpoint_entry(changed, document, config) is None


@pytest.mark.parametrize(
    "field,value",
    [
        ("articleId", "another-article"),
        ("sentenceSha256", "b" * 64),
        ("locator", {"paragraph": 99, "sentence": 99}),
    ],
)
def test_checkpoint_rejects_wrong_article_locator_or_hash(field, value) -> None:
    module = load_batch_module()
    config, document, checkpoint = checkpoint_fixture(module)
    checkpoint["articles"][document.article_id]["entry"]["evidence"][0][field] = value
    assert module.reusable_checkpoint_entry(checkpoint, document, config) is None


def test_checkpoint_never_accepts_raw_bodies_or_a_different_context(tmp_path) -> None:
    module = load_batch_module()
    _, _, checkpoint = checkpoint_fixture(module)
    path = tmp_path / "checkpoint.json"
    module.save_checkpoint(path, checkpoint)
    assert module.load_checkpoint(path, "context")["runId"] == checkpoint["runId"]
    with pytest.raises(module.BatchError, match="does not match"):
        module.load_checkpoint(path, "different-context")
    checkpoint["raw_body"] = "private body"
    with pytest.raises(module.BatchError, match="forbidden"):
        module.save_checkpoint(path, checkpoint)


def test_article_spend_cap_failure_is_not_retried_or_exposed(monkeypatch) -> None:
    from google import genai

    module = load_batch_module()
    config, document, _ = checkpoint_fixture(module)
    calls = []

    class SpendCapError(Exception):
        code = 403
        details = {"error": {"message": "Spend cap breached: private provider details"}}

    def generate(**kwargs):
        calls.append(kwargs)
        raise SpendCapError("private provider details")

    monkeypatch.setattr(
        genai,
        "Client",
        lambda **kwargs: SimpleNamespace(models=SimpleNamespace(generate_content=generate)),
    )
    result = module.analyze_with_sentence_anchors(document, config=config, token="fixture-token")
    assert len(calls) == 1
    assert result.attempt_count == 1
    assert result.error_code == "provider_spend_cap_breached"
    assert "private provider details" not in json.dumps(result.fallback_reason)


def test_current_display_reads_the_active_issue_api_not_old_static_json(monkeypatch) -> None:
    module = load_batch_module()
    manifest = {
        "basisDate": "2026-08-15",
        "issueCount": 5,
        "articleCount": 5,
        "issues": [
            {"issueId": f"issue-{i}", "payloadKey": f"issues/issue-{i}.json"} for i in range(5)
        ],
    }
    requested = []

    def request(url):
        requested.append(url)
        if url.endswith("/api/initial-five"):
            return manifest
        assert "/api/initial-five/issues/" in url
        return {
            "basisDate": manifest["basisDate"],
            "issue": {"issueId": url.rsplit("/", 1)[1]},
            "articles": [{"articleId": url.rsplit("/", 1)[1]}],
        }

    monkeypatch.setattr(module, "request_json", request)
    _, bundles = module.current_display_sources("https://example.test/")
    assert len(bundles) == 5
    assert len(requested) == 6


def test_current_display_rejects_an_issue_from_another_snapshot(monkeypatch) -> None:
    module = load_batch_module()
    manifest = {
        "basisDate": "2026-08-15",
        "issueCount": 5,
        "issues": [
            {"issueId": f"issue-{i}", "payloadKey": f"issues/issue-{i}.json"} for i in range(5)
        ],
    }
    monkeypatch.setattr(
        module,
        "request_json",
        lambda url: (
            manifest
            if url.endswith("/api/initial-five")
            else {"issue": {"issueId": "old-issue"}, "basisDate": "2026-07-26"}
        ),
    )
    with pytest.raises(module.BatchError, match="does not match"):
        module.current_display_sources("https://example.test")
