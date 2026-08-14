from __future__ import annotations

import json
import unittest
from pathlib import Path
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parents[2]
CONTRACT_DIR = ROOT / "infra" / "gcp"


def load(name: str) -> dict[str, Any]:
    path = CONTRACT_DIR / name
    assert path.is_file(), path
    value = yaml.safe_load(path.read_text(encoding="utf-8"))
    assert isinstance(value, dict), path
    return value


def walk(value: Any):
    if isinstance(value, dict):
        for key, child in value.items():
            yield str(key), child
            yield from walk(child)
    elif isinstance(value, list):
        for child in value:
            yield from walk(child)


class GcpOrchestrationContractTests(unittest.TestCase):
    def test_scheduler_matches_four_kst_runs_and_repository_policy(self) -> None:
        scheduler = load("scheduler.yaml")["spec"]
        self.assertEqual(scheduler["sourceSchedule"], "site/data/collection-schedule.json")
        self.assertEqual(scheduler["sourcePolicy"], "site/data/discovery-sources.json")
        self.assertEqual(scheduler["sourcePolicyVersion"], "2026-08-13.1")
        self.assertEqual(scheduler["timezone"], "Etc/UTC")
        self.assertEqual(scheduler["kst"]["scheduledHours"], [0, 6, 12, 18])
        self.assertEqual(scheduler["kst"]["runsPerDay"], 4)
        self.assertEqual(scheduler["schedule"], "0 3,9,15,21 * * *")
        self.assertEqual(scheduler["target"]["type"], "workflows")
        self.assertEqual(
            scheduler["request"]["body"]["rawContentDeleteAfter"], "2026-10-31T23:59:59+09:00"
        )
        self.assertEqual(scheduler["safety"]["overlapPolicy"], "workflow_idempotency_and_run_lease")
        sources = json.loads(
            (ROOT / "site" / "data" / "discovery-sources.json").read_text(encoding="utf-8")
        )["sources"]
        self.assertEqual(len(sources), scheduler["sourceCount"])
        self.assertEqual(
            sum(source["sourceType"] == "general_daily" for source in sources),
            scheduler["sourceComposition"]["generalDaily"],
        )
        self.assertEqual(
            sum(source["sourceType"] == "broadcaster" for source in sources),
            scheduler["sourceComposition"]["broadcaster"],
        )

    def test_workflow_has_ordered_stages_retries_and_publication_gate(self) -> None:
        workflow = load("workflow.yaml")["spec"]
        stages = workflow["stages"]
        names = [stage["name"] for stage in stages]
        self.assertEqual(
            names,
            ["collect", "persist", "cluster_rank", "top5_semantic", "quality_gate", "publish"],
        )
        self.assertEqual(workflow["sourcePolicyPath"], "site/data/discovery-sources.json")
        self.assertEqual(workflow["sourcePolicyVersion"], "2026-08-13.1")
        self.assertEqual(workflow["collectionSchedulePath"], "site/data/collection-schedule.json")
        self.assertEqual(workflow["rawContentDeleteAfter"], "2026-10-31T23:59:59+09:00")
        for stage in stages:
            self.assertIn("retry", stage, stage["name"])
            self.assertIn("idempotency", stage, stage["name"])
            self.assertGreaterEqual(stage["retry"]["maxAttempts"], 1)
            self.assertTrue(stage["idempotency"]["key"])

        semantic = stages[3]
        self.assertEqual(semantic["constraints"]["maxIssues"], 5)
        self.assertTrue(semantic["constraints"]["evidenceRequired"])
        self.assertFalse(semantic["constraints"]["publicBodyText"])
        gate = stages[4]
        publish = stages[5]
        self.assertTrue(gate["gates"]["rawBodyAbsent"])
        self.assertEqual(gate["onFailure"], "quarantine_and_keep_previous_snapshot")
        self.assertEqual(publish["requires"], ["quality_gate.pass"])
        self.assertEqual(publish["publication"]["pointerUpdate"], "last_atomic")
        self.assertTrue(publish["publication"]["retainPreviousSnapshot"])
        self.assertEqual(workflow["stores"]["metadataAndAnalysis"], "bigquery")
        self.assertEqual(workflow["stores"]["transactionalMetadata"], "not_connected")
        self.assertEqual(workflow["stores"]["futureMigration"]["target"], "cloud_sql")
        self.assertEqual(workflow["stores"]["futureMigration"]["status"], "planned")
        self.assertEqual(workflow["stores"]["futureMigration"]["runtimeAdapter"], "not_bound")
        self.assertEqual(workflow["publicSnapshotSchema"], "agenda.frame.active-snapshot.v1")
        self.assertIn("issueBundles", publish["publication"])

    def test_pubsub_contract_has_retry_and_dead_letter_without_raw_body(self) -> None:
        spec = load("pubsub.yaml")["spec"]
        subscription = spec["subscription"]
        self.assertEqual(subscription["deadLetterTopic"], "agenda-article-analysis-dlq")
        self.assertEqual(subscription["maxDeliveryAttempts"], 5)
        self.assertIn(429, subscription["retryableStatuses"])
        self.assertEqual(spec["deadLetter"]["topic"], "agenda-article-analysis-dlq")
        self.assertFalse(spec["deadLetter"]["rawBodyAllowed"])
        self.assertIn("bodyHash", spec["message"]["requiredFields"])
        self.assertIn("privateBodyObject", spec["message"]["requiredFields"])
        for forbidden in (
            "bodyText",
            "rawBody",
            "html",
            "sentenceText",
            "promptPayload",
            "accessToken",
        ):
            self.assertIn(forbidden, spec["message"]["forbiddenFields"])

    def test_monitoring_covers_failure_delay_and_snapshot_age(self) -> None:
        spec = load("monitoring.yaml")["spec"]
        names = {alert["name"] for alert in spec["alerts"]}
        self.assertTrue(
            {"collection-run-failed", "collection-run-delayed", "snapshot-age-too-old"} <= names
        )
        self.assertIn("active_snapshot_age", spec["dashboard"]["requiredPanels"])
        for key in spec["forbiddenLogFields"]:
            self.assertNotIn(key, spec["logFields"])

    def test_secrets_are_references_and_not_values(self) -> None:
        spec = load("secrets.yaml")["spec"]
        self.assertFalse(spec["policy"]["valuesInRepository"])
        self.assertFalse(spec["policy"]["valuesInLogs"])
        self.assertTrue(spec["policy"]["leastPrivilege"])
        for reference in spec["secretReferences"]:
            self.assertRegex(reference["secretId"], r"^agendaframe-[a-z0-9-]+$")
            self.assertNotIn("value", reference)
            self.assertEqual(reference["version"], "latest")

    def test_all_contracts_are_declared_offline_only_and_raw_body_safe(self) -> None:
        for path in sorted(CONTRACT_DIR.glob("*.yaml")):
            document = yaml.safe_load(path.read_text(encoding="utf-8"))
            self.assertEqual(
                document["metadata"]["implementationStatus"], "contract_only", path.name
            )
            self.assertFalse(document["metadata"]["externalCalls"], path.name)
            serialized = path.read_text(encoding="utf-8")
            self.assertNotRegex(
                serialized,
                r"(?i)(BEGIN (RSA|PRIVATE)|AIza[0-9A-Za-z_-]{20,}|Bearer\s+[A-Za-z0-9._-]{20,})",
            )

        workflow_text = (CONTRACT_DIR / "workflow.yaml").read_text(encoding="utf-8")
        for forbidden in (
            "body_text",
            "raw_body",
            "html",
            "sentence_text",
            "full_article",
            "prompt_payload",
        ):
            self.assertIn(forbidden, workflow_text)
        self.assertIn("failed_stage_does_not_replace_current_pointer", workflow_text)
        self.assertRegex(workflow_text, r"raw_body_never_enters_public_snapshot")


if __name__ == "__main__":
    unittest.main()
