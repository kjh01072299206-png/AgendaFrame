from __future__ import annotations

import argparse
import json
import os
from datetime import datetime
from pathlib import Path
from urllib.parse import urlsplit

from ai.framing import VertexFrameAnalyzer
from backend.config import RuntimeConfig
from backend.cost_guard import CostGuard
from backend.gcp_store import GcpAnalysisStore
from backend.pilot import load_pilot_approvals, validate_pilot_articles
from backend.pipeline import BatchPipeline
from backend.publisher import StructuredPublisher
from crawler.authorization import DatasetAnalysisAuthorization
from crawler.models import ArticleDocument, canonicalize_url
from crawler.policy import SourcePolicyRegistry


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="AgendaFrame GCP batch pipeline")
    parser.add_argument(
        "--config",
        default=os.getenv("AGENDAFRAME_RUNTIME_CONFIG", "config/gcp-runtime.yaml"),
    )
    parser.add_argument(
        "--source-policy",
        default=os.getenv("AGENDAFRAME_SOURCE_POLICY", "config/source-policies.yaml"),
    )
    subcommands = parser.add_subparsers(dest="command", required=True)
    subcommands.add_parser("validate-config")
    estimate = subcommands.add_parser("estimate-cost")
    estimate.add_argument("--articles", type=int, required=True)
    estimate.add_argument("--characters-per-article", type=int, required=True)
    live = subcommands.add_parser("live-run")
    live_input = live.add_mutually_exclusive_group(required=True)
    live_input.add_argument("--input-jsonl", type=Path)
    live_input.add_argument("--input-gcs-uri")
    live_authorization = live.add_mutually_exclusive_group()
    live_authorization.add_argument("--authorization-json", type=Path)
    live_authorization.add_argument("--authorization-gcs-uri")
    live.add_argument(
        "--resume",
        action="store_true",
        help="Re-drive only review-needed or retry-wait articles; never re-run successes.",
    )
    publish = subcommands.add_parser("publish")
    publish.add_argument("--limit", type=int, default=50)
    publish.add_argument("--date")
    publish.add_argument("--analyze-date")
    publish.add_argument("--cluster-approval-json", type=Path)
    status = subcommands.add_parser("status")
    status.add_argument("--date", default="2026-07-26")
    status.add_argument("--article-id", action="append", dest="article_ids", default=[])
    pilot = subcommands.add_parser("validate-pilot")
    pilot.add_argument("--input-jsonl", type=Path, required=True)
    pilot.add_argument(
        "--approval-directory",
        type=Path,
        default=Path("config/analysis-approvals"),
    )
    return parser


