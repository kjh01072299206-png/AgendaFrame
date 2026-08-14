"""Stage adapters that connect the reviewed AgendaFrame components.

The adapters intentionally keep private article bodies in an injected vault.
Stage return values contain metadata, private-object references, hashes, and
public evidence locators only; ``gcp_orchestration`` rejects a body field at
every boundary.  HTTP, Google SDKs, and durable stores are all injected, so
unit tests never contact a publisher or a cloud service.

This module is a production boundary, not a claim that the Cloud Run Job is
already deployed.  A deployment still needs concrete fetch/parser, metadata
sink, and snapshot bindings supplied through the production factory.
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Callable, Mapping, Protocol, Sequence
from urllib.parse import urlsplit

from ai.framing import FrameAnalyzer, FrameResult, VertexFrameAnalyzer
from ai.issue_clustering import (
    InitialFiveClusterer,
    MetadataArticle,
    MetadataIssueGroup,
)
from backend.config import RuntimeConfig
from backend.gcp_job_entrypoint import GcpRuntimeConfig, RuntimeAdapterUnavailable
from backend.gcp_orchestration import (
    ClusterRankAdapter,
    CollectionAdapter,
    PersistenceAdapter,
    PipelineAdapters,
    SemanticAdapter,
    SnapshotStore,
    assert_body_safe,
)
from backend.publisher import publication_row
from crawler.models import ArticleDocument, canonicalize_url, is_domain_allowed


class StageAdapterError(RuntimeError):
    """A stage input/output does not satisfy the adapter contract."""


# These literals intentionally mirror ``site/lib/initial-five/types.ts``.
# Keeping the projection here (rather than passing the internal publisher row
# through) prevents a Cloud Run result from becoming a site-incompatible
# hybrid of snake_case and camelCase fields.
SITE_BUNDLE_SCHEMA_VERSION = "agendaframe.initial-five.public.v1"
SITE_PROFILE_SCHEMA_VERSION = "agendaframe.article-frame-profile.v2"
SITE_MANIFEST_SCHEMA_VERSION = "agenda.frame.active-snapshot.v1"


def build_vertex_frame_analyzer(
    config: RuntimeConfig,
    *,
    client_factory: Callable[[RuntimeConfig], Any] | None = None,
) -> VertexFrameAnalyzer:
    """Construct the reviewed Vertex analyzer without importing its SDK.

    ``VertexFrameAnalyzer.analyze`` performs the lazy SDK import/client call;
    construction here is deterministic and therefore safe for contract tests.
    """

    return VertexFrameAnalyzer(config, client_factory=client_factory)


@dataclass(frozen=True)
class SourceDefinition:
    source_id: str
    domains: tuple[str, ...]
    endpoint_urls: tuple[str, ...]


def load_source_definitions(path: str) -> tuple[SourceDefinition, ...]:
    """Validate the 12-source policy and retain only collection metadata."""

    try:
        payload = json.loads(open(path, encoding="utf-8").read())
    except (OSError, json.JSONDecodeError) as error:
        raise StageAdapterError(f"cannot load discovery policy: {path}") from error
    if not isinstance(payload, Mapping):
        raise StageAdapterError("discovery policy must be an object")
    # Importing the validator here keeps this adapter usable with a validated
    # policy object in tests while ensuring a production path cannot skip the
    # twelve-source/schedule checks.
    from backend.gcp_source_policy import GcpDiscoveryPolicy

    policy = GcpDiscoveryPolicy.from_payload(payload, path=path)
    definitions: list[SourceDefinition] = []
    for source in payload.get("sources", []):
        if not isinstance(source, Mapping):
            raise StageAdapterError("discovery policy source must be an object")
        source_id = str(source.get("id", "")).strip()
        domains = tuple(str(item).strip().lower() for item in source.get("domains", []))
        endpoints = tuple(
            str(endpoint.get("url", "")).strip()
            for endpoint in source.get("endpoints", [])
            if isinstance(endpoint, Mapping) and str(endpoint.get("url", "")).strip()
        )
        if not source_id or not domains or not endpoints:
            raise StageAdapterError(f"source definition is incomplete: {source_id or '<unknown>'}")
        definitions.append(SourceDefinition(source_id, domains, endpoints))
    if len(definitions) != policy.source_count or len(definitions) != 12:
        raise StageAdapterError("collection adapter requires exactly twelve source definitions")
    return tuple(definitions)


class FeedFetcher(Protocol):
    """Fetch an endpoint body; implementations may use RSS or site parsing."""

    def fetch(self, url: str, *, source_id: str) -> object: ...


class ArticleParser(Protocol):
    """Turn a saved endpoint response into normalized ArticleDocument rows."""

    def parse(
        self,
        response: object,
        *,
        source: SourceDefinition,
        endpoint_url: str,
        collected_at: datetime,
    ) -> Sequence[ArticleDocument]: ...


class PrivateArticleVault(Protocol):
    """Private/transient body storage; never returned in a stage mapping."""

    def put(self, run_id: str, article: ArticleDocument) -> str: ...

    def get(self, run_id: str, article_id: str) -> ArticleDocument: ...


class MetadataPersistenceSink(Protocol):
    """Cloud SQL/BigQuery sink for metadata and private object references."""

    def persist_articles(
        self,
        run_id: str,
        articles: Sequence[ArticleDocument],
        *,
        private_object_refs: Mapping[str, str],
    ) -> Mapping[str, Any]: ...


class GcpAnalysisStoreMetadataSink:
    """Metadata-only bridge for the existing ``GcpAnalysisStore``.

    ``GcpAnalysisStore`` already owns the BigQuery schema and idempotent row
    writer.  Its constructor/client calls remain outside this module; this
    bridge invokes the store's write method only when the persist stage runs.
    A private body object reference is written as metadata, never the body
    itself.  Deployments may replace this bridge with a Cloud SQL sink that
    implements the same protocol.
    """

    def __init__(self, store: Any) -> None:
        self.store = store
        writer = getattr(store, "_insert_json", None)
        if not callable(writer):
            raise RuntimeAdapterUnavailable(
                "GcpAnalysisStore metadata bridge requires its JSON row writer"
            )

    def persist_articles(
        self,
        run_id: str,
        articles: Sequence[ArticleDocument],
        *,
        private_object_refs: Mapping[str, str],
    ) -> Mapping[str, Any]:
        writer = self.store._insert_json
        for article in articles:
            reference = private_object_refs.get(article.article_id)
            if not isinstance(reference, str) or not reference.strip():
                raise StageAdapterError(f"missing private body reference: {article.article_id}")
            row = _metadata(article, private_object_ref=reference)
            # Keep the existing schema's snake_case names and explicitly omit
            # body_text/raw_body/full article content from the BigQuery row.
            writer(
                "articles",
                {
                    "article_id": row["articleId"],
                    "source_id": row["sourceId"],
                    "canonical_url": row["canonicalUrl"],
                    "title": row["title"],
                    "published_at": row["publishedAt"],
                    "collected_at": row["collectedAt"],
                    "section": row["section"],
                    "body_hash": row["bodyHash"],
                    "body_object": row["privateBodyObject"],
                    "text_scope": row["textScope"],
                },
                article.article_id,
            )
        return {"metadataRows": len(articles), "runId": run_id}


class CandidateGroupBuilder(Protocol):
    def build(
        self,
        articles: Sequence[MetadataArticle],
        *,
        basis_date: str,
    ) -> Sequence[MetadataIssueGroup]: ...


class ImmutableObjectWriter(Protocol):
    def put_immutable(self, objects: Mapping[str, Mapping[str, Any]]) -> None: ...


class ActivePointerStore(Protocol):
    def read_current_pointer(self) -> Mapping[str, Any] | None: ...

    def update_current_pointer(self, pointer: Mapping[str, Any]) -> None: ...


@dataclass(frozen=True)
class StageDependencies:
    """All network/cloud behavior required by the stage factory."""

    policy_path: str
    fetcher: FeedFetcher
    parser: ArticleParser
    vault: PrivateArticleVault
    persistence_sink: MetadataPersistenceSink
    candidate_builder: CandidateGroupBuilder
    initial_five_clusterer: InitialFiveClusterer
    frame_analyzer: FrameAnalyzer
    immutable_writer: ImmutableObjectWriter
    pointer_store: ActivePointerStore


def _metadata(article: ArticleDocument, *, private_object_ref: str) -> dict[str, Any]:
    return {
        "articleId": article.article_id,
        "sourceId": article.source_id,
        "canonicalUrl": article.canonical_url,
        "title": article.title,
        "publishedAt": article.published_at.isoformat(),
        "collectedAt": article.collected_at.isoformat(),
        "section": article.section,
        "bodyHash": article.body_hash,
        "privateBodyObject": private_object_ref,
        "textScope": article.text_scope,
    }


def _article_id_hash(article_id: str) -> str:
    return hashlib.sha256(article_id.encode("utf-8")).hexdigest()[:24]


class PolicyCollectionAdapter(CollectionAdapter):
    """Fetch RSS/site endpoints through injected fetcher/parser instances."""

    def __init__(
        self,
        dependencies: StageDependencies,
        *,
        clock: Callable[[], datetime],
    ) -> None:
        self.dependencies = dependencies
        self.clock = clock
        self.sources = load_source_definitions(dependencies.policy_path)
        self.sources_by_id = {source.source_id: source for source in self.sources}

    def collect(self, request, *, idempotency_key: str) -> Mapping[str, Any]:
        articles: dict[str, ArticleDocument] = {}
        references: dict[str, str] = {}
        collected_at = self.clock()
        for source in self.sources:
            for endpoint_url in source.endpoint_urls:
                response = self.dependencies.fetcher.fetch(endpoint_url, source_id=source.source_id)
                parsed = self.dependencies.parser.parse(
                    response,
                    source=source,
                    endpoint_url=endpoint_url,
                    collected_at=collected_at,
                )
                for article in parsed:
                    self._validate_article(article, source)
                    # First-writer wins gives deterministic deduplication when
                    # an RSS and a section endpoint expose the same URL.
                    if article.article_id in articles:
                        continue
                    articles[article.article_id] = article
                    references[article.article_id] = self.dependencies.vault.put(
                        request.run_id, article
                    )
        metadata = [
            _metadata(articles[article_id], private_object_ref=references[article_id])
            for article_id in sorted(articles)
        ]
        result = {
            "articleCount": len(metadata),
            "articles": metadata,
            "sourceCount": len(self.sources),
            "sourceIds": sorted(self.sources_by_id),
            "privateBodyObjects": references,
            "idempotencyKey": idempotency_key,
        }
        assert_body_safe(result, context="collection stage")
        return result

    def _validate_article(self, article: ArticleDocument, source: SourceDefinition) -> None:
        if article.source_id != source.source_id:
            raise StageAdapterError("parser returned an article for the wrong source")
        try:
            canonical = canonicalize_url(article.canonical_url)
        except ValueError as error:
            raise StageAdapterError(f"invalid article URL: {article.article_id}") from error
        hostname = urlsplit(canonical).hostname or ""
        if not is_domain_allowed(hostname, source.domains):
            raise StageAdapterError(
                f"article domain is outside source policy: {article.article_id}"
            )
        if canonical != article.canonical_url:
            raise StageAdapterError("parser must canonicalize article URLs before returning them")
        if not article.title.strip() or not article.article_id.strip():
            raise StageAdapterError("article ID and title are required")


class MetadataPersistenceAdapter(PersistenceAdapter):
    def __init__(self, dependencies: StageDependencies) -> None:
        self.dependencies = dependencies

    def persist(self, request, collected, *, idempotency_key: str) -> Mapping[str, Any]:
        rows = collected.get("articles")
        references = collected.get("privateBodyObjects")
        if not isinstance(rows, Sequence) or isinstance(rows, (str, bytes, bytearray)):
            raise StageAdapterError("collection output has no article metadata")
        if not isinstance(references, Mapping):
            raise StageAdapterError("collection output has no private body references")
        articles = [
            self.dependencies.vault.get(request.run_id, str(row["articleId"]))
            for row in rows
            if isinstance(row, Mapping) and str(row.get("articleId", ""))
        ]
        if len(articles) != len(rows):
            raise StageAdapterError("collection metadata does not match private vault")
        persisted = self.dependencies.persistence_sink.persist_articles(
            request.run_id,
            articles,
            private_object_refs={str(key): str(value) for key, value in references.items()},
        )
        result = {
            "persistedArticleCount": len(articles),
            "articles": [dict(row) for row in rows],
            "sinkResult": dict(persisted),
            "idempotencyKey": idempotency_key,
        }
        assert_body_safe(result, context="persist stage")
        return result


def _metadata_articles(rows: Sequence[Mapping[str, Any]]) -> tuple[MetadataArticle, ...]:
    articles: list[MetadataArticle] = []
    for row in rows:
        try:
            articles.append(
                MetadataArticle(
                    article_id=str(row["articleId"]),
                    title=str(row["title"]),
                    source=str(row["sourceId"]),
                    published_at=str(row["publishedAt"]),
                )
            )
        except (KeyError, TypeError) as error:
            raise StageAdapterError("persisted article metadata is incomplete") from error
    return tuple(articles)


class ConservativeCandidateGroupBuilder(CandidateGroupBuilder):
    """One body-free candidate group; InitialFiveClusterer can refine it."""

    def build(
        self,
        articles: Sequence[MetadataArticle],
        *,
        basis_date: str,
    ) -> Sequence[MetadataIssueGroup]:
        if not articles:
            return ()
        return (
            MetadataIssueGroup(
                issue_id=f"candidate-{basis_date}",
                issue_title=f"{basis_date} article candidates",
                articles=tuple(articles),
            ),
        )


class MetadataClusterRankAdapter(ClusterRankAdapter):
    """Reuse InitialFiveClusterer and rank candidates without body text."""

    def __init__(self, dependencies: StageDependencies) -> None:
        self.dependencies = dependencies

    def cluster_rank(self, request, persisted, *, idempotency_key: str) -> Mapping[str, Any]:
        rows = persisted.get("articles")
        if not isinstance(rows, Sequence) or isinstance(rows, (str, bytes, bytearray)):
            raise StageAdapterError("persist output has no article metadata")
        metadata_articles = _metadata_articles(rows)
        groups = tuple(
            self.dependencies.candidate_builder.build(
                metadata_articles,
                basis_date=request.basis_date,
            )
        )
        clustering = self.dependencies.initial_five_clusterer.analyze(
            metadata_articles,
            groups,
        )
        cluster_rows = [dict(cluster) for cluster in clustering.clusters]
        ranked = sorted(
            cluster_rows,
            key=lambda cluster: (
                -len(cluster.get("article_assignments", [])),
                str(cluster.get("cluster_id", "")),
            ),
        )
        top5 = [
            {
                "issueId": str(cluster["cluster_id"]),
                "title": str(cluster["label"]),
                "articleIds": [
                    str(assignment["article_id"])
                    for assignment in cluster.get("article_assignments", [])
                    if assignment.get("relation") == "same_event"
                ],
                "coherence": cluster.get("coherence"),
            }
            for cluster in ranked[:5]
        ]
        result = {
            "articles": [
                {
                    "articleId": article.article_id,
                    "title": article.title,
                    "sourceId": article.source,
                    "publishedAt": article.published_at,
                }
                for article in metadata_articles
            ],
            "clusters": ranked,
            "top5": top5,
            "clustering": clustering.as_dict(),
            "idempotencyKey": idempotency_key,
        }
        assert_body_safe(result, context="cluster/rank stage")
        return result


def _public_evidence(profile: Mapping[str, Any]) -> Mapping[str, Any] | None:
    evidence = _public_evidence_rows(profile, article_id="")
    if not evidence:
        return None
    first = evidence[0]
    return {
        "locator": dict(first["locator"]),
        # Keep this helper's legacy snake_case shape for the quality-gate
        # adapter; the site-facing profile entries use ``sentenceSha256``.
        "sentence_sha256": first["sentenceSha256"],
    }


_PUBLIC_SENTENCE_HASH = re.compile(r"^[0-9a-fA-F]{64}$")


def _public_evidence_rows(
    profile: Mapping[str, Any], *, article_id: str
) -> list[dict[str, Any]]:
    """Collect only locator+hash evidence for the site's public contract."""

    found: list[dict[str, Any]] = []
    seen: set[tuple[Any, ...]] = set()

    def add(value: object) -> None:
        if not isinstance(value, Mapping):
            return
        locator = value.get("locator")
        sentence_hash = value.get("sentence_sha256") or value.get("sentenceSha256")
        if not isinstance(locator, Mapping) or not isinstance(sentence_hash, str):
            return
        paragraph = locator.get("paragraph")
        sentence = locator.get("sentence")
        if paragraph in (None, "") or sentence in (None, ""):
            return
        if not _PUBLIC_SENTENCE_HASH.fullmatch(sentence_hash):
            return
        key = (article_id, paragraph, sentence, sentence_hash)
        if key in seen:
            return
        seen.add(key)
        found.append(
            {
                "articleId": article_id,
                "locator": {"paragraph": paragraph, "sentence": sentence},
                "sentenceSha256": sentence_hash,
            }
        )

    dimensions = profile.get("dimensions")
    if isinstance(dimensions, Mapping):
        for dimension in dimensions.values():
            if not isinstance(dimension, Mapping):
                continue
            items = dimension.get("items")
            if not isinstance(items, Sequence) or isinstance(items, (str, bytes, bytearray)):
                continue
            for item in items:
                if not isinstance(item, Mapping):
                    continue
                add(item.get("evidence"))
    for actor in profile.get("actors_and_sources", []):
        if isinstance(actor, Mapping):
            for evidence in actor.get("evidence", []):
                add(evidence)
    for key in ("genre", "scope", "context_depth"):
        value = profile.get(key)
        if isinstance(value, Mapping):
            for evidence in value.get("evidence", []):
                add(evidence)
    descriptors = profile.get("secondary_descriptors")
    if isinstance(descriptors, Mapping):
        for rows in descriptors.values():
            for row in rows if isinstance(rows, Sequence) and not isinstance(rows, (str, bytes, bytearray)) else ():
                if isinstance(row, Mapping):
                    for evidence in row.get("evidence", []):
                        add(evidence)
    for device in profile.get("framing_devices", []):
        if isinstance(device, Mapping):
            for evidence in device.get("evidence", []):
                add(evidence)
    return found


