from __future__ import annotations

import unittest
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]
CONTRACT_DIR = ROOT / "infra" / "gcp"


class GcpRuntimeWiringContractTests(unittest.TestCase):
    def test_cloud_run_entrypoint_and_migration_ownership_are_explicit(self) -> None:
        job = yaml.safe_load((CONTRACT_DIR / "cloud-run-job.yaml").read_text(encoding="utf-8"))
        self.assertEqual(job["metadata"]["implementationStatus"], "contract_only")
        self.assertEqual(job["spec"]["command"], ["python", "-m", "backend.gcp_job_entrypoint"])
        self.assertEqual(job["spec"]["sourceCount"], 12)
        self.assertTrue(job["spec"]["activeSnapshot"]["requiresImmutableManifest"])
        self.assertTrue(job["spec"]["activeSnapshot"]["requiresRawBodyAbsent"])
        environment = job["spec"]["environment"]
        self.assertEqual(
            environment["AGENDAFRAME_STAGE_DEPENDENCIES_FACTORY"],
            "backend.gcp_live_dependencies:build_stage_dependencies",
        )
        self.assertEqual(environment["AGENDAFRAME_PIPELINE_OWNER"], "gcp")
        self.assertEqual(environment["AGENDAFRAME_CLOUDFLARE_CRON_ENABLED"], "false")
        self.assertEqual(environment["AGENDAFRAME_LEGACY_SCHEDULE_ENABLED"], "false")
        self.assertEqual(environment["AGENDAFRAME_SCHEDULED_TIME"], "injected_by_workflow")

        ownership = yaml.safe_load(
            (CONTRACT_DIR / "migration-ownership.yaml").read_text(encoding="utf-8")
        )
        self.assertEqual(ownership["spec"]["owner"], "gcp")
        self.assertFalse(ownership["spec"]["cloudflareCronEnabled"])
        self.assertFalse(ownership["spec"]["legacyScheduleEnabled"])
        self.assertEqual(ownership["spec"]["invariant"], "exactly_one_scheduler_owner")

    def test_runtime_contracts_remain_offline_only_and_secret_free(self) -> None:
        for name in ("cloud-run-job.yaml", "migration-ownership.yaml"):
            document = yaml.safe_load((CONTRACT_DIR / name).read_text(encoding="utf-8"))
            self.assertFalse(document["metadata"]["externalCalls"])
            self.assertNotRegex(
                (CONTRACT_DIR / name).read_text(encoding="utf-8"),
                r"(?i)(BEGIN (RSA|PRIVATE)|AIza[0-9A-Za-z_-]{20,}|Bearer\s+[A-Za-z0-9._-]{20,})",
            )


if __name__ == "__main__":
    unittest.main()
