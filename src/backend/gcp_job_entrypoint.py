"""Cloud Run Job wiring for the offline-tested AgendaFrame GCP pipeline.

The module is deliberately free of Google Cloud SDK imports.  Cloud Run (or
Workflows) supplies an adapter factory through an injected callable or a
``module:function`` environment reference.  That keeps collection, Vertex AI,
Cloud SQL and Storage clients behind testable interfaces while making the job
entrypoint callable in production.

Only the validated twelve-source policy and public metadata cross this module's
boundary.  Raw article bodies are private adapter concerns and are rejected by
the orchestration quality gate before publication.
"""

from __future__ import annotations

import hashlib
import importlib
import json
import os
import re
import sys
import time
from dataclasses import dataclass
from datetime import date
from typing import Any, Callable, Mapping, Sequence

from backend.gcp_orchestration import (
    GcpPipelineOrchestrator,
    IdempotencyStore,
    OrchestrationRequest,
    OrchestrationResult,
    PipelineAdapters,
    SnapshotStore,
    assert_body_safe,
)
from backend.gcp_source_policy import GcpDiscoveryPolicy

SNAPSHOT_SCHEMA = "agenda.frame.active-snapshot.v1"
POINTER_SCHEMA = "agenda.frame.active-snapshot-pointer.v1"
SNAPSHOT_ID_PATTERN = re.compile(r"^[0-9a-f]{32}$")
SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")
OWNER_ENV = "AGENDAFRAME_PIPELINE_OWNER"
CLOUDFLARE_CRON_ENV = "AGENDAFRAME_CLOUDFLARE_CRON_ENABLED"
LEGACY_SCHEDULE_ENV = "AGENDAFRAME_LEGACY_SCHEDULE_ENABLED"


class RuntimeWiringError(ValueError):
    """The Cloud Run job cannot safely be started with the supplied config."""


class MigrationOwnershipError(RuntimeWiringError):
    """The old scheduler is still enabled or GCP does not own the run."""


class RuntimeAdapterUnavailable(RuntimeWiringError):
    """No injected production adapter factory was configured."""


@dataclass(frozen=True)
class GcpRuntimeConfig:
    """Validated policy and trigger metadata passed to the orchestrator."""

    policy: GcpDiscoveryPolicy
    request: OrchestrationRequest
    adapter_mode: str
    pipeline_owner: str
    cloudflare_cron_enabled: bool
    legacy_schedule_enabled: bool

    def public_metadata(self) -> Mapping[str, Any]:
        return {
            "sourcePolicyVersion": self.policy.policy_version,
            "sourceCount": self.policy.source_count,
            "generalDailyCount": self.policy.general_daily_count,
            "broadcasterCount": self.policy.broadcaster_count,
            "scheduledHoursKst": list(self.policy.scheduled_hours_kst),
            "basisDate": self.request.basis_date,
            "runId": self.request.run_id,
            "rawContentDeleteAfter": self.request.raw_content_delete_after,
            "pipelineOwner": self.pipeline_owner,
            "cloudflareCronEnabled": self.cloudflare_cron_enabled,
            "legacyScheduleEnabled": self.legacy_schedule_enabled,
        }


AdapterFactory = Callable[[GcpRuntimeConfig], PipelineAdapters]


def _required(env: Mapping[str, str], name: str, *, default: str | None = None) -> str:
    value = env.get(name, default)
    if not isinstance(value, str) or not value.strip():
        raise RuntimeWiringError(f"{name} must be configured")
    return value.strip()


def _strict_bool(env: Mapping[str, str], name: str) -> bool:
    value = _required(env, name).casefold()
    if value not in {"true", "false", "1", "0", "yes", "no"}:
        raise RuntimeWiringError(f"{name} must be an explicit true/false value")
    return value in {"true", "1", "yes"}


