from __future__ import annotations

from dataclasses import replace
from typing import Protocol
from urllib.parse import urlsplit

from ai.framing import FrameAnalyzer, FrameResult, validate_frame_result
from backend.analysis_state import (
    AnalysisState,
    analysis_idempotency_fingerprint,
    max_total_attempts,
)
from backend.config import RuntimeConfig
from backend.cost_guard import CostGuard
from crawler.authorization import DatasetAnalysisAuthorization
from crawler.models import ArticleDocument, is_domain_allowed
from crawler.policy import SourcePolicyRegistry


class AnalysisStore(Protocol):
    def already_analyzed(self, analysis_key: str) -> bool: ...

    def current_state(self, analysis_key: str) -> AnalysisState | None: ...

    def attempt_count(self, analysis_key: str) -> int: ...

    def mark_state(
        self,
        analysis_key: str,
        article_id: str,
        state: AnalysisState,
        *,
        attempt_count: int,
        error_code: str | None = None,
        next_attempt_at: str | None = None,
    ) -> None: ...

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

    def run(
        self,
        articles: list[ArticleDocument],
        *,
        resume: bool = False,
    ) -> dict[str, object]:
        candidates: list[tuple[ArticleDocument, str, bool, dict[str, str] | None]] = []
        deferred = 0
        duplicates = 0
        skipped_in_progress = 0
        skipped_dead_letter = 0
        redriven = 0
        dataset_authorized = 0
        for article in articles:
            policy = self.policies.require(article.source_id)
            hostname = urlsplit(article.canonical_url).hostname or ""
            if not is_domain_allowed(hostname, policy.domains):
                raise ValueError(
                    f"Article URL domain does not match source policy: {article.source_id}"
                )
            authorized_by_dataset = bool(
                self.dataset_authorization and self.dataset_authorization.allows(article)
            )
            if not article.body_text or (
                not policy.body_processing_allowed and not authorized_by_dataset
            ):
                deferred += 1
                continue
            approval_lineage = (
                self.dataset_authorization.public_lineage()
                if authorized_by_dataset and self.dataset_authorization
                else None
            )
            analysis_key = analysis_idempotency_fingerprint(
                article,
                model_id=self.config.vertex.model,
                prompt_version=self.config.vertex.prompt_version,
                schema_version=self.config.vertex.schema_version,
                approval_lineage=approval_lineage,
            )
            current_state = self.store.current_state(analysis_key)
            if current_state is None and self.store.already_analyzed(analysis_key):
                current_state = AnalysisState.SUCCEEDED
            if current_state is AnalysisState.SUCCEEDED:
                duplicates += 1
                continue
            if current_state is AnalysisState.DEAD_LETTER:
                skipped_dead_letter += 1
                continue
            if current_state in {AnalysisState.QUEUED, AnalysisState.RUNNING}:
                skipped_in_progress += 1
                continue
            if resume and current_state not in {
                None,
                AnalysisState.RETRY_WAIT,
                AnalysisState.REVIEW_NEEDED,
            }:
                skipped_in_progress += 1
                continue
            if current_state in {AnalysisState.RETRY_WAIT, AnalysisState.REVIEW_NEEDED}:
                redriven += 1
            if authorized_by_dataset:
                dataset_authorized += 1
            candidates.append(
                (
                    article,
                    analysis_key,
                    policy.body_retention_allowed and not authorized_by_dataset,
                    approval_lineage,
                )
            )

        self.cost_guard.enforce_run(
            [len(article.body_text or "") for article, _, _, _ in candidates],
            self.store.analyzed_today_count(),
        )
        for article, analysis_key, _, _ in candidates:
            self.store.mark_state(
                analysis_key,
                article.article_id,
                AnalysisState.QUEUED,
                attempt_count=self.store.attempt_count(analysis_key),
            )
        results = []
        maximum_attempts = max_total_attempts(self.config.vertex.max_attempts)
        for article, analysis_key, retain_body, approval_lineage in candidates:
            previous_attempts = self.store.attempt_count(analysis_key)
            self.store.mark_state(
                analysis_key,
                article.article_id,
                AnalysisState.RUNNING,
                attempt_count=previous_attempts,
            )
            result = self.analyzer.analyze(article)
            call_attempts = max(1, result.attempt_count)
            total_attempts = previous_attempts + call_attempts
            if result.decision == "analyze":
                final_state = AnalysisState.SUCCEEDED
            elif total_attempts >= maximum_attempts:
                final_state = AnalysisState.DEAD_LETTER
            elif result.retryable_failure:
                final_state = AnalysisState.RETRY_WAIT
            else:
                final_state = AnalysisState.REVIEW_NEEDED
            result = replace(
                result,
                approval_lineage=approval_lineage,
                analysis_state=final_state.value,
                attempt_count=total_attempts,
                idempotency_fingerprint=analysis_key,
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
                    "analysis_state": final_state.value,
                    "attempt_count": total_attempts,
                    "idempotency_fingerprint": analysis_key,
                    "error_code": result.error_code,
                }
            )
        return {
            "received": len(articles),
            "analyzed": len(results),
            "deferred_by_policy": deferred,
            "dataset_authorized": dataset_authorized,
            "skipped_duplicate": duplicates,
            "skipped_in_progress": skipped_in_progress,
            "skipped_dead_letter": skipped_dead_letter,
            "redriven": redriven,
            "results": results,
        }
