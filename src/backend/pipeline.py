from __future__ import annotations

from dataclasses import asdict
from typing import Protocol

from ai.framing import FrameAnalyzer, FrameResult, validate_frame_result
from backend.config import RuntimeConfig
from backend.cost_guard import CostGuard
from crawler.models import ArticleDocument
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
    ) -> None:
        self.config = config
        self.policies = policies
        self.analyzer = analyzer
        self.store = store
        self.cost_guard = CostGuard(config)

    def run(self, articles: list[ArticleDocument]) -> dict[str, object]:
        candidates: list[tuple[ArticleDocument, str]] = []
        deferred = 0
        duplicates = 0
        for article in articles:
            policy = self.policies.require(article.source_id)
            if not policy.body_processing_allowed or not article.body_text:
                deferred += 1
                continue
            analysis_key = article.analysis_key(self.config.vertex.prompt_version)
            if self.store.already_analyzed(analysis_key):
                duplicates += 1
                continue
            candidates.append((article, analysis_key))

        self.cost_guard.enforce_run(
            [len(article.body_text or "") for article, _ in candidates],
            self.store.analyzed_today_count(),
        )
        results = []
        for article, analysis_key in candidates:
            policy = self.policies.require(article.source_id)
            result = self.analyzer.analyze(article)
            validate_frame_result(article, result)
            self.store.save_result(
                article,
                result,
                analysis_key,
                retain_body=policy.body_retention_allowed,
                delete_on=self.config.delete_all_bodies_on,
            )
            results.append(asdict(result))
        return {
            "received": len(articles),
            "analyzed": len(results),
            "deferred_by_policy": deferred,
            "skipped_duplicate": duplicates,
            "results": results,
        }
