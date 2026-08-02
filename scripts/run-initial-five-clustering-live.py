"""Run the bounded initial-five metadata-only Gemini clustering job.

The default mode is a local preflight and never contacts an external service.
Live execution requires both ``--live`` and ``AGENDAFRAME_LIVE_TESTS=1``. The
runner reads only the four metadata fields needed by the cluster prompt from
the prepared JSONL records; the source records are never written back, logged,
or included in a request. Candidate groups are loaded separately and are used
only after the model response for the approval reconciliation.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping, Sequence

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from ai.issue_clustering import (  # noqa: E402
    INITIAL_FIVE_MAX_OUTPUT_TOKENS,
    InitialFiveClusterer,
    MetadataArticle,
    MetadataIssueGroup,
    build_initial_five_approval_manifest,
    to_metadata_clusters_public_shape,
)
from backend.config import RuntimeConfig  # noqa: E402

BASIS_DATE = "2026-07-26"
MAX_ARTICLES = 25
METADATA_KEYS = ("article_id", "title", "source_id", "published_at")
DEFAULT_INPUT = ROOT / "tmp" / "initial-five-prepared" / "articles.jsonl"
DEFAULT_APPROVALS = ROOT / "config" / "analysis-approvals"
DEFAULT_CANDIDATE_METADATA = ROOT / "site" / "data" / "metadata-clusters-2026-07-26.json"
DEFAULT_TOP5 = ROOT / "site" / "data" / "top5-2026-07-26.json"
DEFAULT_OUTPUT = ROOT / "tmp" / "initial-five-prepared" / "initial-five-clustering-result.json"
DEFAULT_APPROVAL_OUTPUT = ROOT / "tmp" / "initial-five-prepared" / "initial-five-clustering-approval.json"
DEFAULT_PUBLIC_OUTPUT = ROOT / "tmp" / "initial-five-prepared" / "metadata-clusters-2026-07-26-ai.json"


def main(argv: Sequence[str] | None = None) -> int:
    args = _parse_args(argv)
    try:
        config = RuntimeConfig.from_yaml(args.config)
        articles = load_metadata_articles(args.input_jsonl)
        candidate_groups = load_candidate_groups(
            articles,
            args.candidate_approvals,
            args.candidate_metadata,
        )
        preflight = build_preflight_summary(config, articles, candidate_groups, args.budget_usd)
        if not args.live:
            print(json.dumps({"mode": "preflight", **preflight}, ensure_ascii=False))
            return 0

        require_live_opt_in()
        validate_non_production_project(config.project_id)
        token = load_access_token(args)
        client = make_live_client(config, token)
        result = InitialFiveClusterer(
            config,
            client_factory=lambda _: client,
            max_attempts=3,
        ).analyze(articles, candidate_groups)
        generated_at = datetime.now(timezone.utc).isoformat()
        write_json(args.output, result.as_dict())
        write_json(
            args.approval_output,
            build_initial_five_approval_manifest(result, generated_at=generated_at),
        )
        write_json(
            args.public_output,
            to_metadata_clusters_public_shape(
                result,
                basis_date=BASIS_DATE,
                generated_at=generated_at,
            ),
        )
        print(
            json.dumps(
                {
                    "mode": "live",
                    **preflight,
                    "analysis_state": result.analysis_state,
                    "approval_status": result.approval_status,
                    "attempts": result.attempts,
                    "mismatch_count": len(result.mismatches),
                    "result_output": str(args.output),
                    "approval_output": str(args.approval_output),
                    "public_output": str(args.public_output),
                },
                ensure_ascii=False,
            )
        )
        return 0 if result.approval_status == "approved_same_event" else 2
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
        # Never print exception text from an SDK response: it can contain
        # request metadata or credentials. The category is sufficient for the
        # bounded operator handoff.
        print(
            json.dumps(
                {"mode": "error", "error_type": type(error).__name__},
                ensure_ascii=False,
            ),
            file=sys.stderr,
        )
        return 1


def load_metadata_articles(path: Path) -> tuple[MetadataArticle, ...]:
    """Load only prompt metadata from each prepared JSONL record.

    This function intentionally projects a fixed allow-list immediately after
    parsing each JSON object. No other source-record field is read by the
    application logic or passed to the AI client.
    """

    records: list[MetadataArticle] = []
    for line_number, raw_line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not raw_line.strip():
            continue
        try:
            row = json.loads(raw_line)
        except json.JSONDecodeError as error:
            raise ValueError(f"invalid JSON at line {line_number}") from error
        if not isinstance(row, dict):
            raise ValueError(f"record at line {line_number} is not an object")
        try:
            metadata = {key: row[key] for key in METADATA_KEYS}
        except KeyError as error:
            raise ValueError(f"metadata field missing at line {line_number}") from error
        if not all(isinstance(value, str) and value.strip() for value in metadata.values()):
            raise ValueError(f"metadata field invalid at line {line_number}")
        records.append(
            MetadataArticle(
                article_id=metadata["article_id"],
                title=metadata["title"],
                source=metadata["source_id"],
                published_at=metadata["published_at"],
            )
        )
    if len(records) != MAX_ARTICLES:
        raise ValueError(f"initial-five input must contain exactly {MAX_ARTICLES} metadata records")
    if len({article.article_id for article in records}) != len(records):
        raise ValueError("initial-five article IDs must be unique")
    return tuple(records)


def load_candidate_groups(
    articles: Sequence[MetadataArticle],
    approvals_dir: Path,
    candidate_metadata_path: Path,
    top5_path: Path = DEFAULT_TOP5,
) -> tuple[MetadataIssueGroup, ...]:
    """Load the five deterministic candidate partitions without sending them to AI."""

    article_by_id = {article.article_id: article for article in articles}
    titles = _load_candidate_titles(candidate_metadata_path)
    public_issue_ids = _load_public_issue_ids(top5_path)
    groups: list[MetadataIssueGroup] = []
    seen_ids: set[str] = set()
    for rank in range(1, 6):
        approval_path = _find_approval_path(approvals_dir, rank)
        payload = _read_json_object(approval_path)
        approval_cluster_id = _required_text(payload.get("cluster_id"), "cluster_id")
        cluster_id = public_issue_ids.get(rank, approval_cluster_id)
        if cluster_id in seen_ids:
            raise ValueError("candidate cluster IDs must be unique")
        seen_ids.add(cluster_id)
        approved_articles = payload.get("approved_articles")
        if not isinstance(approved_articles, dict) or not approved_articles:
            raise ValueError("candidate approval has no article metadata")
        ids = list(approved_articles)
        if any(article_id not in article_by_id for article_id in ids):
            raise ValueError("candidate approval references an article outside the input")
        groups.append(
            MetadataIssueGroup(
                issue_id=cluster_id,
                issue_title=titles.get(rank, cluster_id),
                articles=tuple(article_by_id[article_id] for article_id in ids),
            )
        )

    candidate_ids = [
        article.article_id for group in groups for article in group.articles
    ]
    if len(candidate_ids) != MAX_ARTICLES or len(set(candidate_ids)) != MAX_ARTICLES:
        raise ValueError("candidate approvals must form a disjoint 25-article partition")
    return tuple(groups)


def build_preflight_summary(
    config: RuntimeConfig,
    articles: Sequence[MetadataArticle],
    candidate_groups: Sequence[MetadataIssueGroup],
    budget_usd: float,
) -> dict[str, Any]:
    if len(articles) != MAX_ARTICLES:
        raise ValueError("the initial-five run is limited to 25 articles")
    if len(candidate_groups) != 5:
        raise ValueError("the initial-five run requires five candidate clusters")
    if budget_usd <= 0:
        raise ValueError("budget must be positive")
    if budget_usd > config.estimated_daily_vertex_limit_usd:
        raise ValueError("budget must not exceed the configured daily Vertex limit")
    metadata_characters = sum(
        len(article.article_id) + len(article.title) + len(article.source) + len(article.published_at)
        for article in articles
    )
    input_tokens = max(1, metadata_characters // 4)
    output_tokens = INITIAL_FIVE_MAX_OUTPUT_TOKENS
    estimated_cost = (
        input_tokens / 1_000_000 * config.vertex.input_usd_per_million_tokens
        + output_tokens / 1_000_000 * config.vertex.output_usd_per_million_tokens
    )
    if estimated_cost > budget_usd:
        raise ValueError("estimated run cost exceeds the supplied budget")
    return {
        "project_id": config.project_id,
        "model": config.vertex.model,
        "article_count": len(articles),
        "candidate_cluster_count": len(candidate_groups),
        "text_scope": "title_source_published_at_only",
        "metadata_characters": metadata_characters,
        "estimated_cost_usd": round(estimated_cost, 6),
        "budget_usd": budget_usd,
        "external_call": False,
    }


def require_live_opt_in() -> None:
    if os.environ.get("AGENDAFRAME_LIVE_TESTS") != "1":
        raise RuntimeError("live execution requires AGENDAFRAME_LIVE_TESTS=1")


def validate_non_production_project(project_id: str) -> None:
    normalized = project_id.strip().lower()
    if not normalized or any(marker in normalized for marker in ("prod", "production")):
        raise RuntimeError("live clustering requires a non-production project")
    approved_project = os.environ.get("AGENDAFRAME_NONPROD_PROJECT_ID")
    if approved_project and approved_project != project_id:
        raise RuntimeError("configured project is not the approved non-production project")


def load_access_token(args: argparse.Namespace) -> str:
    token = os.environ.get(args.access_token_env, "").strip()
    if token:
        return token
    gcloud = args.gcloud_bin
    command = [gcloud, "auth", "print-access-token"]
    env = os.environ.copy()
    if args.gcloud_config:
        env["CLOUDSDK_CONFIG"] = str(args.gcloud_config)
    completed = subprocess.run(
        command,
        cwd=ROOT,
        env=env,
        check=True,
        capture_output=True,
        text=True,
        timeout=30,
    )
    token = completed.stdout.strip()
    if not token:
        raise RuntimeError("gcloud returned no access token")
    return token


def make_live_client(config: RuntimeConfig, access_token: str) -> Any:
    from google import genai
    from google.oauth2.credentials import Credentials

    credentials = Credentials(token=access_token)
    return genai.Client(
        vertexai=True,
        project=config.project_id,
        location=config.vertex.location,
        credentials=credentials,
    )


def write_json(path: Path, payload: Mapping[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def _load_candidate_titles(path: Path) -> dict[int, str]:
    if not path.exists():
        return {}
    payload = _read_json_object(path)
    clusters = payload.get("clusters")
    if not isinstance(clusters, list):
        return {}
    titles: dict[int, str] = {}
    for rank, cluster in enumerate(clusters[:5], 1):
        if isinstance(cluster, dict) and isinstance(cluster.get("issue_title"), str):
            titles[rank] = cluster["issue_title"]
    return titles


def _load_public_issue_ids(path: Path) -> dict[int, str]:
    if not path.exists():
        return {}
    payload = _read_json_object(path)
    issues = payload.get("issues")
    if not isinstance(issues, list):
        return {}
    result: dict[int, str] = {}
    for issue in issues[:5]:
        if not isinstance(issue, dict):
            continue
        rank = issue.get("rank")
        issue_id = issue.get("issueId")
        if isinstance(rank, int) and isinstance(issue_id, str) and issue_id.strip():
            result[rank] = issue_id.strip()
    return result


def _find_approval_path(directory: Path, rank: int) -> Path:
    candidates = (
        directory / f"{BASIS_DATE}-rank-{rank}-pilot.json",
        directory / f"{BASIS_DATE}-rank-{rank}.json",
    )
    for candidate in candidates:
        if candidate.exists():
            return candidate
    raise OSError(f"candidate approval for rank {rank} is missing")


def _read_json_object(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("JSON artifact must be an object")
    return payload


def _required_text(value: Any, field_name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field_name} is required")
    return value.strip()


def _parse_args(argv: Sequence[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--live", action="store_true", help="run the bounded external Gemini call")
    parser.add_argument("--config", type=Path, default=ROOT / "config" / "gcp-runtime.yaml")
    parser.add_argument("--input-jsonl", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--candidate-approvals", type=Path, default=DEFAULT_APPROVALS)
    parser.add_argument("--candidate-metadata", type=Path, default=DEFAULT_CANDIDATE_METADATA)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--approval-output", type=Path, default=DEFAULT_APPROVAL_OUTPUT)
    parser.add_argument("--public-output", type=Path, default=DEFAULT_PUBLIC_OUTPUT)
    parser.add_argument("--budget-usd", type=float, default=0.25)
    parser.add_argument("--access-token-env", default="AGENDAFRAME_ACCESS_TOKEN")
    parser.add_argument("--gcloud-bin", default="gcloud")
    parser.add_argument("--gcloud-config", type=Path)
    args = parser.parse_args(argv)
    for attribute in (
        "config",
        "input_jsonl",
        "candidate_approvals",
        "candidate_metadata",
    ):
        setattr(args, attribute, _resolve_path(getattr(args, attribute)))
    for attribute in ("output", "approval_output", "public_output"):
        setattr(args, attribute, _resolve_path(getattr(args, attribute), must_exist=False))
    if args.gcloud_config:
        args.gcloud_config = _resolve_path(args.gcloud_config, must_exist=False)
    return args


def _resolve_path(path: Path, *, must_exist: bool = True) -> Path:
    resolved = path if path.is_absolute() else ROOT / path
    resolved = resolved.resolve()
    if must_exist and not resolved.exists():
        raise OSError("required input path is missing")
    return resolved


if __name__ == "__main__":
    raise SystemExit(main())
