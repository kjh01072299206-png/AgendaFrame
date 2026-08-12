from __future__ import annotations

import unittest
from pathlib import Path

from backend.config import RuntimeConfig
from backend.gcp_job_entrypoint import build_runtime_config
from backend.gcp_orchestration import PipelineAdapters
from backend.gcp_production_adapters import (
    GoogleSdkModules,
    RuntimeAdapterUnavailable,
    build_google_clients,
    build_production_adapters,
    load_google_sdk,
    validate_runtime_config,
)

ROOT = Path(__file__).resolve().parents[2]
POLICY = str(ROOT / "site" / "data" / "discovery-sources.json")
RUNTIME_YAML = str(ROOT / "config" / "gcp-runtime.yaml")


def trigger_env(**overrides: str) -> dict[str, str]:
    values = {
        "AGENDAFRAME_DISCOVERY_POLICY": POLICY,
        "AGENDAFRAME_RUNTIME_CONFIG": RUNTIME_YAML,
        "AGENDAFRAME_RUN_ID": "cloud-run:2026-08-13T06:00:00+09:00",
        "AGENDAFRAME_BASIS_DATE": "2026-08-13",
        "AGENDAFRAME_PIPELINE_OWNER": "gcp",
        "AGENDAFRAME_CLOUDFLARE_CRON_ENABLED": "false",
        "AGENDAFRAME_LEGACY_SCHEDULE_ENABLED": "false",
        "AGENDAFRAME_ADAPTER_MODE": "gcp",
    }
    values.update(overrides)
    return values


class FakeClient:
    def __init__(self, **kwargs):
        self.kwargs = kwargs
        self.service_calls: list[str] = []


class FakeBigQueryModule:
    Client = FakeClient


class FakeStorageModule:
    Client = FakeClient


class FakeGenAiModule:
    Client = FakeClient


class FakeImporter:
    def __init__(self) -> None:
        self.names: list[str] = []

    def __call__(self, name: str):
        self.names.append(name)
        return {
            "google.cloud.bigquery": FakeBigQueryModule,
            "google.cloud.storage": FakeStorageModule,
            "google.genai": FakeGenAiModule,
        }[name]


class GcpProductionAdapterTests(unittest.TestCase):
    def test_sdk_imports_are_deferred_to_explicit_loader(self) -> None:
        importer = FakeImporter()
        sdk = load_google_sdk(importer=importer)
        self.assertEqual(
            importer.names,
            ["google.cloud.bigquery", "google.cloud.storage", "google.genai"],
        )
        self.assertIs(sdk.bigquery, FakeBigQueryModule)

    def test_clients_are_constructed_without_service_calls(self) -> None:
        config = RuntimeConfig.from_yaml(RUNTIME_YAML)
        sdk = GoogleSdkModules(FakeBigQueryModule, FakeStorageModule, FakeGenAiModule)
        clients = build_google_clients(config, sdk=sdk)
        self.assertEqual(clients.project_id, config.project_id)
        self.assertEqual(clients.dataset, config.dataset)
        self.assertEqual(clients.bucket, config.bucket)
        self.assertEqual(clients.bigquery.kwargs["project"], config.project_id)
        self.assertEqual(clients.storage.kwargs["project"], config.project_id)
        self.assertEqual(clients.vertex.kwargs["vertexai"], True)
        self.assertEqual(clients.vertex.kwargs["location"], config.vertex.location)
        self.assertEqual(clients.bigquery.service_calls, [])
        self.assertEqual(clients.storage.service_calls, [])
        self.assertEqual(clients.vertex.service_calls, [])

    def test_invalid_runtime_config_fails_before_sdk_construction(self) -> None:
        config = RuntimeConfig.from_yaml(RUNTIME_YAML)
        object.__setattr__(config, "project_id", "")
        with self.assertRaises(RuntimeAdapterUnavailable):
            validate_runtime_config(config)

    def test_production_binding_requires_stage_factory_and_returns_injected_pipeline(self) -> None:
        runtime = build_runtime_config(trigger_env())
        sdk = GoogleSdkModules(FakeBigQueryModule, FakeStorageModule, FakeGenAiModule)
        seen = {}

        def stage_factory(clients, config, trigger):
            seen["project"] = clients.project_id
            seen["policy"] = trigger.policy.source_count
            return PipelineAdapters("collection", "persistence", "cluster", "semantic", "snapshots")

        adapters = build_production_adapters(
            runtime,
            env=trigger_env(),
            sdk=sdk,
            stage_adapter_factory=stage_factory,
        )
        self.assertIsInstance(adapters, PipelineAdapters)
        self.assertEqual(seen, {"project": "project-40bc06fc-fb4b-46b6-a10", "policy": 12})

    def test_production_binding_fails_closed_when_stage_factory_is_missing(self) -> None:
        runtime = build_runtime_config(trigger_env())
        sdk = GoogleSdkModules(FakeBigQueryModule, FakeStorageModule, FakeGenAiModule)
        with self.assertRaises(RuntimeAdapterUnavailable):
            build_production_adapters(runtime, env=trigger_env(), sdk=sdk)


if __name__ == "__main__":
    unittest.main()
