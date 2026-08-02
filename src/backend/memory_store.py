from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime

from ai.framing import FrameResult
from backend.analysis_state import (
    AnalysisState,
    AnalysisStateRecord,
    assert_state_transition,
    utc_now_iso,
)
from crawler.models import ArticleDocument


@dataclass(frozen=True)
class StoredAnalysis:
    article_id: str
    analysis_key: str
    result: FrameResult
    body_retained: bool
    delete_on: str
    saved_at: datetime
    analysis_state: AnalysisState = AnalysisState.SUCCEEDED
    attempt_count: int = 0
    idempotency_fingerprint: str | None = None
    error_code: str | None = None


class MemoryAnalysisStore:
    def __init__(self) -> None:
        self.records: list[StoredAnalysis] = []
        self._states: dict[str, AnalysisStateRecord] = {}

    def already_analyzed(self, analysis_key: str) -> bool:
        return self.current_state(analysis_key) is AnalysisState.SUCCEEDED

    def current_state(self, analysis_key: str) -> AnalysisState | None:
        record = self._states.get(analysis_key)
        return record.state if record else None

    def attempt_count(self, analysis_key: str) -> int:
        record = self._states.get(analysis_key)
        return record.attempt_count if record else 0

    def mark_state(
        self,
        analysis_key: str,
        article_id: str,
        state: AnalysisState,
        *,
        attempt_count: int,
        error_code: str | None = None,
        next_attempt_at: str | None = None,
    ) -> None:
        previous = self._states.get(analysis_key)
        assert_state_transition(previous.state if previous else None, state)
        if attempt_count < 0:
            raise ValueError("Analysis attempt count cannot be negative.")
        self._states[analysis_key] = AnalysisStateRecord(
            fingerprint=analysis_key,
            article_id=article_id,
            state=state,
            attempt_count=attempt_count,
            error_code=error_code,
            next_attempt_at=next_attempt_at,
            updated_at=utc_now_iso(),
        )

    def analyzed_today_count(self) -> int:
        today = datetime.now(UTC).date()
        return sum(record.saved_at.date() == today for record in self.records)

    def save_result(
        self,
        article: ArticleDocument,
        result: FrameResult,
        analysis_key: str,
        retain_body: bool,
        delete_on: str,
    ) -> None:
        state = AnalysisState(
            result.analysis_state
            or (
                AnalysisState.SUCCEEDED.value
                if result.decision == "analyze"
                else AnalysisState.REVIEW_NEEDED.value
            )
        )
        self.mark_state(
            analysis_key,
            article.article_id,
            state,
            attempt_count=result.attempt_count,
            error_code=result.error_code,
        )
        stored = StoredAnalysis(
            article_id=article.article_id,
            analysis_key=analysis_key,
            result=result,
            body_retained=retain_body,
            delete_on=delete_on,
            saved_at=datetime.now(UTC),
            analysis_state=state,
            attempt_count=result.attempt_count,
            idempotency_fingerprint=result.idempotency_fingerprint or analysis_key,
            error_code=result.error_code,
        )
        for index, record in enumerate(self.records):
            if record.analysis_key == analysis_key:
                self.records[index] = stored
                break
        else:
            self.records.append(stored)
