"""Small, dependency-free metrics for offline evaluation checks."""

from __future__ import annotations

from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from typing import TypeAlias

Pair: TypeAlias = tuple[str, str]


@dataclass(frozen=True)
class BinaryMetrics:
    precision: float
    recall: float
    f1: float


@dataclass(frozen=True)
class ClusteringMetrics:
    pairwise: BinaryMetrics
    overmerge_rate: float
    undermerge_rate: float


def _safe_ratio(numerator: int, denominator: int, *, empty: float) -> float:
    return numerator / denominator if denominator else empty


def normalize_pair(pair: Sequence[str]) -> Pair:
    """Return a stable unordered pair and reject malformed/self pairs."""

    if len(pair) != 2:
        raise ValueError("an article pair must contain exactly two IDs")
    left, right = pair
    if not left or not right:
        raise ValueError("article IDs must be non-empty")
    if left == right:
        raise ValueError("an article cannot be paired with itself")
    return (left, right) if left < right else (right, left)


def pairs_from_clusters(clusters: Iterable[Iterable[str]]) -> set[Pair]:
    """Derive all same-cluster article pairs from a gold partition."""

    pairs: set[Pair] = set()
    seen: set[str] = set()
    for raw_cluster in clusters:
        article_ids = list(raw_cluster)
        if not article_ids:
            raise ValueError("clusters must not be empty")
        if len(article_ids) != len(set(article_ids)):
            raise ValueError("a cluster contains duplicate article IDs")
        overlap = seen.intersection(article_ids)
        if overlap:
            raise ValueError(f"articles occur in multiple clusters: {sorted(overlap)}")
        seen.update(article_ids)
        for index, left in enumerate(article_ids):
            for right in article_ids[index + 1 :]:
                pairs.add(normalize_pair((left, right)))
    return pairs


def clustering_metrics(
    gold_same_pairs: Iterable[Sequence[str]],
    predicted_same_pairs: Iterable[Sequence[str]],
) -> ClusteringMetrics:
    """Calculate pairwise F1 and directional merge-error rates.

    ``overmerge_rate`` is the share of predicted same-issue pairs that are false.
    ``undermerge_rate`` is the share of gold same-issue pairs that were missed.
    """

    gold = {normalize_pair(pair) for pair in gold_same_pairs}
    predicted = {normalize_pair(pair) for pair in predicted_same_pairs}
    true_positives = len(gold & predicted)
    false_positives = len(predicted - gold)
    false_negatives = len(gold - predicted)

    precision = _safe_ratio(true_positives, len(predicted), empty=1.0 if not gold else 0.0)
    recall = _safe_ratio(true_positives, len(gold), empty=1.0)
    f1 = _safe_ratio(2 * precision * recall, precision + recall, empty=0.0)

    return ClusteringMetrics(
        pairwise=BinaryMetrics(precision=precision, recall=recall, f1=f1),
        overmerge_rate=_safe_ratio(false_positives, len(predicted), empty=0.0),
        undermerge_rate=_safe_ratio(false_negatives, len(gold), empty=0.0),
    )


def multilabel_macro_f1(
    gold_by_case: Mapping[str, set[str]],
    predicted_by_case: Mapping[str, set[str]],
    labels: Iterable[str] | None = None,
) -> tuple[float, dict[str, BinaryMetrics]]:
    """Calculate one-vs-rest macro F1 for a multi-label classification set."""

    if set(gold_by_case) != set(predicted_by_case):
        missing = sorted(set(gold_by_case) - set(predicted_by_case))
        extra = sorted(set(predicted_by_case) - set(gold_by_case))
        raise ValueError(f"prediction case IDs differ (missing={missing}, extra={extra})")

    label_set = set(labels or ())
    if not label_set:
        label_set.update(label for values in gold_by_case.values() for label in values)
        label_set.update(label for values in predicted_by_case.values() for label in values)
    if not label_set:
        raise ValueError("at least one label is required")

    per_label: dict[str, BinaryMetrics] = {}
    for label in sorted(label_set):
        gold_cases = {case_id for case_id, values in gold_by_case.items() if label in values}
        predicted_cases = {
            case_id for case_id, values in predicted_by_case.items() if label in values
        }
        true_positives = len(gold_cases & predicted_cases)
        precision = _safe_ratio(
            true_positives,
            len(predicted_cases),
            empty=1.0 if not gold_cases else 0.0,
        )
        recall = _safe_ratio(true_positives, len(gold_cases), empty=1.0)
        f1 = _safe_ratio(2 * precision * recall, precision + recall, empty=0.0)
        per_label[label] = BinaryMetrics(precision=precision, recall=recall, f1=f1)

    macro_f1 = sum(metric.f1 for metric in per_label.values()) / len(per_label)
    return macro_f1, per_label
