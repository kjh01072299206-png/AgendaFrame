"""Additive fine-observation contract; never relabel legacy AI prose as new analysis.

Candidate discovery is broad; binding is exact and per observation. Source
selection is an observation, not an outlet's endorsement of a quoted opinion.
"""

from __future__ import annotations

import hashlib
from typing import Any, Mapping, Sequence

VERSION = "fine-comparison-v1.0.0"
AXES = (
    "title_lead", "certainty", "agency", "evaluative_language",
    "sources_countervoices", "placement", "context_depth", "additional_context",
)
STATES = (
    "verified_detail", "expression_only", "not_observed", "source_incomplete",
    "comparison_insufficient", "pending", "failed",
)
VOICES = ("journalist_narration", "direct_quote", "indirect_source", "uncertain_quote", "title_selection")


def response_schema(refs: Mapping[str, Any]) -> dict[str, Any]:
    def obj(properties: dict[str, Any]) -> dict[str, Any]:
        return {"type": "object", "properties": properties, "required": list(properties), "additionalProperties": False}

    text = {"type": "string"}
    title_basis = obj({"title": text, "title_sha256": text})
    title_basis["nullable"] = True
    article = obj({
        "article_id": text, "outlet": text, "description": text,
        "voice": {"type": "string", "enum": list(VOICES)}, "evidence": dict(refs), "scope": text,
        "title_basis": title_basis,
    })
    observation = obj({
        "observation_id": text, "axis": {"type": "string", "enum": list(AXES)},
        "status": {"type": "string", "enum": list(STATES)}, "headline": text,
        "common": text, "articles": {"type": "array", "items": article, "maxItems": 4},
        "difference": text, "importance": obj({"level": {"type": "string", "enum": ["low", "medium", "high"]}, "reason": text}),
        "interpretation": text, "limitations": text,
    })
    return obj({"version": {"type": "string", "enum": [VERSION]}, "observations": {"type": "array", "items": observation, "maxItems": 24}})