def _engine_metadata(
    profile: Mapping[str, Any],
    *,
    article_id: str,
    body_hash: str | None,
    request: Any,
) -> dict[str, Any]:
    engine = profile.get("engine") if isinstance(profile.get("engine"), Mapping) else {}
    lineage = profile.get("lineage") if isinstance(profile.get("lineage"), Mapping) else {}
    model = str(engine.get("version") or lineage.get("model_id") or request.model_revision)
    prompt = str(engine.get("prompt_version") or lineage.get("prompt_version") or request.prompt_version)
    schema = engine.get("analysis_schema_version") or profile.get("schema_version") or 3
    return {
        "label": "ai_semantic",
        "engineLabel": "ai_semantic",
        "semanticAi": bool(engine.get("semantic_ai", True)),
        "status": "succeeded",
        "model": model,
        "promptVersion": prompt,
        "schemaVersion": schema,
        "source": "gcp:vertex-evidence-profile",
        "articleId": article_id,
        "evidenceCount": len(_public_evidence_rows(profile, article_id=article_id)),
        "bodySha256": body_hash,
        "reviewRequired": bool(profile.get("review", {}).get("requires_human_review", True))
        if isinstance(profile.get("review"), Mapping)
        else True,
        "fallbackReason": profile.get("review", {}).get("fallback_reason")
        if isinstance(profile.get("review"), Mapping)
        else None,
    }