def assert_gcp_ownership(env: Mapping[str, str]) -> None:
    """Fail closed unless GCP is the sole active scheduler owner.

    Cloudflare Workers remain the currently deployed collector.  During
    migration the new Cloud Run job must not run in parallel, so a job trigger
    is accepted only when the cut-over flags explicitly disable both legacy
    schedules.
    """

    owner = _required(env, OWNER_ENV).casefold()
    cloudflare_enabled = _strict_bool(env, CLOUDFLARE_CRON_ENV)
    legacy_enabled = _strict_bool(env, LEGACY_SCHEDULE_ENV)
    if owner != "gcp" or cloudflare_enabled or legacy_enabled:
        raise MigrationOwnershipError(
            "GCP job is not sole scheduler owner; require "
            f"{OWNER_ENV}=gcp, {CLOUDFLARE_CRON_ENV}=false and "
            f"{LEGACY_SCHEDULE_ENV}=false"
        )


def build_runtime_config(
    env: Mapping[str, str] | None = None,
    *,
    policy_path: str | os.PathLike[str] | None = None,
) -> GcpRuntimeConfig:
    """Build a deterministic request from the validated policy and env."""

    values = dict(os.environ if env is None else env)
    assert_gcp_ownership(values)
    configured_policy_path = policy_path or values.get(
        "AGENDAFRAME_DISCOVERY_POLICY", "site/data/discovery-sources.json"
    )
    policy = GcpDiscoveryPolicy.from_path(configured_policy_path)
    run_id = values.get("AGENDAFRAME_RUN_ID", "").strip()
    if not run_id:
        scheduled_time = _required(values, "AGENDAFRAME_SCHEDULED_TIME")
        job_name = values.get("AGENDAFRAME_JOB_NAME", "agendaframe-collection-analysis").strip()
        run_id = f"{job_name}:{scheduled_time}"
    basis_date = values.get("AGENDAFRAME_BASIS_DATE", policy.collection_start).strip()
    if not basis_date:
        raise RuntimeWiringError("AGENDAFRAME_BASIS_DATE must not be empty")
    try:
        basis_date_value = date.fromisoformat(basis_date)
    except ValueError as error:
        raise RuntimeWiringError("AGENDAFRAME_BASIS_DATE must be an ISO date") from error
    if not (
        date.fromisoformat(policy.collection_start)
        <= basis_date_value
        <= date.fromisoformat(policy.collection_end)
    ):
        raise RuntimeWiringError(
            "AGENDAFRAME_BASIS_DATE is outside the configured collection window"
        )
    request = OrchestrationRequest(
        run_id=run_id,
        basis_date=basis_date,
        source_policy_version=policy.policy_version,
        model_revision=values.get("AGENDAFRAME_MODEL_REVISION", "gemini-2.5-flash-lite").strip(),
        prompt_version=values.get("AGENDAFRAME_PROMPT_VERSION", "2.6.0").strip(),
        raw_content_delete_after=policy.raw_content_delete_after,
        top5_limit=5,
        started_at=values.get("AGENDAFRAME_STARTED_AT", "").strip(),
    )
    return GcpRuntimeConfig(
        policy=policy,
        request=request,
        adapter_mode=values.get("AGENDAFRAME_ADAPTER_MODE", "injected").strip().casefold(),
        pipeline_owner=values[OWNER_ENV].strip().casefold(),
        cloudflare_cron_enabled=_strict_bool(values, CLOUDFLARE_CRON_ENV),
        legacy_schedule_enabled=_strict_bool(values, LEGACY_SCHEDULE_ENV),
    )


def _load_factory(spec: str) -> AdapterFactory:
    if ":" not in spec:
        raise RuntimeAdapterUnavailable(
            "AGENDAFRAME_ADAPTER_FACTORY must use module:function notation"
        )
    module_name, attribute_name = spec.split(":", 1)
    try:
        module = importlib.import_module(module_name)
        factory = getattr(module, attribute_name)
    except (ImportError, AttributeError) as error:
        raise RuntimeAdapterUnavailable(f"cannot load adapter factory {spec!r}") from error
    if not callable(factory):
        raise RuntimeAdapterUnavailable(f"adapter factory {spec!r} is not callable")
    return factory


