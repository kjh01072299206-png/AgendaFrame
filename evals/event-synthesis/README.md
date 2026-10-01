# Event-synthesis comparison fixtures

`comparison-hard-negatives-v2.2.0.jsonl` contains only synthetic counterexamples
and contract descriptors for review and deterministic tests. It has no real
article bodies, real locators, or production analysis results. Entries marked
`synthetic_text_without_article_locator` intentionally cannot pass the evidence
binding gate.

The A–D cases protect negation, causality, and policy direction. F–H protect
the distinction between frame-family codes, shared core claims, and article-
specific details. I–J separate within-outlet variation and source-attributed
speech from cross-outlet journalist narration. K–N cover stale/invalid evidence
and deterministic ordering; O is a synthetic representative-card selection
descriptor. The real rank-5 profile check remains in
`site/tests/analysis-summary.test.ts` and is not duplicated here.

These fixtures do not measure model semantic accuracy. Passing binder/UI tests
only proves that the application preserves explicit relations and refuses to
invent conclusions from the sample text. A model-quality claim requires a
separately labeled, human-reviewed holdout and a verified live run.