def _comparison_axes(
    profile_entries: Sequence[Mapping[str, Any]],
    *,
    article_count: int,
) -> list[dict[str, Any]]:
    """Derive comparison rows from observed profile items, never from intent."""

    dimensions: dict[str, dict[tuple[str, str], dict[str, Any]]] = {}
    observed: dict[str, set[str]] = {}
    for entry in profile_entries:
        article_id = str(entry.get("articleId", ""))
        profile = entry.get("profile")
        if not article_id or not isinstance(profile, Mapping):
            continue
        raw_dimensions = profile.get("dimensions")
        if not isinstance(raw_dimensions, Mapping):
            continue
        for dimension, raw_dimension in raw_dimensions.items():
            if not isinstance(raw_dimension, Mapping):
                continue
            items = raw_dimension.get("items")
            if not isinstance(items, Sequence) or isinstance(items, (str, bytes, bytearray)):
                continue
            for item in items:
                if not isinstance(item, Mapping):
                    continue
                paraphrase = str(item.get("public_paraphrase") or "").strip()
                evidence = item.get("evidence")
                if not paraphrase or not isinstance(evidence, Mapping):
                    continue
                evidence_rows = _public_evidence_rows(
                    {"dimensions": {dimension: {"items": [item]}}},
                    article_id=article_id,
                )
                if not evidence_rows:
                    continue
                voice = item.get("voice") if isinstance(item.get("voice"), Mapping) else {}
                voice_kind = str(voice.get("kind") or "")
                scope = "outlet_narration" if voice_kind == "journalist_narration" else "attributed_source"
                key = (scope, paraphrase)
                groups = dimensions.setdefault(str(dimension), {})
                group = groups.setdefault(
                    key,
                    {
                        "public_paraphrase": paraphrase,
                        "voice_scope": scope,
                        "article_ids": [],
                        "evidence": [],
                    },
                )
                if article_id not in group["article_ids"]:
                    group["article_ids"].append(article_id)
                    observed.setdefault(str(dimension), set()).add(article_id)
                group["evidence"].extend(evidence_rows)
    axes: list[dict[str, Any]] = []
    for dimension, groups in sorted(dimensions.items()):
        patterns = []
        for group in groups.values():
            evidence = []
            seen = set()
            for row in group["evidence"]:
                key = (row.get("articleId"), row["locator"].get("paragraph"), row["locator"].get("sentence"), row["sentenceSha256"])
                if key in seen:
                    continue
                seen.add(key)
                evidence.append(
                    {
                        "article_id": row["articleId"],
                        "locator": row["locator"],
                        "sentence_sha256": row["sentenceSha256"],
                    }
                )
            patterns.append(
                {
                    "public_paraphrase": group["public_paraphrase"],
                    "article_count": len(group["article_ids"]),
                    "voice_scope": group["voice_scope"],
                    "article_ids": group["article_ids"],
                    "evidence": evidence,
                }
            )
        axes.append(
            {
                "dimension": dimension,
                "label": dimension,
                "observed_article_count": len(observed.get(dimension, set())),
                "not_observed_article_count": max(0, article_count - len(observed.get(dimension, set()))),
                "patterns": patterns,
            }
        )
    return axes


