"""Concrete production dependencies for the GCP collection pipeline.

The orchestration and stage adapters are deliberately dependency-injected. This
module is the reviewed production binding: it owns sequential HTTPS discovery,
article-page extraction, private Cloud Storage bodies, BigQuery metadata, Vertex
clients, and immutable snapshot objects. It never exposes article text outside
the private vault or a single Vertex request.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import UTC, datetime, date, timedelta, timezone
from html.parser import HTMLParser
from typing import Any, Mapping, Sequence

from ai.framing import VertexFrameAnalyzer
from ai.issue_clustering import InitialFiveClusterer
from backend.config import RuntimeConfig
from backend.gcp_job_entrypoint import GcpRuntimeConfig, RuntimeAdapterUnavailable
from backend.gcp_production_adapters import GoogleClientBundle
from backend.gcp_source_policy import GcpDiscoveryPolicy
from backend.gcp_stage_adapters import (
    ConservativeCandidateGroupBuilder,
    GcpAnalysisStoreMetadataSink,
    ImmutableObjectWriter,
    PrivateArticleVault,
    SnapshotPublishAdapter,
    StageDependencies,
    build_stage_adapters,
)
from backend.gcp_store import GcpAnalysisStore
from crawler.models import ArticleDocument, canonicalize_url, is_domain_allowed


KST = timezone(timedelta(hours=9))
USER_AGENT = "AgendaFrameAcademicResearch/1.0 (+https://agendaframe-capstone.vercel.app)"
MAX_ARTICLES_PER_SOURCE = 30
MAX_ENDPOINT_BYTES = 2_000_000


@dataclass(frozen=True)
class FetchedResponse:
    url: str
    status: int
    content_type: str
    body: bytes


class UrlLibFeedFetcher:
    """Sequential HTTPS fetcher with bounded response size and source identity."""

    def __init__(self, *, timeout_seconds: float = 15.0) -> None:
        self.timeout_seconds = timeout_seconds

    def fetch(self, url: str, *, source_id: str) -> FetchedResponse:
        request = urllib.request.Request(
            url,
            headers={
                "User-Agent": USER_AGENT,
                "Accept": "application/rss+xml, application/xml, text/xml, text/html;q=0.9,*/*;q=0.1",
                "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.5",
            },
            method="GET",
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout_seconds) as response:
                status = int(getattr(response, "status", 200))
                content_type = str(response.headers.get("content-type", ""))
                body = response.read(MAX_ENDPOINT_BYTES + 1)
        except urllib.error.HTTPError as error:
            # 403/429 are policy stop signals. Returning an empty response lets
            # the source finish without turning a single blocked outlet into a
            # whole-run failure; the result records the status in the run log.
            return FetchedResponse(url, int(error.code), "", b"")
        except (urllib.error.URLError, TimeoutError) as error:
            raise RuntimeAdapterUnavailable(
                f"source {source_id} endpoint request failed: {url}"
            ) from error
        if len(body) > MAX_ENDPOINT_BYTES:
            raise RuntimeAdapterUnavailable(f"source {source_id} endpoint exceeded 2MB: {url}")
        return FetchedResponse(url, status, content_type, body)


class _ArticleHtmlParser(HTMLParser):
    """Small deterministic extractor for metadata and article paragraphs."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.title_parts: list[str] = []
        self.body_parts: list[str] = []
        self.meta: dict[str, str] = {}
        self._title_depth = 0
        self._body_depth = 0
        self._skip_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = {str(key).lower(): value or "" for key, value in attrs}
        lowered = tag.lower()
        if lowered == "meta":
            key = values.get("property") or values.get("name") or values.get("itemprop")
            content = values.get("content", "").strip()
            if key and content:
                self.meta[key.lower()] = content
            return
        if lowered == "title":
            self._title_depth += 1
        if lowered in {"script", "style", "noscript", "svg", "nav", "footer", "header"}:
            self._skip_depth += 1
        if lowered in {"article", "main"}:
            self._body_depth += 1
        if self._body_depth and lowered in {"p", "h1", "h2", "h3", "li", "blockquote"}:
            self.body_parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        lowered = tag.lower()
        if lowered == "title":
            self._title_depth = max(0, self._title_depth - 1)
        if lowered in {"script", "style", "noscript", "svg", "nav", "footer", "header"}:
            self._skip_depth = max(0, self._skip_depth - 1)
        if lowered in {"article", "main"}:
            self._body_depth = max(0, self._body_depth - 1)

    def handle_data(self, data: str) -> None:
        text = " ".join(data.split())
        if not text or self._skip_depth:
            return
        if self._title_depth:
            self.title_parts.append(text)
        if self._body_depth:
            self.body_parts.append(text)