def build_adapters(
    config: GcpRuntimeConfig,
    env: Mapping[str, str],
    *,
    adapter_factory: AdapterFactory | None = None,
) -> PipelineAdapters:
    """Resolve adapters without importing or calling a cloud SDK."""

    if config.adapter_mode not in {"injected", "gcp"}:
        raise RuntimeWiringError(
            "AGENDAFRAME_ADAPTER_MODE must be injected or gcp; no implicit network adapter exists"
        )
    factory = adapter_factory
    if factory is None:
        spec = env.get("AGENDAFRAME_ADAPTER_FACTORY", "").strip()
        if not spec:
            raise RuntimeAdapterUnavailable(
                "provide an injected adapter_factory or AGENDAFRAME_ADAPTER_FACTORY"
            )
        factory = _load_factory(spec)
    adapters = factory(config)
    if not isinstance(adapters, PipelineAdapters):
        raise RuntimeAdapterUnavailable("adapter factory must return PipelineAdapters")
    return adapters


def validate_active_snapshot_manifest(
    manifest: Mapping[str, Any],
    pointer: Mapping[str, Any],
    request: OrchestrationRequest,
) -> None:
    """Validate the immutable manifest/pointer pair before serving it."""

    assert_body_safe(manifest, context="active snapshot manifest")
    assert_body_safe(pointer, context="active snapshot pointer")
    if manifest.get("schemaVersion") != SNAPSHOT_SCHEMA:
        raise RuntimeWiringError("active snapshot manifest schema is invalid")
    if pointer.get("schemaVersion") != POINTER_SCHEMA:
        raise RuntimeWiringError("active snapshot pointer schema is invalid")
    snapshot_id = manifest.get("snapshotId")
    if not isinstance(snapshot_id, str) or not SNAPSHOT_ID_PATTERN.fullmatch(snapshot_id):
        raise RuntimeWiringError(
            "active snapshot manifest snapshotId must be a 32-character hex ID"
        )
    if pointer.get("snapshotId") != snapshot_id:
        raise RuntimeWiringError("active snapshot pointer does not reference manifest snapshotId")
    for key, expected in (
        ("runId", request.run_id),
        ("basisDate", request.basis_date),
        ("sourcePolicyVersion", request.source_policy_version),
        ("modelRevision", request.model_revision),
        ("promptVersion", request.prompt_version),
        ("rawContentDeleteAfter", request.raw_content_delete_after),
    ):
        if manifest.get(key) != expected:
            raise RuntimeWiringError(f"active snapshot manifest {key} does not match request")
    if manifest.get("issueCount") != request.top5_limit:
        raise RuntimeWiringError("active snapshot manifest issueCount must equal top5 limit")
    manifest_issues = manifest.get("issues")
    if (
        not isinstance(manifest_issues, Sequence)
        or isinstance(manifest_issues, (str, bytes, bytearray))
        or len(manifest_issues) != request.top5_limit
    ):
        raise RuntimeWiringError("active snapshot manifest must contain exactly the top issues")
    issue_ids: set[str] = set()
    for index, issue in enumerate(manifest_issues, 1):
        if not isinstance(issue, Mapping):
            raise RuntimeWiringError(f"active snapshot manifest issue {index} is invalid")
        issue_id = issue.get("issueId")
        payload_key = issue.get("payloadKey")
        if not isinstance(issue_id, str) or not issue_id.strip() or issue_id in issue_ids:
            raise RuntimeWiringError("active snapshot manifest issue IDs must be unique")
        if not isinstance(payload_key, str) or payload_key != f"issues/{issue_id}.json":
            raise RuntimeWiringError("active snapshot manifest issue payloadKey is inconsistent")
        issue_ids.add(issue_id)
    quality = manifest.get("qualityGate")
    if not isinstance(quality, Mapping):
        raise RuntimeWiringError("active snapshot manifest is missing qualityGate")
    for key, expected in (
        ("status", "pass"),
        ("rawBodyAbsent", True),
        ("evidenceLineageComplete", True),
        ("publicSnapshotReady", True),
    ):
        if quality.get(key) != expected:
            raise RuntimeWiringError(f"active snapshot qualityGate.{key} is not publishable")
    prefix = pointer.get("prefix")
    manifest_ref = pointer.get("manifest")
    active_ref = pointer.get("active")
    manifest_sha256 = pointer.get("manifestSha256")
    if (
        not isinstance(prefix, str)
        or not prefix
        or not isinstance(manifest_ref, str)
        or not isinstance(active_ref, str)
        or not isinstance(manifest_sha256, str)
    ):
        raise RuntimeWiringError("active snapshot pointer is missing immutable references")
    if manifest_ref != f"{prefix}/manifest.json":
        raise RuntimeWiringError("active snapshot pointer manifest reference is inconsistent")
    if active_ref != f"{prefix}/active.json":
        raise RuntimeWiringError("active snapshot pointer active reference is inconsistent")
    if not SHA256_PATTERN.fullmatch(manifest_sha256):
        raise RuntimeWiringError("active snapshot pointer manifestSha256 is invalid")
    canonical = json.dumps(
        manifest, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str
    )
    if hashlib.sha256(canonical.encode("utf-8")).hexdigest() != manifest_sha256:
        raise RuntimeWiringError("active snapshot pointer manifestSha256 does not match manifest")


