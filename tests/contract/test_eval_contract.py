from __future__ import annotations

import json
import unittest
from pathlib import Path
from typing import Any

import yaml

from agendaframe_tooling.evaluation import normalize_pair, pairs_from_clusters

ROOT = Path(__file__).resolve().parents[2]
EVALS = ROOT / "evals"
FRAME_LABELS = {
    "conflict",
    "responsibility",
    "economic",
    "legal_institutional",
    "policy_effect",
    "citizen_impact",
}


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    for line_number, raw_line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not raw_line.strip():
            continue
        try:
            value = json.loads(raw_line)
        except json.JSONDecodeError as error:
            raise AssertionError(f"{path}:{line_number}: {error}") from error
        if not isinstance(value, dict):
            raise AssertionError(f"{path}:{line_number}: expected a JSON object")
        records.append(value)
    return records


class EvaluationContractTests(unittest.TestCase):
    def test_clustering_gold_is_a_complete_disjoint_partition(self) -> None:
        records = read_jsonl(EVALS / "clustering" / "gold.jsonl")
        self.assertGreater(len(records), 0)
        self.assertEqual(len({record["case_id"] for record in records}), len(records))

        for record in records:
            with self.subTest(case=record["case_id"]):
                self.assertEqual(record["schema_version"], 1)
                self.assertEqual(record["source"]["kind"], "synthetic")
                article_ids = {article["article_id"] for article in record["articles"]}
                self.assertEqual(len(article_ids), len(record["articles"]))
                cluster_ids = [cluster["article_ids"] for cluster in record["gold_clusters"]]
                flattened = [article_id for cluster in cluster_ids for article_id in cluster]
                self.assertEqual(set(flattened), article_ids)
                self.assertEqual(len(flattened), len(set(flattened)))
                for cluster in record["gold_clusters"]:
                    self.assertIn(cluster["representative_article_id"], cluster["article_ids"])

                same_pairs = pairs_from_clusters(cluster_ids)
                hard_negatives = {normalize_pair(pair) for pair in record["hard_negative_pairs"]}
                self.assertTrue(hard_negatives)
                self.assertTrue(
                    all(set(pair) <= article_ids for pair in hard_negatives),
                )
                self.assertTrue(same_pairs.isdisjoint(hard_negatives))

    def test_framing_gold_links_each_label_to_exact_evidence(self) -> None:
        records = read_jsonl(EVALS / "framing" / "gold.jsonl")
        self.assertGreater(len(records), 0)
        self.assertEqual(len({record["case_id"] for record in records}), len(records))

        for record in records:
            with self.subTest(case=record["case_id"]):
                text = record["input"]["text"]
                gold = record["gold"]
                labels = {entry["label"] for entry in gold["labels"]}
                absent_labels = set(gold["absent_labels"])
                self.assertIn(gold["decision"], {"analyze", "review_needed", "defer"})
                self.assertTrue(labels)
                self.assertTrue(labels <= FRAME_LABELS)
                self.assertTrue(absent_labels <= FRAME_LABELS)
                self.assertTrue(labels.isdisjoint(absent_labels))
                self.assertEqual(labels | absent_labels, FRAME_LABELS)

                for label in gold["labels"]:
                    self.assertTrue(label["evidence"])
                    for evidence in label["evidence"]:
                        start = evidence["start"]
                        end = evidence["end"]
                        self.assertEqual(evidence["source_field"], "text")
                        self.assertGreaterEqual(start, 0)
                        self.assertGreater(end, start)
                        self.assertEqual(text[start:end], evidence["text"])

    def test_report_gold_limits_claims_to_supplied_evidence(self) -> None:
        records = read_jsonl(EVALS / "report" / "gold.jsonl")
        self.assertGreater(len(records), 0)
        required_sections = {
            "summary",
            "main_perspectives",
            "underrepresented_perspectives",
            "bias_possibility",
            "caveats",
            "citations",
        }

        for record in records:
            with self.subTest(case=record["case_id"]):
                evidence_ids = {evidence["evidence_id"] for evidence in record["input"]["evidence"]}
                article_urls = {article["source_url"] for article in record["input"]["articles"]}
                self.assertTrue(all(".invalid/" in url for url in article_urls))
                self.assertEqual(
                    set(record["gold"]["required_sections"]),
                    required_sections,
                )
                for claim in record["gold"]["claim_atoms"]:
                    self.assertTrue(set(claim["support_ids"]) <= evidence_ids)

    def test_thresholds_block_release_for_synthetic_only_data(self) -> None:
        thresholds = yaml.safe_load((EVALS / "thresholds.yaml").read_text(encoding="utf-8"))
        self.assertEqual(thresholds["dataset_status"], "synthetic_schema_only")
        self.assertIs(thresholds["release_eligible"], False)
        self.assertIs(thresholds["release_policy"]["allow_synthetic_only"], False)

        required_metrics = {
            "clustering": {"pairwise_f1", "overmerge_rate", "undermerge_rate"},
            "framing": {"macro_f1", "evidence_exact_substring_rate"},
            "report": {"citation_coverage", "unsupported_claim_rate"},
        }
        for section, metric_names in required_metrics.items():
            for metric_name in metric_names:
                metric = thresholds[section][metric_name]
                self.assertIn(metric["operator"], {"gte", "lte", "eq"})
                self.assertIsInstance(metric["value"], (int, float))

    def test_report_rubric_has_complete_weights_and_anchors(self) -> None:
        rubric = yaml.safe_load((EVALS / "report" / "rubric.yaml").read_text(encoding="utf-8"))
        weights = [dimension["weight"] for dimension in rubric["dimensions"]]
        self.assertAlmostEqual(sum(weights), 1.0)
        required_anchors = set(rubric["scale"]["required_anchors"])
        for dimension in rubric["dimensions"]:
            self.assertEqual(set(dimension["anchors"]), required_anchors)
        self.assertGreater(len(rubric["automatic_failures"]), 0)

    def test_prompt_manifest_references_versioned_prompts_and_valid_schemas(self) -> None:
        prompt_root = EVALS / "prompts"
        manifest = yaml.safe_load((prompt_root / "manifest.yaml").read_text(encoding="utf-8"))
        self.assertGreater(len(manifest["prompts"]), 0)

        for prompt in manifest["prompts"]:
            with self.subTest(prompt=prompt["id"]):
                prompt_path = prompt_root / prompt["path"]
                schema_path = prompt_root / prompt["output_schema"]
                self.assertTrue(prompt_path.is_file())
                self.assertTrue(schema_path.is_file())
                prompt_text = prompt_path.read_text(encoding="utf-8")
                self.assertIn(f"v{prompt['version']}", prompt_text)
                self.assertIn("not approved for production", prompt_text)
                schema = json.loads(schema_path.read_text(encoding="utf-8"))
                self.assertEqual(schema["type"], "object")
                prompt_version_const = schema["properties"]["prompt_version"]["const"]
                self.assertTrue(
                    prompt_version_const == prompt["version"]
                    or str(prompt_version_const).endswith(str(prompt["version"])),
                    f"schema prompt version {prompt_version_const!r} does not match {prompt['version']!r}",
                )


if __name__ == "__main__":
    unittest.main()
