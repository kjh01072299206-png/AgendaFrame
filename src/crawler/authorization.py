from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from crawler.models import ArticleDocument, canonicalize_url


@dataclass(frozen=True)
class ApprovedArticleBinding:
    source_id: str
    canonical_url: str
    published_date: date
    body_sha256: str


@dataclass(frozen=True)
class DatasetAnalysisAuthorization:
    """Auditable one-run approval; this is not a publisher content licence."""

    authorization_id: str
    cluster_id: str
    reviewed_by: str
    reviewed_at: str
    purpose: str
    text_scope: str
    valid_until: date
    approved_articles: dict[str, ApprovedArticleBinding]
    retain_body: bool = False
    cluster_review_status: str | None = None

    @classmethod
    def from_json_text(cls, text: str) -> DatasetAnalysisAuthorization:
        payload = json.loads(text)
        if payload.get("schema_version") != 3:
            raise ValueError("Unsupported dataset-authorization schema version.")
        if payload.get("purpose") != "transient_framing_analysis":
            raise ValueError("Dataset authorization is not valid for framing analysis.")
        if payload.get("retain_body") is not False:
            raise ValueError("Dataset authorization must not permit article-body retention.")
        text_scope = str(payload.get("text_scope") or "")
        if text_scope not in {
            "provider_export",
            "provider_excerpt",
            "transient_public_page_extract",
        }:
            raise ValueError("Unsupported authorized dataset text scope.")
        articles = payload.get("approved_articles")
        if not isinstance(articles, dict) or not articles:
            raise ValueError("Dataset authorization requires approved article bindings.")
        approved_articles: dict[str, ApprovedArticleBinding] = {}
        for article_id, binding in articles.items():
            normalized_id = str(article_id).strip()
            if not normalized_id or not isinstance(binding, dict):
                raise ValueError("Dataset authorization contains an invalid article binding.")
            source_id = str(binding.get("source_id") or "").strip()
            normalized_hash = str(binding.get("body_sha256") or "").strip().lower()
            if not source_id or not _is_sha256(normalized_hash):
                raise ValueError("Dataset authorization contains an invalid source or body hash.")
            approved_articles[normalized_id] = ApprovedArticleBinding(
                source_id=source_id,
                canonical_url=canonicalize_url(str(binding["canonical_url"])),
                published_date=date.fromisoformat(str(binding["published_date"])),
                body_sha256=normalized_hash,
            )
        valid_until = date.fromisoformat(str(payload["valid_until"]))
        authorization_id = str(payload.get("authorization_id") or "").strip()
        if not authorization_id:
            raise ValueError("Dataset authorization ID is required.")
        cluster_id = str(payload.get("cluster_id") or "").strip()
        reviewed_by = str(payload.get("reviewed_by") or "").strip()
        reviewed_at = str(payload.get("reviewed_at") or "").strip()
        if not cluster_id or not reviewed_by or not reviewed_at:
            raise ValueError("Dataset authorization requires cluster review lineage.")
        try:
            datetime.fromisoformat(reviewed_at)
        except ValueError as error:
            raise ValueError("Dataset authorization reviewed_at must be ISO-8601.") from error
        cluster_review_status = payload.get("cluster_review_status")
        if cluster_review_status not in {None, "approved_same_event"}:
            raise ValueError("Dataset cluster must be approved as the same event before analysis.")
        return cls(
            authorization_id=authorization_id,
            cluster_id=cluster_id,
            reviewed_by=reviewed_by,
            reviewed_at=reviewed_at,
            purpose="transient_framing_analysis",
            text_scope=text_scope,
            valid_until=valid_until,
            approved_articles=approved_articles,
            retain_body=False,
            cluster_review_status=cluster_review_status,
        )

    @classmethod
    def from_path(cls, path: str | Path) -> DatasetAnalysisAuthorization:
        return cls.from_json_text(Path(path).read_text(encoding="utf-8"))

    def allows(
        self,
        article: ArticleDocument,
        *,
        today: date | None = None,
    ) -> bool:
        check_date = today or datetime.now(UTC).date()
        binding = self.approved_articles.get(article.article_id)
        published_date = article.published_at.astimezone(timezone(timedelta(hours=9))).date()
        return (
            check_date <= self.valid_until
            and self.cluster_review_status == "approved_same_event"
            and article.text_scope == self.text_scope
            and binding is not None
            and binding.source_id == article.source_id
            and binding.canonical_url == article.canonical_url
            and binding.published_date == published_date
            and article.body_hash is not None
            and binding.body_sha256 == article.body_hash
        )

    @property
    def fingerprint(self) -> str:
        stable = json.dumps(
            {
                "authorization_id": self.authorization_id,
                "cluster_id": self.cluster_id,
                "reviewed_by": self.reviewed_by,
                "reviewed_at": self.reviewed_at,
                "purpose": self.purpose,
                "text_scope": self.text_scope,
                "valid_until": self.valid_until.isoformat(),
                "approved_articles": {
                    article_id: {
                        "source_id": binding.source_id,
                        "canonical_url": binding.canonical_url,
                        "published_date": binding.published_date.isoformat(),
                        "body_sha256": binding.body_sha256,
                    }
                    for article_id, binding in sorted(self.approved_articles.items())
                },
                "retain_body": self.retain_body,
                "cluster_review_status": self.cluster_review_status,
            },
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        )
        return hashlib.sha256(stable.encode("utf-8")).hexdigest()

    @property
    def approved_urls_sha256(self) -> str:
        normalized = "\n".join(
            sorted(binding.canonical_url for binding in self.approved_articles.values())
        )
        return hashlib.sha256(normalized.encode("utf-8")).hexdigest()

    def public_lineage(self) -> dict[str, str]:
        """Return body-free provenance that can travel with every result."""

        return {
            "authorization_id": self.authorization_id,
            "fingerprint": self.fingerprint,
            "cluster_id": self.cluster_id,
            "reviewer": self.reviewed_by,
            "reviewed_at": self.reviewed_at,
            "approved_urls_sha256": self.approved_urls_sha256,
        }

    def publication_cluster(self) -> dict[str, object]:
        """Bind a reviewed comparison request to the exact approved URL set."""

        return {
            **self.public_lineage(),
            "approved_urls": sorted(
                binding.canonical_url for binding in self.approved_articles.values()
            ),
        }


def _is_sha256(value: str) -> bool:
    return len(value) == 64 and all(character in "0123456789abcdef" for character in value)


def authorization_payload(
    *,
    authorization_id: str,
    cluster_id: str,
    reviewed_by: str,
    reviewed_at: str,
    text_scope: str,
    valid_until: str,
    approved_articles: dict[str, dict[str, str]],
    cluster_review_status: str,
) -> dict[str, Any]:
    """Build a serializable manifest without article text."""

    return {
        "schema_version": 3,
        "authorization_id": authorization_id,
        "cluster_id": cluster_id,
        "reviewed_by": reviewed_by,
        "reviewed_at": reviewed_at,
        "purpose": "transient_framing_analysis",
        "text_scope": text_scope,
        "valid_until": valid_until,
        "retain_body": False,
        "cluster_review_status": cluster_review_status,
        "approved_articles": approved_articles,
    }