def _read_manifest(snapshot_store: SnapshotStore, pointer: Mapping[str, Any]) -> Mapping[str, Any]:
    reader = getattr(snapshot_store, "read_public_manifest", None)
    if not callable(reader):
        raise RuntimeWiringError(
            "snapshot adapter must expose read_public_manifest(pointer) for active-manifest validation"
        )
    manifest = reader(pointer)
    if not isinstance(manifest, Mapping):
        raise RuntimeWiringError("snapshot adapter returned a non-object active manifest")
    return manifest


def run_job(
    env: Mapping[str, str] | None = None,
    *,
    adapter_factory: AdapterFactory | None = None,
    idempotency: IdempotencyStore | None = None,
    clock: Callable[[], Any] | None = None,
) -> tuple[GcpRuntimeConfig, OrchestrationResult]:
    """Execute one Cloud Run job using injected adapters only."""

    values = dict(os.environ if env is None else env)
    config = build_runtime_config(values)
    adapters = build_adapters(config, values, adapter_factory=adapter_factory)
    result = GcpPipelineOrchestrator(
        adapters,
        idempotency=idempotency,
        clock=clock,
    ).run(config.request)
    if result.status == "succeeded":
        pointer = result.current_pointer
        if not isinstance(pointer, Mapping):
            raise RuntimeWiringError("successful orchestration returned no active snapshot pointer")
        manifest = _read_manifest(adapters.snapshots, pointer)
        validate_active_snapshot_manifest(manifest, pointer, config.request)
    return config, result


def _result_payload(config: GcpRuntimeConfig, result: OrchestrationResult) -> Mapping[str, Any]:
    return {
        **config.public_metadata(),
        "status": result.status,
        "snapshotId": result.snapshot_id,
        "currentPointer": result.current_pointer,
        "error": "pipeline_failed" if result.error else None,
        "errorFingerprint": _error_fingerprint(result.error),
        "stages": [
            {
                "name": record.name,
                "status": record.status,
                "attempts": record.attempts,
                "idempotencyKey": record.idempotency_key,
                "reused": record.reused,
                "error": "stage_failed" if record.error else None,
                "errorFingerprint": _error_fingerprint(record.error),
            }
            for record in result.stage_records
        ],
    }