def main() -> int:
    args = build_parser().parse_args()
    config = RuntimeConfig.from_yaml(args.config)
    policies = SourcePolicyRegistry.from_yaml(args.source_policy)
    if args.command == "validate-config":
        print(
            json.dumps(
                {
                    "project_id": config.project_id,
                    "region": config.region,
                    "source_policy_version": policies.policy_version,
                    "registered_sources": len(policies.all()),
                    "body_processing_sources": sum(
                        policy.body_processing_allowed for policy in policies.all()
                    ),
                },
                ensure_ascii=False,
            )
        )
        return 0
    if args.command == "estimate-cost":
        estimate = CostGuard(config).estimate([args.characters_per_article] * args.articles)
        print(json.dumps(estimate.__dict__, ensure_ascii=False))
        return 0
    if args.command == "validate-pilot":
        approvals = load_pilot_approvals(args.approval_directory)
        articles = _read_articles(args.input_jsonl)
        summary = validate_pilot_articles(articles, approvals)
        print(json.dumps(summary, ensure_ascii=False))
        return 0

    _require_live_opt_in(config)
    store = GcpAnalysisStore(config)
    if args.command == "status":
        datetime.fromisoformat(args.date)
        summary = store.status_summary(
            article_ids=list(args.article_ids),
            target_date=args.date,
        )
        print(json.dumps(summary, ensure_ascii=False))
        return 0
    if args.command == "publish":
        if args.limit < 1 or args.limit > config.vertex.max_articles_per_run:
            raise ValueError("Publish limit exceeds the reviewed per-run cap.")
        origin = os.environ["AGENDAFRAME_SITE_ORIGIN"]
        token = os.environ["AGENDAFRAME_IMPORT_TOKEN"]
        cluster_approval = (
            DatasetAnalysisAuthorization.from_path(args.cluster_approval_json)
            if args.cluster_approval_json
            else None
        )
        if cluster_approval and not args.analyze_date:
            raise ValueError("--cluster-approval-json requires --analyze-date.")
        if cluster_approval and args.limit < len(cluster_approval.approved_articles):
            raise ValueError("Publish limit is smaller than the approved comparison cluster.")
        for value in (args.date, args.analyze_date):
            if value:
                datetime.fromisoformat(value)
        rows = store.pending_publication_rows(
            args.limit,
            target_date=args.date,
            article_ids=(sorted(cluster_approval.approved_articles) if cluster_approval else None),
        )
        if not rows:
            if cluster_approval:
                raise ValueError("No pending analysis rows match the approved comparison cluster.")
            print(json.dumps({"received": 0, "published": 0}, ensure_ascii=False))
            return 0
        if cluster_approval:
            _validate_publication_rows_against_approval(rows, cluster_approval)
        analysis_keys = [str(row.pop("analysis_key")) for row in rows]
        publisher = StructuredPublisher(
            origin,
            config.publication_endpoint_path,
            token,
        )
        response = publisher.publish(rows)
        analysis_response = None
        if args.analyze_date:
            approved_clusters = None
            if cluster_approval:
                approved_clusters = [cluster_approval.publication_cluster()]
            analysis_response = publisher.analyze(
                args.analyze_date,
                approved_same_event_clusters=approved_clusters,
            )
        store.mark_published(analysis_keys)
        print(
            json.dumps(
                {
                    "received": len(rows),
                    "published": len(rows),
                    "site": response,
                    "analysis": analysis_response,
                },
                ensure_ascii=False,
            )
        )
        return 0

    authorization = None
    try:
        input_text = _read_input_text(
            local_path=args.input_jsonl,
            gcs_uri=args.input_gcs_uri,
            config=config,
        )
        authorization = _read_dataset_authorization(
            local_path=args.authorization_json,
            gcs_uri=args.authorization_gcs_uri,
            config=config,
        )
        articles = _read_articles_text(input_text)
        pipeline = BatchPipeline(
            config=config,
            policies=policies,
            analyzer=VertexFrameAnalyzer(config),
            store=store,
            dataset_authorization=authorization,
        )
        result = pipeline.run(articles, resume=args.resume)
    finally:
        _delete_transient_gcs_inputs(
            (args.input_gcs_uri, args.authorization_gcs_uri),
            config,
        )
    if authorization:
        result["dataset_authorization_fingerprint"] = authorization.fingerprint
    result["transient_gcs_inputs_deleted"] = bool(args.input_gcs_uri)
    print(json.dumps(result, ensure_ascii=False))
    return 0


def _validate_publication_rows_against_approval(
    rows: list[dict[str, object]],
    approval: DatasetAnalysisAuthorization,
) -> None:
    rows_by_id: dict[str, dict[str, object]] = {}
    for row in rows:
        article = row.get("article")
        profile = row.get("profile")
        if not isinstance(article, dict) or not isinstance(profile, dict):
            raise ValueError("Pending publication row is missing article or profile data.")
        article_id = str(article.get("article_id") or "")
        if not article_id or article_id in rows_by_id:
            raise ValueError("Pending publication rows contain an invalid article ID.")
        rows_by_id[article_id] = row
    if set(rows_by_id) != set(approval.approved_articles):
        raise ValueError("Pending publication rows do not match the approved article set.")

    expected_lineage = approval.public_lineage()
    for article_id, binding in approval.approved_articles.items():
        row = rows_by_id[article_id]
        article = row["article"]
        profile = row["profile"]
        assert isinstance(article, dict)
        assert isinstance(profile, dict)
        if (
            str(article.get("source_id") or "") != binding.source_id
            or canonicalize_url(str(article.get("canonical_url") or "")) != binding.canonical_url
            or str(article.get("body_hash") or "") != binding.body_sha256
        ):
            raise ValueError("Pending publication row does not match its approved binding.")
        lineage = profile.get("lineage")
        if not isinstance(lineage, dict) or lineage.get("approval") != expected_lineage:
            raise ValueError("Pending publication row is missing the approved analysis lineage.")


