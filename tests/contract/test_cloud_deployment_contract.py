from __future__ import annotations

import json
import unittest
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]


class CloudDeploymentContractTests(unittest.TestCase):
    def test_cloud_runtime_has_cost_and_retention_controls(self) -> None:
        config = yaml.safe_load((ROOT / "config" / "gcp-runtime.yaml").read_text(encoding="utf-8"))
        self.assertEqual(config["project_id"], "project-40bc06fc-fb4b-46b6-a10")
        self.assertEqual(config["storage"]["delete_all_bodies_on"], "2026-10-31")
        self.assertEqual(config["vertex"]["thinking_budget"], 0)
        self.assertLessEqual(config["vertex"]["max_articles_per_run"], 50)
        self.assertLessEqual(config["vertex"]["max_articles_per_day"], 200)
        self.assertFalse(config["publication"]["include_article_body"])
        self.assertFalse(config["publication"]["include_original_html"])

    def test_storage_lifecycle_deletes_body_objects_by_custom_time(self) -> None:
        lifecycle = json.loads(
            (ROOT / "config" / "gcp" / "storage-lifecycle.json").read_text(encoding="utf-8")
        )
        rules = lifecycle["rule"]
        self.assertEqual(len(rules), 1)
        self.assertEqual(rules[0]["action"]["type"], "Delete")
        self.assertEqual(rules[0]["condition"]["daysSinceCustomTime"], 0)
        self.assertEqual(rules[0]["condition"]["matchesPrefix"], ["bodies/"])

    def test_provisioning_requires_explicit_apply_and_spend_cap_confirmation(self) -> None:
        script = (ROOT / "scripts" / "gcp" / "provision.ps1").read_text(encoding="utf-8")
        self.assertIn("[switch]$Apply", script)
        self.assertIn("[switch]$SpendCapsConfirmed", script)
        self.assertIn("Refusing to target an unreviewed project", script)
        self.assertIn("Apply is blocked until", script)
        self.assertIn("function Test-GcloudResource", script)
        self.assertIn("SilentlyContinue", script)
        self.assertIn("$CloudSdkBin", script)
        self.assertIn("Failed to apply the private body retention policy", script)
        self.assertIn("[switch]$DeferStorageLifecycle", script)
        self.assertIn("Do not enable body collection or analysis", script)
        self.assertIn("[switch]$DeferBigQuerySchema", script)
        self.assertIn("Do not deploy collection, analysis", script)
        self.assertIn('@("builder", "roles/artifactregistry.writer")', script)
        self.assertIn('@("builder", "roles/storage.objectViewer")', script)

    def test_bigquery_schema_requires_partition_filters(self) -> None:
        schema = (ROOT / "src" / "backend" / "sql" / "schema.sql").read_text(encoding="utf-8")
        self.assertGreaterEqual(schema.count("require_partition_filter=TRUE"), 4)
        self.assertNotIn("article_body STRING", schema)
        self.assertNotIn("evidence_text", schema)

    def test_cloud_run_deploys_only_a_clean_immutable_validated_commit(self) -> None:
        script = (ROOT / "scripts" / "gcp" / "deploy.ps1").read_text(encoding="utf-8")
        self.assertIn("[switch]$FullGatePassed", script)
        self.assertIn("status --porcelain --untracked-files=no", script)
        self.assertIn("$TrackedChanges = @(", script)
        self.assertIn("CommitSha must match", script)
        self.assertIn("runtime:$CommitSha", script)
        self.assertIn("agendaframe-config-check", script)
        self.assertIn("cloudbuild.yaml", script)

    def test_cloud_build_context_excludes_local_outputs_and_frontend(self) -> None:
        ignore = (ROOT / ".gcloudignore").read_text(encoding="utf-8")
        self.assertIn("!requirements.lock", ignore)
        self.assertIn("!src/**", ignore)
        self.assertNotIn("!site/**", ignore)
        build = yaml.safe_load(
            (ROOT / "scripts" / "gcp" / "cloudbuild.yaml").read_text(encoding="utf-8")
        )
        args = build["steps"][0]["args"]
        self.assertIn("src/backend/Dockerfile", args)
        self.assertIn("${_IMAGE}", build["images"])
        self.assertEqual(
            build["serviceAccount"],
            "projects/project-40bc06fc-fb4b-46b6-a10/serviceAccounts/"
            "builder@project-40bc06fc-fb4b-46b6-a10.iam.gserviceaccount.com",
        )


if __name__ == "__main__":
    unittest.main()
