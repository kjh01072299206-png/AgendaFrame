# Fine comparison v1.0.0

Status: not approved for production. Human-reviewed real-article evaluation is pending.

Additive contract; legacy event synthesis v2.2.0 and comparison v1.0.0 are not
renamed. Runtime prompt and response schema: `src/ai/fine_comparison.py`.
Transport: event-synthesis-transport-v1.4.0. Article sentence prompt:
2.6.0:sentence-anchor-v1.3.0 (`scripts/run-current-display-framing-live.py`).

Discover candidates across title/lead, certainty, agency, evaluative language,
source/countervoice selection, placement, context depth and added context.
Verify both article IDs, outlet mappings, body generations, voice, sentence
locators/hashes and surrounding context before explaining independently.
Preserve valid siblings when another observation is held. Same core does not
erase a verified detail. Synonyms and publication-time updates alone are not
frame differences. Never infer an outlet's endorsement from a source quotation,
ideology, intent, opposition, or actual reader effects.

Each retained comparison has independent A/B explanations, common ground,
concrete difference, importance with reason, narrow interpretation, scopes and
limitations. Insufficient body/context cannot support absence claims.
Seven states distinguish verified detail, expression-only, not observed,
source incomplete, insufficient comparison, pending, and failed.

Title-only rows use title_selection and title_basis with the exact title and
namespaced title digest supplied in the article input, with no sentence refs.
Body rows use title_basis=null and actual sentence refs. The binder verifies
the article ID, title and original profile digest; titles cannot prove lead or
body placement. Rejected observations retain machine reasons for Korean UI
feedback without hiding valid sibling observations.

No new model-quality evaluation is claimed. Saved title metadata reviews use
producer `editorial-title-review` and are not model reruns or body comparisons.
