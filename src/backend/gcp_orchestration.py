"""Offline-safe orchestration contract for the AgendaFrame GCP pipeline.

This module deliberately contains no Google Cloud SDK imports and performs no
network calls.  Production adapters can implement the small protocols below
for Cloud Run, BigQuery, Vertex AI, Pub/Sub, and Cloud Storage.  The workflow
semantics stay testable with in-memory fakes:

``collect -> persist -> cluster_rank -> top5_semantic -> quality_gate -> publish``

Only metadata, private-object references, and public evidence locators are
allowed to cross a stage boundary.  Raw article text is never accepted into a
durable stage result or a public snapshot.
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Callable, Mapping, Protocol, Sequence

FORBIDDEN_BODY_KEYS = frozenset(
    {
        "body_text",
        "bodytext",
        "raw_body",
        "rawbody",
        "html",
        "sentence_text",
        "sentencetext",
        "full_article",
        "fullarticle",
        "article_content",
        "articlecontent",
        "full_content",
        "fullcontent",
        "prompt_payload",
        "promptpayload",
        "evidence_text",
        "evidencetext",
    }
)

STAGE_ORDER = (
    "collect",
    "persist",
    "cluster_rank",
    "top5_semantic",
    "quality_gate",
    "publish",
)


class OrchestrationError(RuntimeError):
    """Base exception for a deterministic pipeline failure."""


class StageExecutionError(OrchestrationError):
    """A stage exhausted its bounded retry policy."""

    def __init__(self, stage: str, attempts: int, cause: Exception) -> None:
        self.stage = stage
        self.attempts = attempts
        self.cause = cause
        super().__init__(f"stage {stage!r} failed after {attempts} attempt(s): {cause}")


class QualityGateError(OrchestrationError):
    """The candidate result cannot become publicly visible."""


class SnapshotPublicationError(OrchestrationError):
    """Immutable objects could not be published or the pointer could not move."""


class IdempotencyStore(Protocol):
    def get(self, key: str) -> object: ...

    def put(self, key: str, value: object) -> None: ...


class SnapshotStore(Protocol):
    def put_immutable(self, objects: Mapping[str, Mapping[str, Any]]) -> None: ...

    def read_current_pointer(self) -> Mapping[str, Any] | None: ...

    def update_current_pointer(self, pointer: Mapping[str, Any]) -> None: ...


class CollectionAdapter(Protocol):
    def collect(self, request: "OrchestrationRequest", *, idempotency_key: str) -> Mapping[str, Any]: ...


class PersistenceAdapter(Protocol):
    def persist(
        self,
        request: "OrchestrationRequest",
        collected: Mapping[str, Any],
        *,
        idempotency_key: str,
    ) -> Mapping[str, Any]: ...


class ClusterRankAdapter(Protocol):
    def cluster_rank(
        self,
        request: "OrchestrationRequest",
        persisted: Mapping[str, Any],
        *,
        idempotency_key: str,
    ) -> Mapping[str, Any]: ...


class SemanticAdapter(Protocol):
    def analyze_top5(
        self,
        request: "OrchestrationRequest",
        ranked: Mapping[str, Any],
        *,
        idempotency_key: str,
    ) -> Mapping[str, Any]: ...


@dataclass(frozen=True)
class OrchestrationRequest:
    """Immutable trigger metadata passed to every adapter."""

    run_id: str
    basis_date: str
    source_policy_version: str
    model_revision: str
    prompt_version: str
    raw_content_delete_after: str = "2026-10-31T23:59:59+09:00"
    top5_limit: int = 5
    started_at: str = ""

    def __post_init__(self) -> None:
        if not self.run_id.strip():
            raise ValueError("run_id must not be empty")
        if not self.basis_date.strip():
            raise ValueError("basis_date must not be empty")
        if not self.source_policy_version.strip():
            raise ValueError("source_policy_version must not be empty")
        if not self.model_revision.strip() or not self.prompt_version.strip():
            raise ValueError("model_revision and prompt_version must not be empty")
        if self.top5_limit != 5:
            raise ValueError("AgendaFrame public workflow is limited to exactly five top issues")

    @property
    def trigger_idempotency_key(self) -> str:
        return f"{self.run_id}:trigger"


@dataclass(frozen=True)
class StagePolicy:
    max_attempts: int
    retryable: Callable[[Exception], bool] = lambda _error: True

    def __post_init__(self) -> None:
        if not isinstance(self.max_attempts, int) or self.max_attempts < 1:
            raise ValueError("stage max_attempts must be a positive integer")


DEFAULT_STAGE_POLICIES: Mapping[str, StagePolicy] = {
    "collect": StagePolicy(3),
    "persist": StagePolicy(3),
    "cluster_rank": StagePolicy(2),
    "top5_semantic": StagePolicy(3),
    "quality_gate": StagePolicy(1),
    "publish": StagePolicy(2),
}


@dataclass(frozen=True)
class PipelineAdapters:
    collection: CollectionAdapter
    persistence: PersistenceAdapter
    cluster_rank: ClusterRankAdapter
    semantic: SemanticAdapter
    snapshots: SnapshotStore


@dataclass(frozen=True)
class StageRecord:
    name: str
    status: str
    attempts: int
    idempotency_key: str
    reused: bool = False
    error: str | None = None


@dataclass(frozen=True)
class OrchestrationResult:
    run_id: str
    status: str
    stage_records: tuple[StageRecord, ...]
    snapshot_id: str | None = None
    current_pointer: Mapping[str, Any] | None = None
    error: str | None = None


MISSING = object()


class InMemoryIdempotencyStore:
    """Small fake useful for contract tests; not a production persistence layer."""

    def __init__(self) -> None:
        self.values: dict[str, object] = {}

    def get(self, key: str) -> object:
        return self.values.get(key, MISSING)

    def put(self, key: str, value: object) -> None:
        if key in self.values and self.values[key] != value:
            raise OrchestrationError(f"idempotency key already has a different result: {key}")
        self.values[key] = value


def _normalise_key(key: object) -> str:
    return str(key).strip().casefold().replace("-", "_")


def forbidden_body_paths(value: object, path: str = "") -> tuple[str, ...]:
    """Return paths containing fields that must never be durable/public."""

    found: list[str] = []
    if isinstance(value, Mapping):
        for key, child in value.items():
            child_path = f"{path}.{key}" if path else str(key)
            if _normalise_key(key) in FORBIDDEN_BODY_KEYS:
                found.append(child_path)
            found.extend(forbidden_body_paths(child, child_path))
    elif isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray)):
        for index, child in enumerate(value):
            found.extend(forbidden_body_paths(child, f"{path}[{index}]"))
    return tuple(found)


def assert_body_safe(value: object, *, context: str) -> None:
    hits = forbidden_body_paths(value)
    if hits:
        raise QualityGateError(f"{context} contains forbidden raw-body fields: {', '.join(hits)}")


def _canonical_json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str)


def canonical_json_sha256(value: object) -> str:
    """Return the digest used to bind a published manifest to its pointer.

    The snapshot reader is intentionally kept independent from the storage
    SDK.  Sharing this exact canonicalisation rule between the publisher and
    reader prevents a stale or substituted manifest from being served under a
    valid-looking ``current.json`` pointer.
    """

    return hashlib.sha256(_canonical_json(value).encode("utf-8")).hexdigest()


def snapshot_id_for(*, request: OrchestrationRequest, public_payload: Mapping[str, Any]) -> str:
    material = {
        "basisDate": request.basis_date,
        "runId": request.run_id,
        "sourcePolicyVersion": request.source_policy_version,
        "modelRevision": request.model_revision,
        "promptVersion": request.prompt_version,
        "payload": public_payload,
    }
    return hashlib.sha256(_canonical_json(material).encode("utf-8")).hexdigest()[:32]


def _as_mapping(value: object, *, context: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise OrchestrationError(f"{context} must return a mapping")
    return value


def _issue_list(value: Mapping[str, Any]) -> list[Mapping[str, Any]]:
    candidate = value.get("top5", value.get("issues", value.get("rankedIssues", [])))
    if not isinstance(candidate, Sequence) or isinstance(candidate, (str, bytes, bytearray)):
        return []
    return [item for item in candidate if isinstance(item, Mapping)]


def _manifest_issue_rows(
    issues: Sequence[Mapping[str, Any]], bundles: Mapping[str, Any]
) -> list[dict[str, Any]]:
    """Build the metadata-only issue list consumed by the public main shell.

    The orchestration adapters may use snake_case or camelCase internally, but
    the active snapshot has one stable shape.  Only counts, labels and IDs are
    copied; arbitrary adapter fields (including any private body fields) never
    cross this boundary.
    """

    rows: list[dict[str, Any]] = []
    for rank, issue in enumerate(issues, 1):
        issue_id = str(issue.get("issueId", issue.get("issue_id", issue.get("id"))))
        bundle = bundles.get(issue_id)
        bundle_map = bundle if isinstance(bundle, Mapping) else {}
        article_rows = issue.get("articles", issue.get("articleProfiles", []))
        if not isinstance(article_rows, Sequence) or isinstance(article_rows, (str, bytes, bytearray)):
            article_rows = bundle_map.get("articles", [])
        article_rows = article_rows if isinstance(article_rows, Sequence) and not isinstance(article_rows, (str, bytes, bytearray)) else []
        article_ids = {
            str(article.get("articleId", article.get("article_id")))
            for article in article_rows
            if isinstance(article, Mapping)
            and str(article.get("articleId", article.get("article_id", ""))).strip()
        }
        outlets = {
            str(article.get("outlet", article.get("sourceId", article.get("source_id"))))
            for article in article_rows
            if isinstance(article, Mapping)
            and str(article.get("outlet", article.get("sourceId", article.get("source_id", "")))).strip()
        }
        article_count = issue.get("articleCount", issue.get("article_count", len(article_ids)))
        outlet_count = issue.get("outletCount", issue.get("outlet_count", len(outlets)))
        article_count = int(article_count) if isinstance(article_count, (int, float)) else len(article_ids)
        outlet_count = int(outlet_count) if isinstance(outlet_count, (int, float)) else len(outlets)
        cluster_ai = dict(issue.get("clusterAi", issue.get("cluster_ai", {})))
        cluster_ai.setdefault("status", "succeeded")
        cluster_ai.setdefault("engineLabel", "ai_semantic")
        cluster_ai.setdefault("semanticAi", True)
        semantic = dict(issue.get("semantic", {}))
        semantic.setdefault("status", "succeeded")
        semantic.setdefault("engineLabel", "ai_semantic")
        semantic.setdefault("semanticAi", True)
        semantic.setdefault("succeededArticleCount", article_count)
        semantic.setdefault("reviewNeededArticleCount", 0)
        rows.append(
            {
                "issueId": issue_id,
                "rank": int(issue.get("rank", rank)),
                "title": str(issue.get("title", issue.get("issueTitle", issue_id))),
                "category": issue.get("category"),
                "articleCount": article_count,
                "outletCount": outlet_count,
                "status": str(issue.get("status", "succeeded")),
                "payloadKey": f"issues/{issue_id}.json",
                "clusterAi": cluster_ai,
                "semantic": semantic,
            }
        )
    return rows


_SENTENCE_SHA256 = re.compile(r"^[0-9a-fA-F]{64}$")


def _has_evidence(article: Mapping[str, Any]) -> bool:
    """Require a public locator *and* a sentence fingerprint.

    A bare locator is not enough to establish evidence lineage: paragraph and
    sentence numbers can be reused after source updates.  Conversely, a hash
    without a location cannot be audited by a researcher.  The public GCP
    contract therefore requires both fields while still accepting the legacy
    camel-case aliases used by older adapters.
    """

    evidence_value = article.get("evidence")
    if evidence_value is None:
        evidence_value = article.get("evidenceRefs")

    # The canonical shape is {locator: {paragraph, sentence},
    # sentence_sha256: <64 hex>}.  Keep the aliases only for an adapter
    # transition; all forms still have to provide both values.
    evidence: Mapping[str, Any] | None = evidence_value if isinstance(evidence_value, Mapping) else None
    locator: object = None
    sentence_hash: object = None
    if evidence is not None:
        locator = evidence.get("locator")
        sentence_hash = (
            evidence.get("sentence_sha256")
            or evidence.get("sentenceHash")
            or evidence.get("hash")
        )

    if locator is None:
        locator = article.get("evidenceLocator") or article.get("locator")
    if sentence_hash is None:
        sentence_hash = (
            article.get("sentence_sha256")
            or article.get("sentenceHash")
            or article.get("evidenceHash")
        )

    if isinstance(locator, Mapping):
        paragraph = locator.get("paragraph")
        sentence = locator.get("sentence")
        has_locator = paragraph not in (None, "") and sentence not in (None, "")
    elif isinstance(locator, str):
        has_locator = bool(locator.strip())
    else:
        has_locator = False

    return has_locator and isinstance(sentence_hash, str) and bool(_SENTENCE_SHA256.fullmatch(sentence_hash))


def evaluate_quality_gate(
    semantic: Mapping[str, Any],
    *,
    top5_limit: int = 5,
    unsupported_claim_rate_limit: float = 0.02,
) -> Mapping[str, Any]:
    """Validate the public semantic candidate without making model calls."""

    assert_body_safe(semantic, context="semantic output")
    issues = _issue_list(semantic)
    if len(issues) != top5_limit:
        raise QualityGateError(f"semantic output must contain exactly {top5_limit} top issues")
    manifest = semantic.get("manifest")
    bundles = semantic.get("bundles")
    if not isinstance(manifest, Mapping):
        raise QualityGateError("semantic output must contain the public snapshot manifest")
    if not isinstance(bundles, Mapping):
        raise QualityGateError("semantic output must contain public issue bundles")
    if manifest.get("issueCount") != top5_limit:
        raise QualityGateError("public snapshot manifest issueCount must match top5")
    unsupported = semantic.get("unsupportedClaimRate", semantic.get("unsupported_claim_rate", 0.0))
    try:
        unsupported_rate = float(unsupported)
    except (TypeError, ValueError) as error:
        raise QualityGateError("unsupported claim rate is not numeric") from error
    if unsupported_rate > unsupported_claim_rate_limit:
        raise QualityGateError(
            f"unsupported claim rate {unsupported_rate:.4f} exceeds {unsupported_claim_rate_limit:.4f}"
        )

    article_count = 0
    issue_ids: set[str] = set()
    for index, issue in enumerate(issues, 1):
        issue_id = issue.get("issueId", issue.get("issue_id", issue.get("id")))
        if not str(issue_id or "").strip():
            raise QualityGateError(f"top issue {index} has no issue ID")
        if issue_id in issue_ids:
            raise QualityGateError(f"top issue {issue_id} is duplicated")
        issue_ids.add(str(issue_id))
        if issue_id not in bundles or not isinstance(bundles[issue_id], Mapping):
            raise QualityGateError(f"top issue {issue_id} has no public issue bundle")
        articles = issue.get("articles", issue.get("articleProfiles", []))
        if not isinstance(articles, Sequence) or isinstance(articles, (str, bytes, bytearray)) or not articles:
            raise QualityGateError(f"top issue {issue_id} has no article evidence")
        for article in articles:
            if not isinstance(article, Mapping):
                raise QualityGateError(f"top issue {issue_id} contains an invalid article evidence row")
            article_id = article.get("articleId", article.get("article_id"))
            if not str(article_id or "").strip() or not _has_evidence(article):
                raise QualityGateError(f"top issue {issue_id} has an article without evidence lineage")
            article_count += 1
    if set(bundles) != issue_ids:
        raise QualityGateError("public issue bundles must match the exact top-five issue IDs")

    return {
        "status": "pass",
        "topIssueCount": len(issues),
        "analyzedArticleCount": article_count,
        "unsupportedClaimRate": unsupported_rate,
        "rawBodyAbsent": True,
        "evidenceLineageComplete": True,
        "publicSnapshotReady": True,
    }


class GcpPipelineOrchestrator:
    """Run the six GCP stages through injected adapters and durable contracts."""

    def __init__(
        self,
        adapters: PipelineAdapters,
        *,
        idempotency: IdempotencyStore | None = None,
        stage_policies: Mapping[str, StagePolicy] | None = None,
        clock: Callable[[], datetime] | None = None,
    ) -> None:
        self.adapters = adapters
        self.idempotency = idempotency or InMemoryIdempotencyStore()
        self.stage_policies = dict(stage_policies or DEFAULT_STAGE_POLICIES)
        missing = set(STAGE_ORDER) - self.stage_policies.keys()
        if missing:
            raise ValueError(f"missing stage policies: {', '.join(sorted(missing))}")
        self.clock = clock or (lambda: datetime.now(UTC))

    def _stage(
        self,
        name: str,
        key: str,
        fn: Callable[[], Mapping[str, Any]],
        records: list[StageRecord],
    ) -> Mapping[str, Any]:
        cached = self.idempotency.get(key)
        if cached is not MISSING:
            result = _as_mapping(cached, context=f"cached {name}")
            assert_body_safe(result, context=f"cached {name}")
            records.append(StageRecord(name, "reused", 0, key, reused=True))
            return result

        policy = self.stage_policies[name]
        last_error: Exception | None = None
        for attempt in range(1, policy.max_attempts + 1):
            try:
                result = _as_mapping(fn(), context=name)
                assert_body_safe(result, context=name)
                self.idempotency.put(key, dict(result))
                records.append(StageRecord(name, "succeeded", attempt, key))
                return result
            except Exception as error:  # bounded; no implicit sleep/network
                last_error = error
                if attempt >= policy.max_attempts or not policy.retryable(error):
                    break
        assert last_error is not None
        records.append(StageRecord(name, "failed", policy.max_attempts, key, error=str(last_error)))
        raise StageExecutionError(name, policy.max_attempts, last_error)

    def run(self, request: OrchestrationRequest) -> OrchestrationResult:
        records: list[StageRecord] = []
        try:
            collected = self._stage(
                "collect",
                f"{request.run_id}:collect",
                lambda: self.adapters.collection.collect(request, idempotency_key=f"{request.run_id}:collect"),
                records,
            )
            persisted = self._stage(
                "persist",
                f"{request.run_id}:persist",
                lambda: self.adapters.persistence.persist(
                    request, collected, idempotency_key=f"{request.run_id}:persist"
                ),
                records,
            )
            ranked = self._stage(
                "cluster_rank",
                f"{request.run_id}:cluster_rank",
                lambda: self.adapters.cluster_rank.cluster_rank(
                    request, persisted, idempotency_key=f"{request.run_id}:cluster_rank"
                ),
                records,
            )
            semantic = self._stage(
                "top5_semantic",
                f"{request.run_id}:top5_semantic",
                lambda: self.adapters.semantic.analyze_top5(
                    request, ranked, idempotency_key=f"{request.run_id}:top5_semantic"
                ),
                records,
            )

            gate_key = f"{request.run_id}:quality_gate"
            gate_cached = self.idempotency.get(gate_key)
            if gate_cached is not MISSING:
                gate = _as_mapping(gate_cached, context="cached quality_gate")
                assert_body_safe(gate, context="cached quality_gate")
                records.append(StageRecord("quality_gate", "reused", 0, gate_key, reused=True))
            else:
                gate = evaluate_quality_gate(semantic, top5_limit=request.top5_limit)
                self.idempotency.put(gate_key, dict(gate))
                records.append(StageRecord("quality_gate", "succeeded", 1, gate_key))

            public_payload = {
                "schemaVersion": "agenda.frame.active-snapshot.v1",
                "basisDate": request.basis_date,
                "runId": request.run_id,
                "sourcePolicyVersion": request.source_policy_version,
                "modelRevision": request.model_revision,
                "promptVersion": request.prompt_version,
                "qualityGate": dict(gate),
                "manifest": dict(semantic["manifest"]),
                "bundles": {
                    str(issue_id): dict(bundle)
                    for issue_id, bundle in semantic["bundles"].items()
                    if isinstance(bundle, Mapping)
                },
                "top5": _issue_list(semantic),
            }
            assert_body_safe(public_payload, context="snapshot payload")
            snapshot_id = snapshot_id_for(request=request, public_payload=public_payload)
            # The active reader validates a top-level snapshot identity.  Keep
            # it in the public object as well as the immutable manifest and
            # pointer; the hash intentionally covers the payload before this
            # self-referential field is added.
            public_payload = {**public_payload, "snapshotId": snapshot_id}
            assert_body_safe(public_payload, context="snapshot payload")
            prefix = f"snapshots/{request.basis_date}/{snapshot_id}"
            manifest_issues = _manifest_issue_rows(
                _issue_list(semantic),
                public_payload["bundles"],
            )
            manifest = {
                "schemaVersion": "agenda.frame.active-snapshot.v1",
                "snapshotId": snapshot_id,
                "runId": request.run_id,
                "basisDate": request.basis_date,
                "sourcePolicyVersion": request.source_policy_version,
                "modelRevision": request.model_revision,
                "promptVersion": request.prompt_version,
                "rawContentDeleteAfter": request.raw_content_delete_after,
                "qualityGate": dict(gate),
                "issueCount": len(manifest_issues),
                "articleCount": sum(row["articleCount"] for row in manifest_issues),
                "issues": manifest_issues,
            }
            # The public active object carries the same complete manifest as
            # the immutable manifest object.  The site loader validates the
            # envelope before reading any issue bundle.
            public_payload = {**public_payload, "manifest": manifest}
            assert_body_safe(public_payload, context="snapshot payload")
            issue_objects = {
                f"{prefix}/issues/{issue_id}.json": bundle
                for issue_id, bundle in public_payload["bundles"].items()
            }
            objects = {
                f"{prefix}/manifest.json": manifest,
                f"{prefix}/active.json": public_payload,
                **issue_objects,
            }
            pointer = {
                "schemaVersion": "agenda.frame.active-snapshot-pointer.v1",
                "snapshotId": snapshot_id,
                "runId": request.run_id,
                "basisDate": request.basis_date,
                "prefix": prefix,
                "manifest": f"{prefix}/manifest.json",
                "active": f"{prefix}/active.json",
                "manifestSha256": canonical_json_sha256(manifest),
                "publishedAt": self.clock().isoformat(),
            }
            assert_body_safe(objects, context="snapshot objects")
            publish_key = f"{request.run_id}:publish:{snapshot_id}"
            publish_cached = self.idempotency.get(publish_key)
            if publish_cached is not MISSING:
                current = _as_mapping(publish_cached, context="cached publish")
                records.append(StageRecord("publish", "reused", 0, publish_key, reused=True))
            else:
                self.adapters.snapshots.put_immutable(objects)
                current_before = self.adapters.snapshots.read_current_pointer()
                if current_before is None or current_before.get("snapshotId") != snapshot_id:
                    self.adapters.snapshots.update_current_pointer(pointer)
                    current = pointer
                else:
                    current = current_before
                self.idempotency.put(publish_key, dict(current))
                records.append(StageRecord("publish", "succeeded", 1, publish_key))
            return OrchestrationResult(
                run_id=request.run_id,
                status="succeeded",
                stage_records=tuple(records),
                snapshot_id=snapshot_id,
                current_pointer=current,
            )
        except StageExecutionError as error:
            return OrchestrationResult(
                run_id=request.run_id,
                status="failed",
                stage_records=tuple(records),
                error=str(error),
            )
        except QualityGateError as error:
            records.append(StageRecord("quality_gate", "failed", 1, f"{request.run_id}:quality_gate", error=str(error)))
            return OrchestrationResult(
                run_id=request.run_id,
                status="quarantined",
                stage_records=tuple(records),
                error=str(error),
            )
        except Exception as error:
            records.append(StageRecord("publish", "failed", 1, f"{request.run_id}:publish", error=str(error)))
            return OrchestrationResult(
                run_id=request.run_id,
                status="failed",
                stage_records=tuple(records),
                error=str(error),
            )


__all__ = [
    "DEFAULT_STAGE_POLICIES",
    "FORBIDDEN_BODY_KEYS",
    "GcpPipelineOrchestrator",
    "InMemoryIdempotencyStore",
    "OrchestrationRequest",
    "OrchestrationResult",
    "PipelineAdapters",
    "QualityGateError",
    "SnapshotPublicationError",
    "StageExecutionError",
    "StagePolicy",
    "STAGE_ORDER",
    "assert_body_safe",
    "canonical_json_sha256",
    "evaluate_quality_gate",
    "forbidden_body_paths",
    "snapshot_id_for",
]