class FrameSemanticAdapter(SemanticAdapter):
    """Analyze articles in the top five with the injected Vertex analyzer."""

    def __init__(self, dependencies: StageDependencies) -> None:
        self.dependencies = dependencies

    def analyze_top5(self, request, ranked, *, idempotency_key: str) -> Mapping[str, Any]:
        top5 = ranked.get("top5")
        if not isinstance(top5, Sequence) or isinstance(top5, (str, bytes, bytearray)):
            raise StageAdapterError("rank output has no top5 candidates")
        if len(top5) != 5:
            raise StageAdapterError("semantic stage requires exactly five ranked issues")

        bundles: dict[str, Any] = {}
        public_issues: list[dict[str, Any]] = []
        analyzed = 0
        missing_evidence = 0
        for issue in top5:
            if not isinstance(issue, Mapping):
                raise StageAdapterError("top5 issue row is invalid")
            issue_id = str(issue.get("issueId", "")).strip()
            article_ids = issue.get("articleIds")
            if (
                not issue_id
                or not isinstance(article_ids, Sequence)
                or isinstance(article_ids, (str, bytes, bytearray))
            ):
                raise StageAdapterError("top5 issue lacks issue ID or article IDs")
            profiles: list[dict[str, Any]] = []
            article_rows: list[dict[str, Any]] = []
            # ``articles`` is the site's metadata-only InitialFiveArticle
            # shape.  The quality gate intentionally receives a separate
            # evidence-bearing projection; evidence is not an InitialFive
            # article field and must not leak into the UI metadata object.
            quality_rows: list[dict[str, Any]] = []
            for article_id in article_ids:
                article = self.dependencies.vault.get(request.run_id, str(article_id))
                result: FrameResult = self.dependencies.frame_analyzer.analyze(article)
                row = publication_row(article, result)
                profile = row.get("profile")
                if not isinstance(profile, Mapping):
                    raise StageAdapterError(
                        f"semantic analyzer returned no public profile: {article_id}"
                    )
                evidence = _public_evidence(profile)
                if evidence is None:
                    missing_evidence += 1
                    continue
                evidence_rows = _public_evidence_rows(profile, article_id=article.article_id)
                engine = _engine_metadata(
                    profile,
                    article_id=article.article_id,
                    body_hash=article.body_hash,
                    request=request,
                )
                article_rows.append(
                    {
                        "articleId": article.article_id,
                        "id": article.article_id,
                        "sourceId": article.source_id,
                        "outlet": article.source_id,
                        "mediaGroupId": None,
                        "canonicalUrl": article.canonical_url,
                        "title": article.title,
                        "publishedAt": article.published_at.isoformat(),
                        "section": article.section,
                        "bodySha256": article.body_hash,
                        "issueId": issue_id,
                    }
                )
                quality_rows.append(
                    {
                        "articleId": article.article_id,
                        "sourceId": article.source_id,
                        "sourceUrl": article.canonical_url,
                        "title": article.title,
                        "evidence": {
                            "locator": dict(evidence["locator"]),
                            "sentence_sha256": evidence["sentence_sha256"],
                        },
                    }
                )
                profiles.append(
                    {
                        "articleId": article.article_id,
                        "status": "succeeded",
                        "engine": engine,
                        "evidence": evidence_rows,
                        "profile": dict(profile),
                    }
                )
                analyzed += 1
            if not article_rows:
                raise StageAdapterError(f"top5 issue {issue_id} has no evidence-backed article")
            article_count = len(article_rows)
            outlet_count = len({str(row["outlet"]) for row in article_rows})
            comparison_axes = _comparison_axes(profiles, article_count=article_count)
            semantic_engine = {
                "label": "ai_semantic",
                "engineLabel": "ai_semantic",
                "semanticAi": True,
                "status": "succeeded",
                "model": getattr(request, "model_revision", "vertex-configured"),
                "promptVersion": getattr(request, "prompt_version", "runtime-configured"),
                "schemaVersion": "agendaframe.article-frame-profile.v2",
                "source": "gcp:vertex-evidence-profile",
                "articleCount": article_count,
                "succeededArticleCount": len(profiles),
                "reviewNeededArticleCount": 0,
                "requiresHumanReview": True,
            }
            cluster_engine = {
                "label": "ai_semantic",
                "engineLabel": "ai_semantic",
                "semanticAi": True,
                "status": "succeeded",
                "model": getattr(request, "model_revision", "vertex-configured"),
                "promptVersion": getattr(request, "prompt_version", "runtime-configured"),
                "schemaVersion": 1,
                "source": "gcp:metadata-cluster-rank",
                "decision": "analyze",
                "coherence": issue.get("coherence"),
                "requiresHumanReview": True,
            }
            bundles[issue_id] = {
                "schemaVersion": "agendaframe.initial-five.public.v1",
                "basisDate": request.basis_date,
                "status": "succeeded",
                "issue": {
                    "issueId": issue_id,
                    "rank": len(public_issues) + 1,
                    "title": str(issue.get("title", issue_id)),
                    "category": None,
                    "articleCount": article_count,
                    "outletCount": outlet_count,
                },
                "analysisStatus": {
                    "state": "succeeded",
                    "cluster": cluster_engine,
                    "semantic": semantic_engine,
                },
                "clusterAi": {
                    **cluster_engine,
                    "textScope": "title_source_published_at_only",
                    "fallbackReason": None,
                    "summary": None,
                    "commonSubjects": [],
                    "narrativeVariants": [],
                    "outlierArticleIds": [],
                    "articleIds": [row["articleId"] for row in article_rows],
                },
                "articles": article_rows,
                "semanticProfiles": profiles,
                "ruleProfiles": [
                    {
                        "articleId": row["articleId"],
                        "status": "review_needed",
                        "engine": {
                            "label": "unavailable",
                            "engineLabel": "unavailable",
                            "semanticAi": False,
                            "status": "review_needed",
                            "model": None,
                            "promptVersion": None,
                            "schemaVersion": None,
                            "source": "gcp:rules-local-adapter-not-bound",
                            "articleId": row["articleId"],
                            "evidenceCount": 0,
                            "bodySha256": row["bodySha256"],
                        },
                        "evidence": [],
                        "profile": None,
                    }
                    for row in article_rows
                ],
                "comparison": {
                    "engine": {
                        "label": "rules_local",
                        "engineLabel": "rules_local",
                        "semanticAi": False,
                        "status": "succeeded",
                        "model": None,
                        "promptVersion": None,
                        "schemaVersion": "comparison-v1",
                        "source": "gcp:public-profile-aggregation",
                    },
                    "data": {
                        "summary_30_seconds": {
                            "sample": f"{article_count}건 · {outlet_count}개 매체",
                            "common_ground": "AI 프로필에서 동일하게 관측된 항목만 집계합니다.",
                            "main_difference": "검증된 기사별 관측 항목과 취재원 귀속을 비교합니다.",
                            "source_context": "출처 배치와 공출현은 언론사의 의도·성향을 뜻하지 않습니다.",
                            "limit": "의도나 정치적 성향은 추론하지 않으며, locator와 hash가 있는 관측만 표시합니다.",
                        },
                        "comparison_axes": comparison_axes,
                        "source_lens": {
                            "by_outlet": [],
                            "caution": "취재원 구성은 발화 가시성의 관측이지 매체의 의도 판정이 아닙니다.",
                        },
                    },
                    "evidence": [
                        evidence
                        for entry in profiles
                        for evidence in entry["evidence"]
                    ],
                },
                "coderAgreement": None,
                "lineage": {
                    "contractVersion": "agendaframe.initial-five.public.v1",
                    "basisDate": request.basis_date,
                    "source": {
                        "top5SchemaVersion": "agendaframe.top5-framing-gcp.v1",
                        "top5GeneratedAt": None,
                        "metadataSchemaVersion": "agendaframe.metadata-issue-cluster.v1",
                        "metadataGeneratedAt": None,
                        "semanticDirectory": "gcp:vertex",
                        "semanticFileCount": len(profiles),
                    },
                    "issueId": issue_id,
                },
            }
            public_issues.append(
                {
                    "issueId": issue_id,
                    "title": str(issue.get("title", issue_id)),
                    "articles": quality_rows,
                    "articleCount": article_count,
                    "outletCount": outlet_count,
                    "rank": len(public_issues) + 1,
                    "status": "succeeded",
                    "semantic": semantic_engine,
                    "clusterAi": cluster_engine,
                }
            )
        result = {
            "unsupportedClaimRate": 1.0 if missing_evidence else 0.0,
            "manifest": {
                "schemaVersion": "agenda.frame.active-snapshot.v1",
                "issueCount": len(public_issues),
                "rawBodyAbsent": True,
            },
            "bundles": bundles,
            "top5": public_issues,
            "analyzedArticleCount": analyzed,
            "idempotencyKey": idempotency_key,
        }
        assert_body_safe(result, context="semantic stage")
        return result


