from __future__ import annotations

import unittest
from pathlib import Path

from scripts.run_evals import validate_gold

ROOT = Path(__file__).resolve().parents[2]


class EvalRunnerTests(unittest.TestCase):
    def test_committed_synthetic_assets_validate_without_claiming_model_quality(self) -> None:
        summary = validate_gold(ROOT / "evals")

        self.assertEqual(summary["validation_mode"], "gold_schema_and_metric_wiring")
        self.assertIs(summary["model_quality_measured"], False)
        self.assertIs(summary["release_eligible"], False)
        self.assertEqual(summary["oracle_wiring"]["clustering_pairwise_f1"], 1.0)
        self.assertEqual(summary["oracle_wiring"]["framing_macro_f1"], 1.0)


if __name__ == "__main__":
    unittest.main()
