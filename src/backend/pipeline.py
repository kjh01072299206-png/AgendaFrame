from __future__ import annotations

from dataclasses import replace
from typing import Protocol
from urllib.parse import urlsplit

from ai.framing import FrameAnalyzer, FrameResult, validate_frame_result
from backend.config import RuntimeConfig
from backend.cost_guard import CostGuard
from crawler.authorization import DatasetAnalysisAuthorization
from crawler.models import ArticleDocument, is_domain_allowed
from crawler.policy import SourcePolicyRegistry


class AnalysisStore(Protocol):
    def already_analyzed(self, analysis_key: str) -> bool: ...

    def analyzed_today_count(self) -> int: ...

    def save_result(
        self,
        article: ArticleDocument,
        result: FrameResult,
        analysis_key: str,
        retain_body: bool,
        delete_on: str,
    ) -> None: ...


class BatchPipeline:
    def __init__(
        self,
        config: RuntimeConfig,
        policies: SourcePolicyRegistry,
        analyzer: FrameAnalyzer,
        store: AnalysisStore,
        dataset_authorization: DatasetAnalysisAuthorization | None = None,
    ) -> None:
        self.config = config
        self.policies = policies
        self.analyzer = analyzer
        self.store = store
        self.dataset_authorization = dataset_authorization
        self.cost_guard = CostGuard(config)

    def run(self, articles: list[ArticleDocument]) -> dict[str, object]:
        candidates: list[tuple[ArticleDocument, str, bool]] = []
        deferred = 0
        duplicates = 0
        dataset_authorized = 0
        for article in articles:
            policy = self.policies.require(article.source_id)
            hostname = urlsplit(article.canonical_url).hostname or ""
            if not is_domain_allowed(hostname, policy.domains):
                raise ValueError(
                    f"Article URL domain does not match source policy: {article.source_id}"
                )
            authorized_by_dataset = bool(
                self.dataset_authorization
                and self.dataset_authorization.allows(article)
            )
            if (
                not article.body_text
                or (not policy.body_processing_allowed and not authorized_by_dataset)
            ):
                deferred += 1
                continue
            analysis_key = article.analysis_key(self.config.vertex.prompt_version)
            if self.store.already_analyzed(analysis_key):
                duplicates += 1
                continue
            if authorized_by_dataset:
                dataset_authorized += 1
            candidates.append(
                (
                    article,
                    analysis_key,
                    policy.body_retention_allowed and not authorized_by_dataset,
                )
            )

        self.cost_guard.enforce_run(
            [len(article.body_text or "") for article, _, _ in candidates],
            self.store.analyzed_today_count(),
        )
        results = []
        for article, analysis_key, retain_body in candidates:
            result = self.analyzer.analyze(article)
            if (
                self.dataset_authorization
                and self.dataset_authorization.allows(article)
            ):
                result = replace(
                    result,
                    approval_lineage=self.dataset_authorization.public_lineage(),
                )
            validate_frame_result(article, result)
            self.store.save_result(
                article,
                result,
                analysis_key,
                retain_body=retain_body,
                delete_on=self.config.delete_all_bodies_on,
            )
            results.append(
                {
                    "article_id": result.article_id,
                    "decision": result.decision,
                    "model_id": result.model_id,
                    "prompt_version": result.prompt_version,
                    "schema_version": result.schema_version,
                    "input_tokens": result.input_tokens,
                    "output_tokens": result.output_tokens,
                }
            )
        return {
            "received": len(articles),
            "analyzed": len(results),
            "deferred_by_policy": deferred,
            "dataset_authorized": dataset_authorized,
            "skipped_duplicate": duplicates,
            "results": results,
        }
