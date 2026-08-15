from __future__ import annotations

import json
import re
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

    def test_runtime_job_documents_canary_article_cap_override(self) -> None:
        contract = yaml.safe_load(
            (ROOT / "infra" / "gcp" / "cloud-run-job.yaml").read_text(encoding="utf-8")
        )
        override = contract["spec"]["canaryOverride"]
        self.assertEqual(override["env"], "AGENDAFRAME_MAX_ARTICLES_PER_RUN")
        self.assertEqual(override["min"], 1)
        self.assertTrue(override["maxFromRuntimeYaml"])
        self.assertNotIn("AGENDAFRAME_MAX_ARTICLES_PER_RUN", contract["spec"]["environment"])

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

    def test_publisher_can_update_publication_status_without_project_wide_write(
        self,
    ) -> None:
        """mark_published() runs a DML UPDATE, so read-only access is not enough.

        The publisher's project-level BigQuery role is intentionally
        dataViewer. Without a narrower write grant the publish job fails at the
        very last step, after the site import already succeeded, which leaves
        the site populated while BigQuery still says "pending".
        """
        store = (ROOT / "src" / "backend" / "gcp_store.py").read_text(encoding="utf-8")
        self.assertIn("UPDATE `", store)
        self.assertIn('SET publication_status = "published"', store)

        script = (ROOT / "scripts" / "gcp" / "provision.ps1").read_text(encoding="utf-8")
        self.assertIn('@("publisher", "roles/bigquery.dataViewer")', script)
        self.assertIn('@("publisher", "roles/bigquery.jobUser")', script)
        self.assertNotIn('@("publisher", "roles/bigquery.dataEditor")', script)
        self.assertIn("grants.sql", script)
        self.assertIn("Failed to apply table-scoped BigQuery grants.", script)

        grants = (ROOT / "src" / "backend" / "sql" / "grants.sql").read_text(encoding="utf-8")
        self.assertIn("GRANT `roles/bigquery.dataEditor`", grants)
        self.assertIn("ON TABLE `project-40bc06fc-fb4b-46b6-a10", grants)
        self.assertIn("agendaframe.frame_analyses`", grants)
        self.assertIn("serviceAccount:publisher@", grants)
        # The write grant must stay scoped to the one table the publisher
        # updates. A SCHEMA-level grant would cover articles as well.
        self.assertNotIn("ON SCHEMA", grants)

    def test_bigquery_schema_requires_partition_filters(self) -> None:
        schema = (ROOT / "src" / "backend" / "sql" / "schema.sql").read_text(encoding="utf-8")
        self.assertGreaterEqual(schema.count("require_partition_filter=TRUE"), 4)
        self.assertNotIn("article_body STRING", schema)
        self.assertNotIn("evidence_text", schema)

    def test_partitioned_table_queries_bound_the_raw_partitioning_column(self) -> None:
        """Every query must survive require_partition_filter=TRUE.

        `frame_analyses` is partitioned by DATE(analyzed_at) and `articles` by
        DATE(published_at), both with require_partition_filter=TRUE. BigQuery
        only eliminates partitions from predicates on the raw partitioning
        column; a timezone-shifted `DATE(col, "Asia/Seoul")` comparison does not
        qualify and the query is rejected outright. A cost guard that dies this
        way blocks the run before any article is analyzed, so guard it here
        rather than discovering it against the live dataset.
        """
        source = (ROOT / "src" / "backend" / "gcp_store.py").read_text(encoding="utf-8")
        partition_columns = {
            "frame_analyses": "analyzed_at",
            "articles": "published_at",
        }
        blocks = [block.split('"""', 1)[0] for block in source.split('query = f"""')[1:]]
        self.assertGreaterEqual(len(blocks), 4)

        checked = 0
        for block in blocks:
            for table, column in partition_columns.items():
                if f".{table}`" not in block:
                    continue
                checked += 1
                bounded = re.search(
                    rf"(?<!\()\b(?:\w+\.)?{column}\s*>=",
                    block,
                )
                self.assertIsNotNone(
                    bounded,
                    f"a query over `{table}` lacks a raw `{column} >= ...` bound and "
                    f"will be rejected by require_partition_filter=TRUE:\n{block}",
                )
        self.assertGreaterEqual(checked, 5)

    def test_cloud_run_deploys_only_a_clean_immutable_validated_commit(self) -> None:
        script = (ROOT / "scripts" / "gcp" / "deploy.ps1").read_text(encoding="utf-8")
        self.assertIn("[switch]$FullGatePassed", script)
        self.assertIn("status --porcelain --untracked-files=no", script)
        self.assertIn("$TrackedChanges = @(", script)
        self.assertIn("CommitSha must match", script)
        self.assertIn("runtime:$CommitSha", script)
        self.assertIn("agendaframe-config-check", script)
        self.assertIn("cloudbuild.yaml", script)

    def test_trial_jobs_are_scripted_with_the_same_immutability_guards(self) -> None:
        """The pilot's analysis and publish jobs must not be hand-typed gcloud.

        deploy.ps1 only deploys agendaframe-config-check. Running the pilot by
        hand would bypass the clean-tree, full-gate and exact-SHA checks and
        leave nothing reviewable, so the two one-shot jobs are scripted with the
        same guards.
        """
        script = (ROOT / "scripts" / "gcp" / "deploy-trial-jobs.ps1").read_text(encoding="utf-8")
        self.assertIn("agendaframe-frame-trial", script)
        self.assertIn("agendaframe-publish-trial", script)

        # Inherited guards.
        self.assertIn("Refusing to target an unreviewed project", script)
        self.assertIn("[switch]$Apply", script)
        self.assertIn("[switch]$FullGatePassed", script)
        self.assertIn("Deployment is blocked until the full offline gate has passed.", script)
        self.assertIn("status --porcelain --untracked-files=no", script)
        self.assertIn("CommitSha must match the checked-out commit.", script)
        self.assertIn('"^[a-f0-9]{40}$"', script)
        self.assertIn("runtime:$CommitSha", script)

        # One-shot posture: no retries, no scheduler, billed run is opt-in.
        # Match the command that would create a trigger, not the word, so the
        # script can still explain in prose why no schedule exists.
        self.assertIn('"--max-retries", "0"', script)
        self.assertIn("[switch]$Execute", script)
        self.assertNotIn("scheduler jobs create", script)
        self.assertNotIn("--schedule", script)

        # Least-privilege identities per job.
        self.assertIn('"analyzer@$ProjectId.iam.gserviceaccount.com"', script)
        self.assertIn('"publisher@$ProjectId.iam.gserviceaccount.com"', script)

        # The retired publication flag must not come back.
        self.assertNotIn("--approve-published-cluster", script)
        self.assertIn("--cluster-approval-json=", script)

        # Transient input contract, mirrored from backend.main._private_gcs_parts.
        self.assertIn("transient-inputs/", script)

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

    def test_runtime_image_defaults_to_recurring_entrypoint_and_config_check_overrides_it(
        self,
    ) -> None:
        dockerfile = (ROOT / "src" / "backend" / "Dockerfile").read_text(encoding="utf-8")
        self.assertIn('ENTRYPOINT ["python", "-m", "backend.gcp_job_entrypoint"]', dockerfile)
        self.assertNotIn('CMD ["validate-config"]', dockerfile)

        script = (ROOT / "scripts" / "gcp" / "deploy.ps1").read_text(encoding="utf-8")
        self.assertIn("--command python", script)
        self.assertIn('--args "-m,backend.main,validate-config"', script)

    def test_runtime_job_deployment_uses_real_entrypoint_and_cutover_guards(self) -> None:
        script = (ROOT / "scripts" / "gcp" / "deploy-runtime-job.ps1").read_text(encoding="utf-8")
        self.assertIn("backend.gcp_job_entrypoint", script)
        self.assertIn(
            "AGENDAFRAME_ADAPTER_FACTORY=backend.gcp_production_adapters:production_adapter_factory",
            script,
        )
        self.assertIn(
            "AGENDAFRAME_STAGE_DEPENDENCIES_FACTORY=backend.gcp_live_dependencies:build_stage_dependencies",
            script,
        )
        self.assertIn("AGENDAFRAME_PIPELINE_OWNER=gcp", script)
        self.assertIn("AGENDAFRAME_CLOUDFLARE_CRON_ENABLED=false", script)
        self.assertIn("AGENDAFRAME_LEGACY_SCHEDULE_ENABLED=false", script)
        self.assertIn("[switch]$FullGatePassed", script)
        self.assertIn("status --porcelain --untracked-files=no", script)
        self.assertIn("-RunId and -ScheduledTime are required", script)
        self.assertNotIn("scheduler jobs create", script)

    def test_snapshot_reader_deployment_is_dry_run_and_read_only_by_default(self) -> None:
        script = (ROOT / "scripts" / "gcp" / "deploy-snapshot-reader.ps1").read_text(
            encoding="utf-8"
        )
        self.assertIn("agendaframe-snapshot-reader", script)
        self.assertIn("backend.gcp_snapshot_reader_service", script)
        self.assertIn("reader@$ProjectId.iam.gserviceaccount.com", script)
        self.assertIn(
            "roles/storage.objectViewer",
            (ROOT / "scripts" / "gcp" / "provision.ps1").read_text(encoding="utf-8"),
        )
        provision = (ROOT / "scripts" / "gcp" / "provision.ps1").read_text(encoding="utf-8")
        self.assertIn('"workflows.googleapis.com"', provision)
        self.assertIn('"pubsub.googleapis.com"', provision)
        self.assertIn('"monitoring.googleapis.com"', provision)
        self.assertIn('"reader"', provision)
        self.assertIn('"scheduler"', provision)
        self.assertIn("[switch]$Apply", script)
        self.assertIn("[switch]$FullGatePassed", script)
        self.assertIn("[switch]$AllowUnauthenticated", script)
        self.assertIn("[switch]$Promote", script)
        self.assertIn("--no-traffic", script)
        self.assertIn("AGENDAFRAME_PRIVATE_BUCKET", script)
        self.assertIn("status --porcelain --untracked-files=no", script)
        self.assertIn("CommitSha must match the checked-out commit", script)
        self.assertNotIn("scheduler jobs create", script)

    def test_snapshot_reader_canary_verifier_is_explicit_and_body_free(self) -> None:
        script = (ROOT / "scripts" / "gcp" / "verify-snapshot-reader.ps1").read_text(
            encoding="utf-8"
        )
        self.assertIn("[switch]$Execute", script)
        self.assertIn("Invoke-WebRequest", script)
        self.assertIn("/healthz", script)
        self.assertIn("/active", script)
        self.assertIn("application/json", script)
        self.assertIn("agenda.frame.active-snapshot.v1", script)
        self.assertIn("exactly five", script)
        self.assertIn("Assert-NoForbiddenKeys", script)
        self.assertIn("ExpectedSnapshotId", script)
        self.assertIn("BearerToken", script)
        self.assertIn("Authorization", script)
        self.assertIn("must use HTTPS", script)

    def test_orchestration_deployment_is_dry_run_and_scheduler_is_explicit(self) -> None:
        script = (ROOT / "scripts" / "gcp" / "deploy-orchestration.ps1").read_text(encoding="utf-8")
        self.assertIn("workflow-runtime.yaml", script)
        self.assertIn("$Gcloud.Source workflows deploy", script)
        self.assertIn("--call-log-level log-errors-only", script)
        self.assertIn("[switch]$CreateScheduler", script)
        self.assertIn("scheduler jobs create http", script)
        self.assertIn("scheduler jobs update http", script)
        self.assertIn("scheduler-execution-body.json", script)
        self.assertIn("--message-body-from-file", script)
        self.assertIn("Content-Type=application/json", script)
        self.assertIn("--update-headers", script)
        self.assertIn("0 3,9,15,21 * * *", script)
        self.assertIn("Etc/UTC", script)
        self.assertIn("status --porcelain --untracked-files=no", script)
        self.assertIn("CommitSha must match the checked-out commit.", script)
        self.assertIn("Dry run only", script)
        body = json.loads(
            (ROOT / "infra" / "gcp" / "scheduler-execution-body.json").read_text(encoding="utf-8")
        )
        self.assertEqual(body, {"argument": "{}"})
        self.assertIsInstance(body["argument"], str)

        provision = (ROOT / "scripts" / "gcp" / "provision.ps1").read_text(encoding="utf-8")
        self.assertIn('"workflow"', provision)
        self.assertIn('@("workflow", "roles/run.admin")', provision)
        self.assertIn('@("scheduler", "roles/workflows.invoker")', provision)


if __name__ == "__main__":
    unittest.main()