class SnapshotPublishAdapter(SnapshotStore):
    """Connect immutable object and active-pointer stores to publish stage."""

    def __init__(self, writer: ImmutableObjectWriter, pointers: ActivePointerStore) -> None:
        self.writer = writer
        self.pointers = pointers

    def put_immutable(self, objects: Mapping[str, Mapping[str, Any]]) -> None:
        assert_body_safe(objects, context="immutable snapshot objects")
        self.writer.put_immutable(objects)

    def read_current_pointer(self) -> Mapping[str, Any] | None:
        return self.pointers.read_current_pointer()

    def update_current_pointer(self, pointer: Mapping[str, Any]) -> None:
        assert_body_safe(pointer, context="active snapshot pointer")
        self.pointers.update_current_pointer(pointer)

    def read_public_manifest(self, pointer: Mapping[str, Any]) -> Mapping[str, Any]:
        reader = getattr(self.writer, "read_public_manifest", None)
        if not callable(reader):
            raise StageAdapterError(
                "immutable writer must expose read_public_manifest for validation"
            )
        manifest = reader(pointer)
        if not isinstance(manifest, Mapping):
            raise StageAdapterError("active manifest must be an object")
        assert_body_safe(manifest, context="active snapshot manifest")
        return manifest


def build_stage_adapters(
    dependencies: StageDependencies,
    *,
    clock: Callable[[], datetime] | None = None,
) -> PipelineAdapters:
    """Construct all orchestration stages from explicit dependencies."""

    return PipelineAdapters(
        collection=PolicyCollectionAdapter(dependencies, clock=clock or datetime.now),
        persistence=MetadataPersistenceAdapter(dependencies),
        cluster_rank=MetadataClusterRankAdapter(dependencies),
        semantic=FrameSemanticAdapter(dependencies),
        snapshots=SnapshotPublishAdapter(
            dependencies.immutable_writer,
            dependencies.pointer_store,
        ),
    )


