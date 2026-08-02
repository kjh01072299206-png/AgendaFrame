"""Run and locally publish the bounded 25-article Gemini framing pilot.

Without ``--live`` this command performs a network-free preflight. Live mode
requires ``AGENDAFRAME_LIVE_TESTS=1`` and the configured non-production project.
Only validated public profiles are written under ``site/data``; article bodies,
access tokens, and raw model responses are never logged or published.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from dataclasses import replace
from datetime import date, datetime
from pathlib import Path
from typing import Any, Sequence

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from ai.framing import VertexFrameAnalyzer, validate_frame_result  # noqa: E402
from backend.analysis_state import (  # noqa: E402
    AnalysisState,
    analysis_idempotency_fingerprint,
)
from backend.config import RuntimeConfig  # noqa: E402
from backend.pilot import (  # noqa: E402
    PILOT_ARTICLE_COUNT,
    PILOT_ARTICLE_COUNTS,
    load_pilot_approvals,
    validate_pilot_articles,
)
from backend.publisher import public_profile  # noqa: E402
from crawler.models import ArticleDocument, canonicalize_url  # noqa: E402

TARGET_DATE = date(2026, 7, 26)
MAX_REDRIVE_ROUNDS = 3
DEFAULT_INPUT = ROOT / "tmp" / "initial-five-prepared" / "articles.jsonl"
DEFAULT_CONFIG = ROOT / "config" / "gcp-runtime.yaml"
DEFAULT_APPROVALS = ROOT / "config" / "analysis-approvals"
DEFAULT_OUTPUT_ROOT = ROOT / "site" / "data"
DEFAULT_CHECKPOINT = ROOT / "tmp" / "initial-five-prepared" / "framing-live-checkpoint.json"


def parse_datetime(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def load_articles(path: Path) -> tuple[ArticleDocument, ...]:
    articles: list[ArticleDocument] = []
    for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        try:
            row = json.loads(line)
            article = ArticleDocument(
                article_id=str(row["article_id"]),
                source_id=str(row["source_id"]),
                canonical_url=canonicalize_url(str(row["canonical_url"])),
                title=str(row["title"]),
                published_at=parse_datetime(str(row["published_at"])),
                collected_at=parse_datetime(str(row["collected_at"])),
                section=str(row["section"]) if row.get("section") is not None else None,
                body_text=str(row["body_text"]),
                text_scope=str(row["text_scope"]),
            )
        except (KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
            raise ValueError(f"invalid pilot article at line {line_number}") from error
        articles.append(article)
    if len(articles) != PILOT_ARTICLE_COUNT:
        raise ValueError(f"pilot input must contain exactly {PILOT_ARTICLE_COUNT} articles")
    if len({article.article_id for article in articles}) != len(articles):
        raise ValueError("pilot input contains duplicate article IDs")
    return tuple(articles)


def output_path(output_root: Path, rank: int, article_id: str) -> Path:
    return output_root / f"semantic-rank{rank}-2026-07-26" / f"{article_id}.json"


def existing_success(path: Path, article: ArticleDocument, config: RuntimeConfig) -> bool:
    if not path.exists():
        return False
    try:
        wrapper = json.loads(path.read_text(encoding="utf-8"))
        profile = wrapper["profile"]
        return (
            wrapper.get("articleId") == article.article_id
            and profile.get("article", {}).get("body_sha256") == article.body_hash
            and profile.get("engine", {}).get("semantic_ai") is True
            and profile.get("engine", {}).get("version") == config.vertex.model
            and profile.get("engine", {}).get("prompt_version") == config.vertex.prompt_version
            and int(profile.get("engine", {}).get("analysis_schema_version")) == config.vertex.schema_version
            and profile.get("review", {}).get("analysis_decision") == "analyze"
        )
    except (OSError, TypeError, ValueError, KeyError, json.JSONDecodeError):
        return False


def atomic_write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def make_client(config: RuntimeConfig, token: str) -> Any:
    from google import genai
    from google.oauth2.credentials import Credentials

    return genai.Client(
        vertexai=True,
        project=config.project_id,
        location=config.vertex.location,
        credentials=Credentials(token=token),
    )


def access_token(args: argparse.Namespace) -> str:
    from_environment = os.environ.get(args.access_token_env, "").strip()
    if from_environment:
        return from_environment
    environment = os.environ.copy()
    if args.gcloud_config:
        environment["CLOUDSDK_CONFIG"] = str(args.gcloud_config)
    completed = subprocess.run(
        [str(args.gcloud_bin), "auth", "print-access-token"],
        cwd=ROOT,
        env=environment,
        check=True,
        capture_output=True,
        text=True,
        timeout=30,
    )
    token = completed.stdout.strip()
    if not token:
        raise RuntimeError("gcloud returned no access token")
    return token


def require_live_opt_in(config: RuntimeConfig, budget_usd: float) -> None:
    if os.environ.get("AGENDAFRAME_LIVE_TESTS") != "1":
        raise RuntimeError("live execution requires AGENDAFRAME_LIVE_TESTS=1")
    approved_project = os.environ.get("AGENDAFRAME_NONPROD_PROJECT_ID", "").strip()
    if approved_project != config.project_id:
        raise RuntimeError("live execution requires the explicit non-production project ID")
    if any(marker in config.project_id.lower() for marker in ("prod", "production")):
        raise RuntimeError("production project is not allowed for this pilot")
    if budget_usd <= 0 or budget_usd > config.estimated_daily_vertex_limit_usd:
        raise RuntimeError("budget exceeds the configured daily Vertex limit")


def worst_attempt_cost(config: RuntimeConfig, article: ArticleDocument) -> float:
    input_tokens = max(1, min(len(article.body_text or ""), config.vertex.max_input_characters_per_article) // 4)
    return (
        input_tokens / 1_000_000 * config.vertex.input_usd_per_million_tokens
        + config.vertex.max_output_tokens / 1_000_000 * config.vertex.output_usd_per_million_tokens
    )


def result_cost(config: RuntimeConfig, article: ArticleDocument, attempts: int, input_tokens: int | None, output_tokens: int | None) -> float:
    worst = worst_attempt_cost(config, article)
    prior_failures = max(0, attempts - 1) * worst
    final_input = input_tokens if input_tokens is not None else max(1, len(article.body_text or "") // 4)
    final_output = output_tokens if output_tokens is not None else config.vertex.max_output_tokens
    return prior_failures + final_input / 1_000_000 * config.vertex.input_usd_per_million_tokens + final_output / 1_000_000 * config.vertex.output_usd_per_million_tokens


def checkpoint_payload(
    config: RuntimeConfig,
    states: dict[str, str],
    failures: dict[str, dict[str, Any]],
    spent_usd: float,
) -> dict[str, Any]:
    return {
        "schema_version": 1,
        "target_date": TARGET_DATE.isoformat(),
        "model": config.vertex.model,
        "prompt_version": config.vertex.prompt_version,
        "analysis_schema_version": config.vertex.schema_version,
        "article_count": len(states),
        "states": states,
        "failures": failures,
        "estimated_spend_usd": round(spent_usd, 6),
        "raw_article_text_included": False,
    }


def prior_estimated_spend(path: Path, config: RuntimeConfig) -> float:
    if not path.exists():
        return 0.0
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        if (
            payload.get("model") == config.vertex.model
            and payload.get("prompt_version") == config.vertex.prompt_version
            and int(payload.get("analysis_schema_version")) == config.vertex.schema_version
        ):
            return max(0.0, float(payload.get("estimated_spend_usd", 0.0)))
    except (OSError, TypeError, ValueError, json.JSONDecodeError):
        pass
    return 0.0


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--live", action="store_true")
    parser.add_argument("--input-jsonl", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    parser.add_argument("--approval-directory", type=Path, default=DEFAULT_APPROVALS)
    parser.add_argument("--output-root", type=Path, default=DEFAULT_OUTPUT_ROOT)
    parser.add_argument("--checkpoint", type=Path, default=DEFAULT_CHECKPOINT)
    parser.add_argument("--article-id", action="append", dest="article_ids", default=[])
    parser.add_argument("--max-attempts", type=int, choices=(1, 2, 3))
    parser.add_argument("--budget-usd", type=float, default=0.25)
    parser.add_argument("--access-token-env", default="AGENDAFRAME_ACCESS_TOKEN")
    parser.add_argument("--gcloud-bin", type=Path, default=Path("gcloud"))
    parser.add_argument("--gcloud-config", type=Path)
    args = parser.parse_args(argv)

    try:
        config = RuntimeConfig.from_yaml(args.config)
        if args.max_attempts is not None:
            config = replace(
                config,
                vertex=replace(config.vertex, max_attempts=args.max_attempts),
            )
        articles = load_articles(args.input_jsonl)
        approvals = load_pilot_approvals(args.approval_directory)
        validation = validate_pilot_articles(articles, approvals)
        rank_by_article = {
            article_id: approval.rank
            for approval in approvals
            for article_id in approval.authorization.approved_articles
        }
        approval_by_article = {
            article_id: approval.authorization
            for approval in approvals
            for article_id in approval.authorization.approved_articles
        }
        first_pass_worst = sum(worst_attempt_cost(config, article) * min(config.vertex.max_attempts, 3) for article in articles)
        preflight = {
            "target_date": validation["target_date"],
            "agenda_count": validation["agenda_count"],
            "article_count": validation["article_count"],
            "rank_counts": PILOT_ARTICLE_COUNTS,
            "model": config.vertex.model,
            "prompt_version": config.vertex.prompt_version,
            "schema_version": config.vertex.schema_version,
            "first_pass_worst_case_usd": round(first_pass_worst, 6),
            "budget_usd": args.budget_usd,
            "raw_article_text_included": False,
        }
        if first_pass_worst > args.budget_usd:
            raise RuntimeError("first-pass worst-case cost exceeds the supplied budget")
        if not args.live:
            print(json.dumps({"mode": "preflight", **preflight}, ensure_ascii=False))
            return 0

        require_live_opt_in(config, args.budget_usd)
        client = make_client(config, access_token(args))
        analyzer = VertexFrameAnalyzer(config, client_factory=lambda _: client)
        states: dict[str, str] = {}
        failures: dict[str, dict[str, Any]] = {}
        pending: list[ArticleDocument] = []
        for article in articles:
            path = output_path(args.output_root, rank_by_article[article.article_id], article.article_id)
            if existing_success(path, article, config):
                states[article.article_id] = AnalysisState.SUCCEEDED.value
            else:
                states[article.article_id] = AnalysisState.QUEUED.value
                pending.append(article)
        if args.article_ids:
            requested_ids = set(args.article_ids)
            unknown_ids = requested_ids - {article.article_id for article in articles}
            if unknown_ids:
                raise ValueError("requested diagnostic article is outside the approved pilot")
            pending = [article for article in pending if article.article_id in requested_ids]

        spent_usd = prior_estimated_spend(args.checkpoint, config)
        for round_number in range(1, MAX_REDRIVE_ROUNDS + 1):
            if not pending:
                break
            failed: list[ArticleDocument] = []
            refresh_client = False
            for article in pending:
                maximum_call_cost = worst_attempt_cost(config, article) * min(config.vertex.max_attempts, 3)
                if spent_usd + maximum_call_cost > args.budget_usd:
                    states[article.article_id] = AnalysisState.RETRY_WAIT.value
                    failures[article.article_id] = {
                        "error_code": "budget_retry_wait",
                        "attempt_count": 0,
                    }
                    failed.append(article)
                    continue
                states[article.article_id] = AnalysisState.RUNNING.value
                result = analyzer.analyze(article)
                if result.error_code != "vertex_http_401":
                    spent_usd += result_cost(
                        config,
                        article,
                        max(1, result.attempt_count),
                        result.input_tokens,
                        result.output_tokens,
                    )
                else:
                    refresh_client = True
                authorization = approval_by_article[article.article_id]
                fingerprint = analysis_idempotency_fingerprint(
                    article,
                    model_id=config.vertex.model,
                    prompt_version=config.vertex.prompt_version,
                    schema_version=config.vertex.schema_version,
                    approval_lineage=authorization.public_lineage(),
                )
                if result.decision != "analyze":
                    states[article.article_id] = AnalysisState.REVIEW_NEEDED.value
                    failures[article.article_id] = {
                        "error_code": result.error_code or "review_needed",
                        "attempt_count": result.attempt_count,
                    }
                    failed.append(article)
                    continue
                result = replace(
                    result,
                    approval_lineage=authorization.public_lineage(),
                    analysis_state=AnalysisState.SUCCEEDED.value,
                    idempotency_fingerprint=fingerprint,
                )
                validate_frame_result(article, result)
                profile = public_profile(article, result)
                atomic_write_json(
                    output_path(args.output_root, rank_by_article[article.article_id], article.article_id),
                    {"articleId": article.article_id, "profile": profile},
                )
                states[article.article_id] = AnalysisState.SUCCEEDED.value
                failures.pop(article.article_id, None)
            pending = failed
            atomic_write_json(
                args.checkpoint,
                checkpoint_payload(config, states, failures, spent_usd),
            )
            if spent_usd >= args.budget_usd:
                break
            if refresh_client and pending and round_number < MAX_REDRIVE_ROUNDS:
                client = make_client(config, access_token(args))
                analyzer = VertexFrameAnalyzer(config, client_factory=lambda _: client)

        succeeded = sum(state == AnalysisState.SUCCEEDED.value for state in states.values())
        review_needed = len(states) - succeeded
        summary = {
            "mode": "live",
            **preflight,
            "rounds": round_number,
            "succeeded": succeeded,
            "review_needed": review_needed,
            "estimated_spend_usd": round(spent_usd, 6),
            "checkpoint": str(args.checkpoint),
        }
        print(json.dumps(summary, ensure_ascii=False))
        return 0 if succeeded == PILOT_ARTICLE_COUNT else 2
    except (OSError, RuntimeError, ValueError, subprocess.SubprocessError) as error:
        print(json.dumps({"mode": "error", "error_type": type(error).__name__}, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