def _require_live_opt_in(config: RuntimeConfig) -> None:
    if os.getenv("AGENDAFRAME_LIVE_TESTS") != "1":
        raise RuntimeError("Live GCP calls require AGENDAFRAME_LIVE_TESTS=1.")
    configured_project = os.getenv("GOOGLE_CLOUD_PROJECT")
    if configured_project != config.project_id:
        raise RuntimeError("GOOGLE_CLOUD_PROJECT must match the reviewed runtime config.")
    if "prod" in config.project_id.lower():
        raise RuntimeError("Live tests must not target a production project.")


def _read_articles(path: Path) -> list[ArticleDocument]:
    return _read_articles_text(path.read_text(encoding="utf-8"))


def _read_articles_text(text: str) -> list[ArticleDocument]:
    records: list[ArticleDocument] = []
    for raw_line in text.splitlines():
        if not raw_line.strip():
            continue
        value = json.loads(raw_line)
        records.append(
            ArticleDocument(
                article_id=value["article_id"],
                source_id=value["source_id"],
                canonical_url=canonicalize_url(value["canonical_url"]),
                title=value["title"],
                published_at=datetime.fromisoformat(value["published_at"]),
                collected_at=datetime.fromisoformat(value["collected_at"]),
                section=value.get("section"),
                body_text=value.get("body_text"),
                text_scope=value["text_scope"],
            )
        )
    return records


def _read_dataset_authorization(
    *,
    local_path: Path | None,
    gcs_uri: str | None,
    config: RuntimeConfig,
) -> DatasetAnalysisAuthorization | None:
    if not local_path and not gcs_uri:
        return None
    text = _read_input_text(local_path=local_path, gcs_uri=gcs_uri, config=config)
    return DatasetAnalysisAuthorization.from_json_text(text)


def _read_input_text(
    *,
    local_path: Path | None,
    gcs_uri: str | None,
    config: RuntimeConfig,
) -> str:
    if local_path:
        return local_path.read_text(encoding="utf-8")
    if not gcs_uri:
        raise ValueError("A local path or private GCS URI is required.")
    bucket_name, object_name = _private_gcs_parts(gcs_uri, config)
    from google.cloud import storage

    client = storage.Client(project=config.project_id)
    return client.bucket(bucket_name).blob(object_name).download_as_text(encoding="utf-8")


def _delete_private_gcs_object(uri: str, config: RuntimeConfig) -> None:
    bucket_name, object_name = _private_gcs_parts(uri, config)
    from google.cloud import storage

    client = storage.Client(project=config.project_id)
    client.bucket(bucket_name).blob(object_name).delete()


def _delete_transient_gcs_inputs(
    uris: tuple[str | None, ...],
    config: RuntimeConfig,
) -> None:
    failures: list[str] = []
    for uri in uris:
        if not uri:
            continue
        try:
            _delete_private_gcs_object(uri, config)
        except Exception as error:  # cleanup must try every reviewed input
            failures.append(f"{uri}: {type(error).__name__}")
    if failures:
        raise RuntimeError("Transient GCS input cleanup failed: " + ", ".join(failures))


def _private_gcs_parts(uri: str, config: RuntimeConfig) -> tuple[str, str]:
    parsed = urlsplit(uri)
    bucket_name = parsed.netloc
    object_name = parsed.path.lstrip("/")
    if parsed.scheme != "gs" or bucket_name != config.bucket or not object_name:
        raise ValueError("Live inputs must use the reviewed private AgendaFrame bucket.")
    if not object_name.startswith("transient-inputs/"):
        raise ValueError("Live inputs must stay under transient-inputs/.")
    return bucket_name, object_name


if __name__ == "__main__":
    raise SystemExit(main())
