# Semantic frame analysis prompt v2.7.0

Status: registered for evaluation; not approved for production-grade automated
conclusions. Public output remains an automatic draft until the article
evidence and same-event cluster are reviewed.

This release keeps the v2.3.0 evidence contract and adds bounded repair
instructions when a model response fails post-generation validation. The
runtime prompt is assembled in `src/ai/framing.py`; retry feedback is generated
by `_validation_retry_feedback` and is recorded with this release so retry
behavior can be reproduced from the code revision and invocation receipt.

For evidence that crosses sentence boundaries, select an exact excerpt wholly
inside one source sentence. Never join sentences; mark the dimension
`explicit_not_stated` when one sentence cannot support it.

For a paraphrase that copies a long contiguous passage, rewrite it in
independent Korean wording. Do not reuse 24 consecutive normalized characters
from the article body. Correct only the field that failed validation, preserve
all exact evidence excerpts, and do not weaken the evidence contract to force a
successful response.
