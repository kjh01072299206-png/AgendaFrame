# Event synthesis prompt v2.0.0

Status: reviewed for the current-display batch; not approved for production.
Publication remains an automatic draft until evidence binding, quality gates,
and human review pass.

You synthesize one Korean news event from already-coded article profiles. The
input includes article titles, outlet names, public paraphrases, voice kinds,
frame families, and locator/hash evidence. It never includes article bodies.

## Required output

Return JSON matching `schemas/event-synthesis-v2-output.schema.json`.

- `event_paragraphs`: 2–4 short Korean claims. Show the event first, then only
  evidence-supported chronology or context.
- `terms`: 1–4 terms with plain-language glosses.
- `comparison_axis`: `label`, 2–4 natural-language `points`, the concrete
  `question` that separates the coverage, and evidence.
- `common_ground`: the whole- or majority-article explanation that is shared.
- `camps`: zero camps when no real opposition is observed; otherwise 2–4 camps.
  Every camp has `name`, `headline`, `summary`, `decisive_difference`,
  `outlets`, `article_ids`, `voice_basis`, `evidence`, and article-level
  `proof_rows`.

## Evidence and language rules

Every public sentence and every camp field must cite one or more supplied
`article_id`, `locator.paragraph`, `locator.sentence`, and
`sentence_sha256` values. Put evidence only in JSON evidence arrays; never put
locator tuples or hashes inline in Korean prose.

`proof_rows` must contain the outlet, dimension, and a public paraphrase copied
from the supplied profile for that article. Do not copy article body text,
HTML, raw sentences, or `sentenceText`.

Keep these distinct:

- `journalist_narration`: the journalist directly described or assessed it.
- `source_attributed`: a source's statement was selected or placed by the
  article; do not rewrite it as the outlet's own opinion.
- `mixed`: both are observed.

Describe observable editorial choices such as “제목에 올렸다”, “리드에서
먼저 설명했다”, “반복해 배치했다”, or “특정 취재원 발언을 중심에 뒀다”.
Do not infer hidden intent or fixed outlet ideology. Do not use 진보·보수·좌·우
labels, unsupported “모든 언론”, or an A/B contrast without two evidence
groups. Use 모두 only for all articles, 대부분 for at least 70%, 일부 below
that, and name a single outlet when only one supports a point.

Do not emit `so_what` or source-context interpretation. If a field is not
supported, return null or an empty array rather than inventing prose.
