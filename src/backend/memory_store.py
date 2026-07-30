from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime

from ai.framing import FrameResult
from crawler.models import ArticleDocument


@dataclass(frozen=True)
class StoredAnalysis:
    article_id: str
    analysis_key: str
    result: FrameResult
    body_retained: bool
    delete_on: str
    saved_at: datetime


class MemoryAnalysisStore:
    def __init__(self) -> None:
        self.records: list[StoredAnalysis] = []

    def already_analyzed(self, analysis_key: str) -> bool:
        return any(record.analysis_key == analysis_key for record in self.records)

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
        self.records.append(
            StoredAnalysis(
                article_id=article.article_id,
                analysis_key=analysis_key,
                result=result,
                body_retained=retain_body,
                delete_on=delete_on,
                saved_at=datetime.now(UTC),
            )
        )
