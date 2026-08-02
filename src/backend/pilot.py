from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta, timezone
from pathlib import Path
from typing import Iterable

from crawler.authorization import DatasetAnalysisAuthorization
from crawler.models import ArticleDocument

PILOT_DATE = date(2026, 7, 26)
PILOT_RANKS = (1, 2, 3, 4, 5)
PILOT_ARTICLE_COUNTS = {1: 7, 2: 6, 3: 4, 4: 4, 5: 4}
PILOT_ARTICLE_COUNT = sum(PILOT_ARTICLE_COUNTS.values())
KST = timezone(timedelta(hours=9))


@dataclass(frozen=True)
class PilotApproval:
    rank: int
    path: Path
    authorization: DatasetAnalysisAuthorization


def pilot_approval_path(directory: str | Path, rank: int) -> Path:
    if rank not in PILOT_RANKS:
        raise ValueError(f"Pilot rank must be one of {PILOT_RANKS}.")
    return Path(directory) / f"2026-07-26-rank-{rank}-pilot.json"


def load_pilot_approvals(directory: str | Path) -> tuple[PilotApproval, ...]:
    approvals: list[PilotApproval] = []
    for rank in PILOT_RANKS:
        path = pilot_approval_path(directory, rank)
        if not path.is_file():
            raise ValueError(f"Missing pilot approval manifest for rank {rank}: {path}")
        approvals.append(
            PilotApproval(
                rank=rank,
                path=path,
                authorization=DatasetAnalysisAuthorization.from_path(path),
            )
        )
    all_ids: set[str] = set()
    for approval in approvals:
        expected_count = PILOT_ARTICLE_COUNTS[approval.rank]
        actual_ids = set(approval.authorization.approved_articles)
        if len(actual_ids) != expected_count:
            raise ValueError(
                f"Pilot rank {approval.rank} must contain {expected_count} approved articles."
            )
        if all_ids.intersection(actual_ids):
            raise ValueError("Pilot approval manifests must contain disjoint article IDs.")
        all_ids.update(actual_ids)
        for binding in approval.authorization.approved_articles.values():
            if binding.published_date != PILOT_DATE:
                raise ValueError("Pilot approval contains an article outside 2026-07-26.")
    if len(all_ids) != PILOT_ARTICLE_COUNT:
        raise ValueError(f"Pilot approvals must cover exactly {PILOT_ARTICLE_COUNT} articles.")
    return tuple(approvals)


def validate_pilot_articles(
    articles: Iterable[ArticleDocument],
    approvals: tuple[PilotApproval, ...],
) -> dict[str, object]:
    article_list = list(articles)
    if len(article_list) != PILOT_ARTICLE_COUNT:
        raise ValueError(f"Pilot input must contain exactly {PILOT_ARTICLE_COUNT} articles.")
    article_ids = [article.article_id for article in article_list]
    if len(set(article_ids)) != len(article_ids):
        raise ValueError("Pilot input contains duplicate article IDs.")
    by_id = {article.article_id: article for article in article_list}
    expected_ids = {
        article_id
        for approval in approvals
        for article_id in approval.authorization.approved_articles
    }
    if set(by_id) != expected_ids:
        raise ValueError("Pilot input IDs do not match the five approved agenda manifests.")
    rank_summaries: list[dict[str, object]] = []
    for approval in approvals:
        rank_ids = sorted(approval.authorization.approved_articles)
        rank_articles = [by_id[article_id] for article_id in rank_ids]
        validate_approval_articles(rank_articles, approval.authorization)
        rank_summaries.append(
            {
                "rank": approval.rank,
                "article_count": len(rank_articles),
                "article_ids": rank_ids,
            }
        )
    return {
        "target_date": PILOT_DATE.isoformat(),
        "agenda_count": len(approvals),
        "article_count": len(article_list),
        "article_ids": sorted(article_ids),
        "ranks": rank_summaries,
    }


def validate_approval_articles(
    articles: Iterable[ArticleDocument],
    authorization: DatasetAnalysisAuthorization,
) -> None:
    """Reject any source, URL, date, scope, or body-hash drift before a call."""

    for article in articles:
        published_date = article.published_at.astimezone(KST).date()
        if published_date != PILOT_DATE:
            raise ValueError("Pilot input contains an article outside 2026-07-26.")
        if not article.body_text:
            raise ValueError("Pilot input must contain a body for every approved article.")
        if not authorization.allows(article, today=PILOT_DATE):
            raise ValueError(
                f"Pilot article does not match its approved source, URL, date, or body hash: "
                f"{article.article_id}"
            )
