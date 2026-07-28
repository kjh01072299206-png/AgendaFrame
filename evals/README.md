# AgendaFrame evaluations

This directory holds versioned, reviewable quality gates for the non-deterministic
parts of AgendaFrame. Unit tests prove code behavior; evaluations measure whether
clustering, frame labels, and generated reports remain useful and evidence-based.

The committed JSONL records are synthetic schema examples, not a statistically
meaningful benchmark. Before model selection or production launch, replace or
extend them with a separately licensed, double-annotated Korean news set. Keep a
locked holdout split and record annotator agreement.

## Metrics

- Clustering: pairwise precision/recall/F1 plus over-merge and under-merge rates.
- Framing: multi-label macro F1, per-label recall, and evidence-span support.
- Reports: citation coverage, unsupported-claim rate, source diversity, and a
  blinded human rubric score.

Never put API keys, private articles, or production user data in an evaluation
record. Store model outputs separately from gold labels and include model, prompt,
taxonomy, dataset, and code versions in every run manifest.