def _parse_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    candidate = value.strip()
    try:
        parsed = datetime.fromisoformat(candidate.replace("Z", "+00:00"))
    except ValueError:
        parsed = None
    if parsed is None:
        from email.utils import parsedate_to_datetime

        try:
            parsed = parsedate_to_datetime(candidate)
        except (TypeError, ValueError, IndexError):
            return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=KST)
    return parsed.astimezone(UTC)


def _xml_text(node: ET.Element | None) -> str:
    return " ".join("".join(node.itertext()).split()) if node is not None else ""


def _article_id(url: str) -> str:
    return hashlib.sha256(url.encode("utf-8")).hexdigest()[:32]


class NewsArticleParser:
    """Parse RSS, sitemap, and section HTML, then fetch article pages."""

    def __init__(
        self,
        fetcher: UrlLibFeedFetcher,
        *,
        collection_start: str,
        collection_end: str,
    ) -> None:
        self.fetcher = fetcher
        self.start = date.fromisoformat(collection_start)
        self.end = date.fromisoformat(collection_end)

    def parse(
        self,
        response: FetchedResponse,
        *,
        source,
        endpoint_url: str,
        collected_at: datetime,
    ) -> Sequence[ArticleDocument]:
        if response.status in {403, 429} or not response.body:
            return ()
        text = response.body.decode("utf-8", errors="replace")
        candidates = self._rss_candidates(text) if self._looks_xml(text, response.content_type) else self._html_candidates(text, endpoint_url)
        rows: list[ArticleDocument] = []
        seen: set[str] = set()
        for title, url, published in candidates:
            try:
                canonical = canonicalize_url(url)
            except ValueError:
                continue
            hostname = urllib.parse.urlsplit(canonical).hostname or ""
            if not is_domain_allowed(hostname, tuple(source.domains)) or canonical in seen:
                continue
            seen.add(canonical)
            page = self.fetcher.fetch(canonical, source_id=source.source_id)
            row = self._article_page(
                page,
                source_id=source.source_id,
                canonical_url=canonical,
                fallback_title=title,
                fallback_published=published,
                collected_at=collected_at,
            )
            if row is not None:
                rows.append(row)
            if len(rows) >= MAX_ARTICLES_PER_SOURCE:
                break
        return tuple(rows)

    @staticmethod
    def _looks_xml(text: str, content_type: str) -> bool:
        stripped = text.lstrip()
        return "xml" in content_type.lower() or stripped.startswith("<?xml") or "<rss" in stripped[:300].lower() or "<urlset" in stripped[:300].lower()

    def _rss_candidates(self, text: str) -> list[tuple[str, str, datetime | None]]:
        try:
            root = ET.fromstring(text)
        except ET.ParseError:
            return []
        rows: list[tuple[str, str, datetime | None]] = []
        for item in root.iter():
            if item.tag.rsplit("}", 1)[-1].lower() not in {"item", "url"}:
                continue
            values = {child.tag.rsplit("}", 1)[-1].lower(): _xml_text(child) for child in item}
            link = values.get("link") or values.get("loc")
            title = values.get("title", "").strip()
            published = _parse_datetime(values.get("pubdate") or values.get("published") or values.get("date"))
            if link:
                rows.append((title, link, published))
        return rows

    def _html_candidates(self, text: str, endpoint_url: str) -> list[tuple[str, str, datetime | None]]:
        parser = _LinkParser()
        parser.feed(text)
        return [
            (title, urllib.parse.urljoin(endpoint_url, href), None)
            for href, title in parser.links
            if href
        ]

    def _article_page(
        self,
        response: FetchedResponse,
        *,
        source_id: str,
        canonical_url: str,
        fallback_title: str,
        fallback_published: datetime | None,
        collected_at: datetime,
    ) -> ArticleDocument | None:
        if response.status in {403, 429} or not response.body:
            return None
        parser = _ArticleHtmlParser()
        parser.feed(response.body.decode("utf-8", errors="replace"))
        title = (
            parser.meta.get("og:title")
            or parser.meta.get("title")
            or " ".join(parser.title_parts)
            or fallback_title
        ).strip()
        published = _parse_datetime(
            parser.meta.get("article:published_time")
            or parser.meta.get("datepublished")
            or parser.meta.get("date")
        ) or fallback_published
        if published is None:
            # Strict mode: a date-less section link is a candidate, not a
            # collected article. Never label discovery time as publication time.
            return None
        local_date = published.astimezone(KST).date()
        if not self.start <= local_date <= self.end:
            return None
        body = " ".join(" ".join(parser.body_parts).split())
        if len(body) < 80:
            return None
        return ArticleDocument(
            article_id=_article_id(canonical_url),
            source_id=source_id,
            canonical_url=canonical_url,
            title=title[:500],
            published_at=published,
            collected_at=collected_at,
            section=None,
            body_text=body,
            text_scope="authorized_transient_body",
        )


