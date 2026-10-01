# Event synthesis prompt v2.2.0

Status: not approved for production. This is a versioned comparison contract for
short, evidence-linked outlet comparisons.
The synthetic hard-negative cases are fixtures only. They are not model-quality
results or publication evidence. Production publication still requires
article-level evidence binding, a labeled human-reviewed holdout, and live
screen verification.

Synthesize one Korean news event from already-coded article profiles. The input
contains article titles, outlet names, public paraphrases, voice kinds, frame
family codes, and locator/hash evidence. It never contains article bodies.
Return one JSON object matching `schemas/event-synthesis-v2.2-output.schema.json`.

## Comparison contract

Always return `comparison_result` with `difference_confirmed`,
`no_clear_difference`, `held_for_analysis`, or `analysis_failed`. For every
supported core dimension, choose one relation: `same_core`,
`same_core_with_detail`, `different_emphasis`, `contradictory`, or
`insufficient_evidence`.

Do not infer relations from frame-family codes, token overlap, sentence
similarity, group counts, outlet names, or source quotes. A confirmed
cross-outlet difference requires journalist-narration evidence from at least
two distinct outlets. Keep each outlet's own article separate, including
multiple articles from the same outlet. Do not treat an added detail as a
shared claim unless every cited article supports that detail.

`no_clear_difference` means the compared material was sufficient and supports
the same core or the same core with added detail. Use `held_for_analysis` when
the evidence is insufficient or the relationship cannot be decided. Use
`analysis_failed` only for an actual failed or conflicting analysis. Do not turn
missing evidence into sameness or difference.

Each comparison point must have a stable `observation_id` (or `claim_id`), a
short `headline` of at most 40 characters, a distinct `summary` of at most 120
characters, and its original relation-bearing `text` of at most 320 characters.
The headline names the supported emphasis; the summary adds a different detail
and must not repeat the headline. Do not cut a sentence to meet a length limit;
rewrite it without dropping negation or causal direction. A dimension's
question must be one concrete Korean sentence of at most 70 characters.

An emphasis difference does not require `camps`. Reserve `camps` for a real,
evidence-backed opposition and return zero camps otherwise. A missing or invalid
comparison result must remain held for analysis, never be reconstructed from
profile codes.

## Other fields and evidence

- Return 2–4 concise `event_paragraphs`, event first, followed only by supported
  chronology or context.
- Return 0–4 terms. If no common explanation is supported across at least two
  articles, set `common_ground` to `{ "text": null, "status":
  "insufficient_evidence", "evidence": [] }`.
- Use `모두` only when every article supports the common claim, `대부분` only
  when at least 70% support it, and `일부` below that.
- Every public claim and comparison point must cite the supplied article ID,
  paragraph, sentence, and 64-character sentence hash. A claim's evidence must
  belong to each article it names. Keep every distinct valid evidence span.
- Keep journalist narration separate from source-attributed speech. Source
  disagreement alone never confirms an outlet's stance.
- Never copy article body text, HTML, raw sentences, or internal English frame
  codes. Do not infer hidden intent or fixed political ideology.
