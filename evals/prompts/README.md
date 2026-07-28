# Prompt versions

Store reviewed prompt templates here under immutable semantic versions, for
example `frame-analysis-v1.0.0.md`. Each prompt must state its input/output schema,
taxonomy version, supported language, evidence requirements, and refusal behavior.

Record the prompt version in every model output and evaluation run. Do not edit a
released prompt in place; add a new version and compare both on the locked holdout.