class _LinkParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.links: list[tuple[str, str]] = []
        self._href: str | None = None
        self._parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() != "a":
            return
        values = dict(attrs)
        self._href = values.get("href")
        self._parts = []

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() == "a" and self._href:
            self.links.append((self._href, " ".join(" ".join(self._parts).split())))
            self._href = None
            self._parts = []

    def handle_data(self, data: str) -> None:
        if self._href is not None:
            self._parts.append(data)


class GcsPrivateArticleVault(PrivateArticleVault):
    def __init__(self, storage_client: Any, *, bucket_name: str, delete_after: str) -> None:
        self.bucket = storage_client.bucket(bucket_name)
        self.delete_after = delete_after

    def put(self, run_id: str, article: ArticleDocument) -> str:
        object_name = f"bodies/{article.source_id}/{article.published_at:%Y/%m/%d}/{article.article_id}.txt"
        blob = self.bucket.blob(object_name)
        delete_at = datetime.fromisoformat(f"{self.delete_after}T23:59:59+09:00").astimezone(UTC)
        blob.custom_time = delete_at
        blob.metadata = {
            "run_id": run_id,
            "article_id": article.article_id,
            "source_id": article.source_id,
            "body_hash": article.body_hash or "",
            "delete_after": self.delete_after,
        }
        blob.upload_from_string(article.body_text or "", content_type="text/plain; charset=utf-8")
        return f"gs://{self.bucket.name}/{object_name}"

    def get(self, run_id: str, article_id: str) -> ArticleDocument:
        raise RuntimeAdapterUnavailable("production vault does not support body reads by ID alone")


class GcsRunArticleVault(GcsPrivateArticleVault):
    """GCS vault that retains the in-run ArticleDocument index for later stages."""

    def __init__(self, storage_client: Any, *, bucket_name: str, delete_after: str) -> None:
        super().__init__(storage_client, bucket_name=bucket_name, delete_after=delete_after)
        self._rows: dict[tuple[str, str], ArticleDocument] = {}

    def put(self, run_id: str, article: ArticleDocument) -> str:
        reference = super().put(run_id, article)
        self._rows[(run_id, article.article_id)] = article
        return reference

    def get(self, run_id: str, article_id: str) -> ArticleDocument:
        try:
            return self._rows[(run_id, article_id)]
        except KeyError as error:
            raise RuntimeAdapterUnavailable(
                f"article {article_id} is not available in the current Cloud Run task"
            ) from error