def production_stage_adapter_factory(
    clients: Any,
    config: RuntimeConfig,
    runtime: GcpRuntimeConfig,
) -> PipelineAdapters:
    """Explicit binding hook for Cloud Run; concrete I/O bindings are required.

    Client construction alone is not enough to safely infer an RSS parser,
    metadata sink, or snapshot pointer semantics.  The deployment must provide
    ``AGENDAFRAME_STAGE_DEPENDENCIES_FACTORY`` (module:function) that receives
    the lazy-created clients and returns ``StageDependencies``.
    """

    import importlib
    import os

    spec = os.getenv(
        "AGENDAFRAME_STAGE_DEPENDENCIES_FACTORY",
        "backend.gcp_live_dependencies:build_stage_dependencies",
    ).strip()
    if ":" not in spec:
        raise RuntimeAdapterUnavailable(
            "AGENDAFRAME_STAGE_DEPENDENCIES_FACTORY must provide module:function"
        )
    module_name, attribute_name = spec.split(":", 1)
    try:
        module = importlib.import_module(module_name)
        factory = getattr(module, attribute_name)
    except (ImportError, AttributeError) as error:
        raise RuntimeAdapterUnavailable(
            "cannot load stage dependencies factory"
        ) from error
    if not callable(factory):
        raise RuntimeAdapterUnavailable("stage dependencies factory is not callable")
    dependencies = factory(clients, config, runtime)
    if not isinstance(dependencies, StageDependencies):
        raise RuntimeAdapterUnavailable("stage dependencies factory returned an invalid object")
    return build_stage_adapters(dependencies)


__all__ = [
    "ArticleParser",
    "CandidateGroupBuilder",
    "ConservativeCandidateGroupBuilder",
    "FeedFetcher",
    "FrameSemanticAdapter",
    "GcpAnalysisStoreMetadataSink",
    "ImmutableObjectWriter",
    "MetadataPersistenceAdapter",
    "MetadataPersistenceSink",
    "MetadataClusterRankAdapter",
    "PolicyCollectionAdapter",
    "PrivateArticleVault",
    "SnapshotPublishAdapter",
    "SourceDefinition",
    "StageAdapterError",
    "StageDependencies",
    "build_stage_adapters",
    "build_vertex_frame_analyzer",
    "load_source_definitions",
    "production_stage_adapter_factory",
]