def _error_fingerprint(error: str | None) -> str | None:
    """Return a non-reversible correlation code without logging the message."""

    if not error:
        return None
    return hashlib.sha256(error.encode("utf-8", errors="replace")).hexdigest()[:16]


def _emit_runtime_event(
    event: str,
    *,
    config: GcpRuntimeConfig | None = None,
    status: str | None = None,
    duration_seconds: float | None = None,
    snapshot_id: str | None = None,
    stage: str | None = None,
    error_type: str | None = None,
) -> None:
    """Emit a body-free structured log record for Cloud Logging metrics.

    Cloud Run forwards one JSON object per stdout line to ``jsonPayload``. Keep
    this allow-listed so an adapter exception or future field cannot turn an
    observability record into an article/body or credential log.
    """

    payload: dict[str, Any] = {"service": "agendaframe", "event": event}
    if config is not None:
        payload.update(
            {
                "run_id": config.request.run_id,
                "basis_date": config.request.basis_date,
                "source_policy_version": config.policy.policy_version,
                "pipeline_owner": config.pipeline_owner,
            }
        )
    for key, value in (
        ("status", status),
        ("duration_seconds", duration_seconds),
        ("snapshot_id", snapshot_id),
        ("stage", stage),
        ("error_type", error_type),
    ):
        if value is not None:
            payload[key] = value
    assert_body_safe(payload, context="runtime event")
    print(json.dumps(payload, ensure_ascii=False, sort_keys=True), flush=True)


def main(
    argv: Sequence[str] | None = None,
    *,
    env: Mapping[str, str] | None = None,
    adapter_factory: AdapterFactory | None = None,
) -> int:
    """Cloud Run-compatible process entrypoint; external calls stay injected."""

    values = dict(os.environ if env is None else env)
    started = time.monotonic()
    try:
        config, result = run_job(values, adapter_factory=adapter_factory)
        duration = round(max(0.0, time.monotonic() - started), 3)
        failed_stage = next(
            (record.name for record in reversed(result.stage_records) if record.status == "failed"),
            None,
        )
        if result.status == "succeeded":
            _emit_runtime_event(
                "collection_run_succeeded",
                config=config,
                status=result.status,
                duration_seconds=duration,
                snapshot_id=result.snapshot_id,
            )
            _emit_runtime_event(
                "active_snapshot_published",
                config=config,
                status=result.status,
                snapshot_id=result.snapshot_id,
            )
        else:
            _emit_runtime_event(
                "collection_run_failed",
                config=config,
                status=result.status,
                duration_seconds=duration,
                stage=failed_stage,
                error_type="QualityGateError"
                if result.status == "quarantined"
                else "StageExecutionError",
            )
            if result.status == "quarantined":
                _emit_runtime_event(
                    "quality_gate_failed",
                    config=config,
                    status=result.status,
                    stage="quality_gate",
                    error_type="QualityGateError",
                )
        print(json.dumps(_result_payload(config, result), ensure_ascii=False, sort_keys=True))
        return 0 if result.status == "succeeded" else 75
    except RuntimeWiringError as error:
        _emit_runtime_event(
            "collection_run_failed",
            duration_seconds=round(max(0.0, time.monotonic() - started), 3),
            error_type=type(error).__name__,
        )
        print(
            json.dumps(
                {
                    "status": "not_started",
                    "error": "runtime_wiring_failed",
                    "errorType": type(error).__name__,
                    "errorFingerprint": _error_fingerprint(str(error)),
                },
                ensure_ascii=False,
            )
        )
        return 78


if __name__ == "__main__":  # pragma: no cover - exercised by Cloud Run itself
    raise SystemExit(main(sys.argv[1:]))


__all__ = [
    "AdapterFactory",
    "GcpRuntimeConfig",
    "MigrationOwnershipError",
    "RuntimeAdapterUnavailable",
    "RuntimeWiringError",
    "assert_gcp_ownership",
    "build_adapters",
    "build_runtime_config",
    "main",
    "run_job",
    "validate_active_snapshot_manifest",
]
