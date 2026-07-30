from __future__ import annotations

import argparse
import json
import os
from datetime import datetime
from pathlib import Path

from ai.framing import VertexFrameAnalyzer
from backend.config import RuntimeConfig
from backend.cost_guard import CostGuard
from backend.gcp_store import GcpAnalysisStore
from backend.pipeline import BatchPipeline
from backend.publisher import StructuredPublisher
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
    live.add_argument("--input-jsonl", type=Path, required=True)
    publish = subcommands.add_parser("publish")
    publish.add_argument("--limit", type=int, default=50)
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

    _require_live_opt_in(config)
    store = GcpAnalysisStore(config)
    if args.command == "publish":
        if args.limit < 1 or args.limit > config.vertex.max_articles_per_run:
            raise ValueError("Publish limit exceeds the reviewed per-run cap.")
        origin = os.environ["AGENDAFRAME_SITE_ORIGIN"]
        token = os.environ["AGENDAFRAME_IMPORT_TOKEN"]
        rows = store.pending_publication_rows(args.limit)
        if not rows:
            print(json.dumps({"received": 0, "published": 0}, ensure_ascii=False))
            return 0
        analysis_keys = [str(row.pop("analysis_key")) for row in rows]
        response = StructuredPublisher(
            origin,
            config.publication_endpoint_path,
            token,
        ).publish(rows)
        store.mark_published(analysis_keys)
        print(
            json.dumps(
                {"received": len(rows), "published": len(rows), "site": response},
                ensure_ascii=False,
            )
        )
        return 0

    articles = _read_articles(args.input_jsonl)
    pipeline = BatchPipeline(
        config=config,
        policies=policies,
        analyzer=VertexFrameAnalyzer(config),
        store=store,
    )
    print(json.dumps(pipeline.run(articles), ensure_ascii=False))
    return 0


def _require_live_opt_in(config: RuntimeConfig) -> None:
    if os.getenv("AGENDAFRAME_LIVE_TESTS") != "1":
        raise RuntimeError("Live GCP calls require AGENDAFRAME_LIVE_TESTS=1.")
    configured_project = os.getenv("GOOGLE_CLOUD_PROJECT")
    if configured_project != config.project_id:
        raise RuntimeError("GOOGLE_CLOUD_PROJECT must match the reviewed runtime config.")
    if "prod" in config.project_id.lower():
        raise RuntimeError("Live tests must not target a production project.")


def _read_articles(path: Path) -> list[ArticleDocument]:
    records: list[ArticleDocument] = []
    for raw_line in path.read_text(encoding="utf-8").splitlines():
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


if __name__ == "__main__":
    raise SystemExit(main())