def bind_fine_comparison(
    raw: object, *, articles: Sequence[Mapping[str, Any]],
    index: Mapping[tuple[Any, ...], dict[str, Any]],
    profiles: Sequence[Mapping[str, Any]] | None = None,
) -> dict[str, Any] | None:
    if not isinstance(raw, Mapping) or raw.get("version") != VERSION:
        return None
    by_id = {str(row.get("articleId")): row for row in articles}
    by_profile = {str(row.get("articleId")): row for row in profiles or []}
    verified: list[dict[str, Any]] = []
    rejected: list[dict[str, str]] = []
    observations = raw.get("observations")
    if not isinstance(observations, list):
        return None
    for item in observations[:24]:
        if not isinstance(item, Mapping):
            continue
        reason = None
        rows = item.get("articles") or []
        if not isinstance(rows, list) or any(not isinstance(row, Mapping) for row in rows):
            rejected.append({"headline": str(item.get("headline") or ""), "reason": "invalid_article_rows"})
            continue
        if item.get("axis") not in AXES or item.get("status") not in STATES or not item.get("observation_id"):
            reason = "invalid_observation_contract"
        observed = item.get("status") in {"verified_detail", "expression_only"}
        importance = item.get("importance")
        if not isinstance(importance, Mapping) or importance.get("level") not in {"low", "medium", "high"}:
            reason = "invalid_importance"
        if observed and (len({row.get("article_id") for row in rows}) < 2 or any(not item.get(key) for key in ("common", "difference", "interpretation", "limitations")) or not isinstance(importance, Mapping) or not importance.get("reason")):
            reason = "missing_comparison_explanation"
        descriptions: set[str] = set()
        for row in rows:
            article_id = str(row.get("article_id") or "")
            article = by_id.get(article_id)
            entry = by_profile.get(article_id) if profiles is not None else None
            profile = (entry or {}).get("profile") or {}
            if profiles is not None:
                engine = (entry or {}).get("engine") or {}
                profile_engine = profile.get("engine") or {}
                body_hash = (article or {}).get("bodySha256")
                blocked = {"failed", "analysis_failed", "conflicting", "pending", "review_needed", "insufficient_evidence", "dead_letter"}
                review = profile.get("review") or {}
                if not entry or entry.get("status") != "succeeded" or engine.get("status") != "succeeded" or any(state in blocked for state in (profile_engine.get("status"), review.get("status"), review.get("analysis_decision"))):
                    reason = "article_analysis_unavailable"
                elif not body_hash or engine.get("bodySha256") != body_hash or (profile.get("article") or {}).get("body_sha256") != body_hash:
                    reason = "article_body_generation_mismatch"
                elif engine.get("promptVersion") != profile_engine.get("prompt_version") or engine.get("promptVersion") not in {"2.6.0:sentence-anchor-v1.2.0", "2.6.0:sentence-anchor-v1.3.0"}:
                    reason = "article_prompt_generation_mismatch"
                elif engine.get("articleId") != article_id or (profile.get("article") or {}).get("article_id") != article_id or engine.get("schemaVersion") != "agendaframe.article-frame-profile.v2" or profile_engine.get("analysis_schema_version") != 3:
                    reason = "article_identity_schema_mismatch"
                if item.get("status") == "not_observed" and (profile.get("extraction") or {}).get("input_truncated"):
                    reason = "incomplete_body_cannot_support_absence"
            description = str(row.get("description") or "").strip()
            if not article or row.get("outlet") != article.get("outlet"):
                reason = "article_outlet_mismatch"
            if not description or description in descriptions or not row.get("scope"):
                reason = "missing_independent_article_explanation"
            descriptions.add(description)
            if row.get("voice") not in VOICES:
                reason = "invalid_voice"
            title_basis = row.get("title_basis")
            if title_basis is not None:
                title = (article or {}).get("title")
                expected_title_hash = hashlib.sha256(f"agendaframe:title:v2:{article_id}:{title}".encode("utf-8")).hexdigest()
                if not isinstance(title_basis, Mapping) or not title or item.get("axis") != "title_lead" or row.get("voice") != "title_selection" or title_basis.get("title") != title or title_basis.get("title_sha256") != expected_title_hash:
                    reason = "title_evidence_mismatch"
                elif profiles is not None and (profile.get("article") or {}).get("title_sha256") != expected_title_hash:
                    reason = "title_evidence_mismatch"
                continue
            if row.get("voice") == "title_selection":
                reason = "title_evidence_mismatch"
            refs = row.get("evidence") or []
            if not refs:
                reason = "missing_article_evidence"
            for ref in refs:
                if not isinstance(ref, Mapping):
                    reason = "invalid_evidence"
                    continue
                locator = ref.get("locator") or {}
                key = (ref.get("article_id"), locator.get("paragraph"), locator.get("sentence"), str(ref.get("sentence_sha256") or "").lower())
                if ref.get("article_id") != article_id or key not in index:
                    reason = "unbound_article_evidence"
                if profiles is not None:
                    supported = [candidate for node in (profile.get("dimensions") or {}).values() if node.get("model_status") == "supported" for candidate in node.get("items") or []]
                    if not any((candidate.get("evidence") or {}) == {"locator": dict(locator), "sentence_sha256": ref.get("sentence_sha256")} and (candidate.get("voice") or {}).get("kind") == row.get("voice") for candidate in supported):
                        reason = "evidence_voice_mismatch"
        if reason:
            rejected.append({"headline": str(item.get("headline") or ""), "reason": reason})
        else:
            verified.append(dict(item))
    return {"version": VERSION, "producer": "evidence-bound-ai-draft", "observations": verified, "rejected": rejected}


PROMPT = """Fine comparison contract fine-comparison-v1.0.0:
Discover candidates broadly in title/lead focus, certainty, agency, evaluative
intensity, source selection/countervoices, placement/order/repetition, context
depth and additional statistics/examples/alternatives. Then compare BOTH
articles' anchors and surrounding context before retaining an observation.
Write article A and B independently (2-3 grounded sentences when evidence
supports them), then a separate comparison (3-5 non-repetitive sentences).
Order: common content -> A -> B -> concrete difference -> interpretive scope
-> per-article evidence and limitations. Never copy the same paragraph to both.
Same core with detail does not erase details. Expression-only differences may
be observed while frame interpretation remains held. Synonyms, sentence length
or publication-time updates alone do not establish frame differences.
Separate what a source says, the outlet's selection/placement of that statement,
and journalist narration. Never turn quotations into the outlet's position.
If title/lead/body layout or surrounding context is absent from supplied inputs,
record source_incomplete/pending, not an absence or exclusion claim. Do not
infer ideology, intent, opposition or an actual effect on readers. Give narrow
interpretation, importance and its reason, scope and limitations for each item.
Return zero verified observations if none survive; never fill an item quota.
For a title-only observation use voice title_selection and the exact supplied
title and title_sha256 in title_basis, with empty sentence evidence. For body
observations set title_basis to null and bind actual sentence evidence. A title
observation does not prove lead/body placement or absence elsewhere in the body.
"""