class GcsImmutableSnapshotWriter(ImmutableObjectWriter):
    def __init__(self, storage_client: Any, *, bucket_name: str) -> None:
        self.bucket = storage_client.bucket(bucket_name)

    def put_immutable(self, objects: Mapping[str, Mapping[str, Any]]) -> None:
        for object_name, payload in objects.items():
            blob = self.bucket.blob(object_name)
            body = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
            try:
                blob.upload_from_string(
                    body,
                    content_type="application/json; charset=utf-8",
                    if_generation_match=0,
                )
            except Exception as error:
                # A retry may have already created the immutable object. Only
                # accept it when the bytes are identical; never overwrite it.
                if not blob.exists() or blob.download_as_bytes() != body:
                    raise RuntimeAdapterUnavailable(
                        f"immutable snapshot write failed: {object_name}"
                    ) from error

    def read_public_manifest(self, pointer: Mapping[str, Any]) -> Mapping[str, Any]:
        reference = str(pointer.get("manifest", ""))
        if not reference:
            raise RuntimeAdapterUnavailable("snapshot pointer has no manifest")
        blob = self.bucket.blob(reference)
        return json.loads(blob.download_as_text(encoding="utf-8"))


class GcsActivePointerStore:
    def __init__(self, storage_client: Any, *, bucket_name: str) -> None:
        self.bucket = storage_client.bucket(bucket_name)
        self.object_name = "snapshots/current.json"

    def read_current_pointer(self) -> Mapping[str, Any] | None:
        blob = self.bucket.blob(self.object_name)
        if not blob.exists():
            return None
        return json.loads(blob.download_as_text(encoding="utf-8"))

    def update_current_pointer(self, pointer: Mapping[str, Any]) -> None:
        blob = self.bucket.blob(self.object_name)
        blob.cache_control = "no-store, max-age=0"
        blob.upload_from_string(
            json.dumps(pointer, ensure_ascii=False, sort_keys=True),
            content_type="application/json; charset=utf-8",
        )


def build_stage_dependencies(
    clients: GoogleClientBundle,
    config: RuntimeConfig,
    runtime: GcpRuntimeConfig,
) -> StageDependencies:
    """Build the concrete GCP dependency graph used by Cloud Run."""

    policy_path = os.environ.get("AGENDAFRAME_DISCOVERY_POLICY", "site/data/discovery-sources.json")
    policy = GcpDiscoveryPolicy.from_path(policy_path)
    fetcher = UrlLibFeedFetcher()
    parser = NewsArticleParser(
        fetcher,
        collection_start=policy.collection_start,
        collection_end=policy.collection_end,
    )
    vault = GcsRunArticleVault(
        clients.storage,
        bucket_name=config.bucket,
        delete_after=policy.collection_end,
    )
    store = GcpAnalysisStore(config, bigquery_client=clients.bigquery, storage_client=clients.storage)
    snapshot_writer = GcsImmutableSnapshotWriter(clients.storage, bucket_name=config.bucket)
    pointer_store = GcsActivePointerStore(clients.storage, bucket_name=config.bucket)
    clusterer = InitialFiveClusterer(config, client_factory=lambda _config: clients.vertex)
    frame_analyzer = VertexFrameAnalyzer(config, client_factory=lambda _config: clients.vertex)
    return StageDependencies(
        policy_path=policy_path,
        fetcher=fetcher,
        parser=parser,
        vault=vault,
        persistence_sink=GcpAnalysisStoreMetadataSink(store),
        candidate_builder=ConservativeCandidateGroupBuilder(),
        initial_five_clusterer=clusterer,
        frame_analyzer=frame_analyzer,
        immutable_writer=snapshot_writer,
        pointer_store=pointer_store,
    )


__all__ = [
    "FetchedResponse",
    "GcsActivePointerStore",
    "GcsImmutableSnapshotWriter",
    "GcsRunArticleVault",
    "NewsArticleParser",
    "UrlLibFeedFetcher",
    "build_stage_dependencies",
]
