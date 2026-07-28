from __future__ import annotations

import unittest

from agendaframe_tooling.evaluation import (
    clustering_metrics,
    multilabel_macro_f1,
    pairs_from_clusters,
)


class ClusteringMetricTests(unittest.TestCase):
    def test_pairs_are_derived_from_disjoint_clusters(self) -> None:
        self.assertEqual(
            pairs_from_clusters([["a3"], ["a2", "a1", "a4"]]),
            {("a1", "a2"), ("a1", "a4"), ("a2", "a4")},
        )

    def test_pairwise_metrics_expose_over_and_under_merge(self) -> None:
        metrics = clustering_metrics(
            gold_same_pairs=[("a1", "a2"), ("a3", "a4")],
            predicted_same_pairs=[("a1", "a2"), ("a2", "a3")],
        )

        self.assertAlmostEqual(metrics.pairwise.precision, 0.5)
        self.assertAlmostEqual(metrics.pairwise.recall, 0.5)
        self.assertAlmostEqual(metrics.pairwise.f1, 0.5)
        self.assertAlmostEqual(metrics.overmerge_rate, 0.5)
        self.assertAlmostEqual(metrics.undermerge_rate, 0.5)


class FramingMetricTests(unittest.TestCase):
    def test_multilabel_macro_f1_is_computed_per_label(self) -> None:
        macro_f1, per_label = multilabel_macro_f1(
            gold_by_case={"c1": {"economic", "policy"}, "c2": {"economic"}},
            predicted_by_case={"c1": {"economic"}, "c2": {"economic", "policy"}},
            labels={"economic", "policy"},
        )

        self.assertAlmostEqual(per_label["economic"].f1, 1.0)
        self.assertAlmostEqual(per_label["policy"].f1, 0.0)
        self.assertAlmostEqual(macro_f1, 0.5)

    def test_case_id_mismatch_is_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, "case IDs differ"):
            multilabel_macro_f1({"gold": {"economic"}}, {"prediction": {"economic"}})


if __name__ == "__main__":
    unittest.main()
