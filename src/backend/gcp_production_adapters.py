"""Explicit, lazy-loaded Google SDK boundary for the Cloud Run pipeline.

Importing this module is safe in offline tests: no ``google`` package is
imported and no client is constructed.  A production binding must call
``production_adapter_factory`` explicitly (the Cloud Run contract selects it
with ``AGENDAFRAME_ADAPTER_MODE=gcp`` and a factory reference).  Stage
adapters remain injected because collection, BigQuery writes, Vertex prompts,
and snapshot publication each have independent least-privilege contracts.

This is a boundary, not a hidden network fallback.  Missing configuration,
SDKs, credentials, or stage bindings fail with ``RuntimeAdapterUnavailable``
before the orchestration request can publish a snapshot.
"""

from __future__ import annotations

import importlib
import os
from dataclasses import dataclass
from typing import Any, Callable, Mapping, Protocol

from backend.config import RuntimeConfig
from backend.gcp_job_entrypoint import (
    GcpRuntimeConfig,
    RuntimeAdapterUnavailable,
)
from backend.gcp_orchestration import PipelineAdapters


class SdkImporter(Protocol):
    def __call__(self, name: str) -> Any: ...


@dataclass(frozen=True)
class GoogleSdkModules:
    """The three SDK modules needed by the production boundary."""

    bigquery: Any
    storage: Any
    genai: Any


@dataclass(frozen=True)
class GoogleClientBundle:
    """Constructed clients and their immutable target identifiers."""

    bigquery: Any
    storage: Any
    vertex: Any
    project_id: str
    dataset: str
    bucket: str
    vertex_location: str


StageAdapterFactory = Callable[
    [GoogleClientBundle, RuntimeConfig, GcpRuntimeConfig], PipelineAdapters
]


def validate_runtime_config(config: RuntimeConfig) -> None:
    """Validate identifiers before loading a cloud SDK or creating clients."""

    required = {
        "project_id": config.project_id,
        "region": config.region,
        "dataset": config.dataset,
        "bucket": config.bucket,
        "vertex.location": config.vertex.location,
        "vertex.model": config.vertex.model,
    }
    missing = [
        name
        for name, value in required.items()
        if not isinstance(value, str) or not value.strip()
    ]
    if missing:
        raise RuntimeAdapterUnavailable(
            "runtime config has empty required field(s): " + ", ".join(missing)
        )
    if config.maximum_bytes_billed <= 0:
        raise RuntimeAdapterUnavailable("bigquery.maximum_bytes_billed must be positive")
    if config.vertex.max_articles_per_run <= 0 or config.vertex.max_articles_per_day <= 0:
        raise RuntimeAdapterUnavailable("vertex article limits must be positive")
    if config.vertex.max_attempts <= 0 or config.vertex.max_output_tokens <= 0:
        raise RuntimeAdapterUnavailable("vertex retry/output limits must be positive")
    if config.delete_all_bodies_on.strip() == "":
        raise RuntimeAdapterUnavailable("storage.delete_all_bodies_on must be configured")


def load_google_sdk(*, importer: SdkImporter | None = None) -> GoogleSdkModules:
    """Import SDK modules only when an explicit production factory is called."""

    load = importer or importlib.import_module
    try:
        bigquery = load("google.cloud.bigquery")
        storage = load("google.cloud.storage")
        genai = load("google.genai")
    except (ImportError, ModuleNotFoundError) as error:
        raise RuntimeAdapterUnavailable(
            "Google SDKs are unavailable; install the locked cloud dependencies"
        ) from error
    return GoogleSdkModules(bigquery=bigquery, storage=storage, genai=genai)


def _client(module: Any, attribute: str, *, label: str, **kwargs: Any) -> Any:
    constructor = getattr(module, attribute, None)
    if not callable(constructor):
        raise RuntimeAdapterUnavailable(f"Google SDK module has no callable {label} client")
    try:
        # Client construction is the only action here.  No query, bucket
        # lookup, model call, or health check is made by this boundary.
        return constructor(**kwargs)
    except Exception as error:  # SDK exceptions vary by package/version.
        raise RuntimeAdapterUnavailable(f"could not construct {label} client") from error


def build_bigquery_client(config: RuntimeConfig, *, sdk: GoogleSdkModules | None = None) -> Any:
    validate_runtime_config(config)
    modules = sdk or load_google_sdk()
    return _client(
        modules.bigquery,
        "Client",
        label="BigQuery",
        project=config.project_id,
        location=config.region,
    )


def build_storage_client(config: RuntimeConfig, *, sdk: GoogleSdkModules | None = None) -> Any:
    validate_runtime_config(config)
    modules = sdk or load_google_sdk()
    return _client(
        modules.storage,
        "Client",
        label="Cloud Storage",
        project=config.project_id,
    )


def build_vertex_client(config: RuntimeConfig, *, sdk: GoogleSdkModules | None = None) -> Any:
    validate_runtime_config(config)
    modules = sdk or load_google_sdk()
    return _client(
        modules.genai,
        "Client",
        label="Vertex AI",
        vertexai=True,
        project=config.project_id,
        location=config.vertex.location,
    )


def build_google_clients(
    config: RuntimeConfig,
    *,
    sdk: GoogleSdkModules | None = None,
) -> GoogleClientBundle:
    """Build the three clients once; no service method is invoked."""

    validate_runtime_config(config)
    modules = sdk or load_google_sdk()
    return GoogleClientBundle(
        bigquery=build_bigquery_client(config, sdk=modules),
        storage=build_storage_client(config, sdk=modules),
        vertex=build_vertex_client(config, sdk=modules),
        project_id=config.project_id,
        dataset=config.dataset,
        bucket=config.bucket,
        vertex_location=config.vertex.location,
    )


def _load_stage_factory(spec: str) -> StageAdapterFactory:
    if ":" not in spec:
        raise RuntimeAdapterUnavailable(
            "AGENDAFRAME_STAGE_ADAPTER_FACTORY must use module:function notation"
        )
    module_name, attribute_name = spec.split(":", 1)
    try:
        module = importlib.import_module(module_name)
        factory = getattr(module, attribute_name)
    except (ImportError, AttributeError) as error:
        raise RuntimeAdapterUnavailable(f"cannot load stage adapter factory {spec!r}") from error
    if not callable(factory):
        raise RuntimeAdapterUnavailable(f"stage adapter factory {spec!r} is not callable")
    return factory


def load_runtime_config(env: Mapping[str, str] | None = None) -> RuntimeConfig:
    """Load the existing YAML config without importing any cloud SDK."""

    values = os.environ if env is None else env
    path = str(values.get("AGENDAFRAME_RUNTIME_CONFIG", "config/gcp-runtime.yaml")).strip()
    if not path:
        raise RuntimeAdapterUnavailable("AGENDAFRAME_RUNTIME_CONFIG must not be empty")
    try:
        config = RuntimeConfig.from_yaml(path)
    except Exception as error:
        raise RuntimeAdapterUnavailable(f"cannot load runtime config {path!r}") from error
    validate_runtime_config(config)
    return config


def build_production_adapters(
    runtime: GcpRuntimeConfig,
    *,
    env: Mapping[str, str] | None = None,
    sdk: GoogleSdkModules | None = None,
    stage_adapter_factory: StageAdapterFactory | None = None,
) -> PipelineAdapters:
    """Bind SDK clients and stage adapters only in explicit production mode."""

    values = os.environ if env is None else env
    config = load_runtime_config(values)
    stage_factory = stage_adapter_factory
    if stage_factory is None:
        # The reviewed stage wiring is the default production binding.  It
        # still fails closed until that module receives an explicit
        # AGENDAFRAME_STAGE_DEPENDENCIES_FACTORY; deployments may override the
        # stage factory for a separately reviewed implementation.
        spec = str(
            values.get(
                "AGENDAFRAME_STAGE_ADAPTER_FACTORY",
                "backend.gcp_stage_adapters:production_stage_adapter_factory",
            )
        ).strip()
        if not spec:
            raise RuntimeAdapterUnavailable("stage adapter factory cannot be empty")
        stage_factory = _load_stage_factory(spec)
    clients = build_google_clients(config, sdk=sdk)
    try:
        adapters = stage_factory(clients, config, runtime)
    except RuntimeAdapterUnavailable:
        raise
    except Exception as error:
        raise RuntimeAdapterUnavailable("production stage adapter binding failed") from error
    if not isinstance(adapters, PipelineAdapters):
        raise RuntimeAdapterUnavailable(
            "production stage adapter factory must return PipelineAdapters"
        )
    return adapters


def production_adapter_factory(runtime: GcpRuntimeConfig) -> PipelineAdapters:
    """Factory reference for ``AGENDAFRAME_ADAPTER_FACTORY`` in Cloud Run."""

    return build_production_adapters(runtime)


__all__ = [
    "GoogleClientBundle",
    "GoogleSdkModules",
    "StageAdapterFactory",
    "build_bigquery_client",
    "build_google_clients",
    "build_production_adapters",
    "build_storage_client",
    "build_vertex_client",
    "load_google_sdk",
    "load_runtime_config",
    "production_adapter_factory",
    "validate_runtime_config",
]
