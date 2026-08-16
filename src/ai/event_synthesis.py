"""Event-level comparison synthesis bound to article evidence.

Article-level Vertex profiles already code problem, cause, responsibility,
evaluation, remedy, and source visibility.  This module is the missing
issue-level step: it turns those profiles into the comparison fields the
example HTML expects (shared line, split line, camps, four-function rows)
without inventing ideology labels or uncited prose.

A model draft is untrusted.  ``bind_event_synthesis`` is the gate: every
public sentence must cite an article ID plus locator plus 64-hex sentence
hash that already exists in the article profiles.  Uncited claims are
dropped.  Opposition (A ↔ B) is allowed only when two or more evidence
groups survive.
"""

from __future__ import annotations

import hashlib
import json
import re
from datetime import UTC, datetime
from typing import Any, Mapping, Protocol, Sequence

LEGACY_PROMPT_VERSION = "event-synthesis-v1.0.0"
LEGACY_SCHEMA_VERSION = "agendaframe.event-synthesis.v1"
PROMPT_VERSION = "event-synthesis-v2.0.0"
SCHEMA_VERSION = "agendaframe.event-synthesis.v2"
SHA256_PATTERN = re.compile(r"^[0-9a-fA-F]{64}$")
INLINE_EVIDENCE_PATTERN = re.compile(
    r"\s*\(([0-9a-f]{32,64}),\s*\d+,\s*\d+(?:,\s*[0-9a-f]{64})?(?:\s*;\s*[0-9a-f]{32,64},\s*\d+,\s*\d+(?:,\s*[0-9a-f]{64})?)*\)",
    re.IGNORECASE,
)
IDEOLOGY_MARKERS = ("진보", "보수", "좌파", "우파", "좌편향", "우편향", "우익", "좌익")
INTERNAL_PUBLIC_MARKERS = (
    "effectiveness_positive",
    "effectiveness_negative",
    "government",
    "strengthen_policy",
    "weaken_policy",
    "individual_actor",
    "shared_responsibility",
)
FORBIDDEN_PUBLIC_KEYS = frozenset(
    {"body_text", "raw_body", "sentence_text", "full_article", "prompt_payload", "html"}
)
CLAIM_STATUSES = (
    "observed",
    "explicit_not_stated",
    "insufficient_evidence",
    "analysis_failed",
    "review_needed",
)
FRAME_FUNCTIONS = (
    "problem_definition",
    "causal_interpretation",
    "responsibility_attribution",
    "evaluation",
    "treatment_recommendation",
)


class EventSynthesizer(Protocol):
    def synthesize(self, request: Mapping[str, Any]) -> Mapping[str, Any]: ...


class EventSynthesisError(ValueError):
    """A synthesis draft cannot be published."""


def evidence_index(profiles: Sequence[Mapping[str, Any]]) -> dict[tuple[Any, ...], dict[str, Any]]:
    """Index locator+hash evidence already present on article profiles."""

    found: dict[tuple[Any, ...], dict[str, Any]] = {}
    for entry in profiles:
        article_id = str(entry.get("articleId") or "")
        rows = entry.get("evidence")
        if not article_id or not isinstance(rows, Sequence) or isinstance(rows, (str, bytes)):
            continue
        for row in rows:
            if not isinstance(row, Mapping):
                continue
            locator = row.get("locator")
            digest = row.get("sentenceSha256") or row.get("sentence_sha256")
            if not isinstance(locator, Mapping) or not isinstance(digest, str):
                continue
            if not SHA256_PATTERN.fullmatch(digest):
                continue
            paragraph = locator.get("paragraph")
            sentence = locator.get("sentence")
            if paragraph in (None, "") or sentence in (None, ""):
                continue
            key = (article_id, paragraph, sentence, digest.lower())
            found[key] = {
                "article_id": article_id,
                "locator": {"paragraph": paragraph, "sentence": sentence},
                "sentence_sha256": digest.lower(),
            }
    return found


def _clean_text(value: object, *, limit: int = 280) -> str:
    if not isinstance(value, str):
        return ""
    text = INLINE_EVIDENCE_PATTERN.sub("", value)
    text = " ".join(text.split())
    return text[:limit]


def _contains_ideology(text: str) -> bool:
    return any(marker in text for marker in IDEOLOGY_MARKERS)


def _contains_internal_marker(text: str) -> bool:
    return any(marker in text for marker in INTERNAL_PUBLIC_MARKERS)


def _contains_forbidden_key(value: object) -> bool:
    if isinstance(value, Mapping):
        return any(
            str(key).lower() in FORBIDDEN_PUBLIC_KEYS or _contains_forbidden_key(child)
            for key, child in value.items()
        )
    if isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray)):
        return any(_contains_forbidden_key(child) for child in value)
    return False


def _bind_evidence(
    raw_evidence: object,
    index: Mapping[tuple[Any, ...], dict[str, Any]],
    *,
    allowed_article_ids: set[str] | None = None,
) -> list[dict[str, Any]]:
    if not isinstance(raw_evidence, Sequence) or isinstance(raw_evidence, (str, bytes)):
        return []
    kept: list[dict[str, Any]] = []
    seen: set[tuple[Any, ...]] = set()
    for row in raw_evidence:
        if not isinstance(row, Mapping):
            continue
        article_id = str(row.get("article_id") or row.get("articleId") or "")
        if allowed_article_ids is not None and article_id not in allowed_article_ids:
            continue
        locator = row.get("locator")
        digest = str(row.get("sentence_sha256") or row.get("sentenceSha256") or "")
        if (
            not article_id
            or not isinstance(locator, Mapping)
            or not SHA256_PATTERN.fullmatch(digest)
        ):
            continue
        key = (article_id, locator.get("paragraph"), locator.get("sentence"), digest.lower())
        bound = index.get(key)
        if bound is None or key in seen:
            continue
        seen.add(key)
        kept.append(dict(bound))
    return kept


def _bound_claim(
    text: object,
    evidence: object,
    index: Mapping[tuple[Any, ...], dict[str, Any]],
    *,
    allowed_article_ids: set[str] | None = None,
    status: object = None,
) -> dict[str, Any] | None:
    # Model comparison prose often ends with several inline evidence locators.
    # Keep enough room for the cited sentence instead of cutting a locator in half.
    cleaned = _clean_text(text, limit=560)
    declared = str(status or "").strip()
    if declared in {"explicit_not_stated", "analysis_failed", "review_needed"} and not cleaned:
        return {
            "text": None,
            "status": declared,
            "evidence": [],
        }
    bound = _bind_evidence(evidence, index, allowed_article_ids=allowed_article_ids)
    if not cleaned:
        return None
    if _contains_ideology(cleaned):
        return {
            "text": None,
            "status": "review_needed",
            "evidence": bound,
            "reason": "이념·성향 라벨은 공개 비교문에 쓰지 않습니다.",
        }
    if _contains_internal_marker(cleaned):
        return {
            "text": None,
            "status": "review_needed",
            "evidence": bound,
            "reason": "내부 분류 코드는 공개 비교문에 쓰지 않습니다.",
        }
    if not bound:
        return {
            "text": None,
            "status": "insufficient_evidence",
            "evidence": [],
        }
    return {
        "text": cleaned,
        "status": "observed",
        "evidence": bound,
    }


def _article_map(articles: Sequence[Mapping[str, Any]]) -> dict[str, Mapping[str, Any]]:
    mapped: dict[str, Mapping[str, Any]] = {}
    for row in articles:
        article_id = str(row.get("articleId") or row.get("article_id") or "")
        if article_id:
            mapped[article_id] = row
    return mapped


def _bind_event_synthesis_legacy(
    draft: Mapping[str, Any],
    *,
    profiles: Sequence[Mapping[str, Any]],
    articles: Sequence[Mapping[str, Any]],
) -> dict[str, Any]:
    """Keep only synthesis claims that cite existing public evidence."""

    if _contains_forbidden_key(draft):
        raise EventSynthesisError("synthesis draft contains a forbidden public field")
    index = evidence_index(profiles)
    article_ids = {str(row.get("articleId") or row.get("article_id") or "") for row in articles}
    article_ids.discard("")
    by_id = _article_map(articles)

    what_happened = _bound_claim(
        draft.get("what_happened") or draft.get("whatHappened"),
        draft.get("what_happened_evidence") or draft.get("event_evidence"),
        index,
    )
    agreed = _bound_claim(
        draft.get("agreed_line") or draft.get("agreedLine"), draft.get("agreed_evidence"), index
    )
    split = _bound_claim(
        draft.get("split_line") or draft.get("splitLine"), draft.get("split_evidence"), index
    )
    so_what = _bound_claim(
        draft.get("so_what") or draft.get("soWhat"), draft.get("so_what_evidence"), index
    )

    camps: list[dict[str, Any]] = []
    raw_camps = draft.get("camps")
    if isinstance(raw_camps, Sequence) and not isinstance(raw_camps, (str, bytes)):
        for raw in raw_camps[:4]:
            if not isinstance(raw, Mapping):
                continue
            camp_articles = [
                str(item)
                for item in (raw.get("article_ids") or raw.get("articleIds") or [])
                if str(item) in article_ids
            ]
            if not camp_articles:
                continue
            gist = _bound_claim(
                raw.get("gist") or raw.get("summary"),
                raw.get("evidence"),
                index,
                allowed_article_ids=set(camp_articles),
            )
            if gist is None or gist.get("status") != "observed" or not gist.get("text"):
                continue
            outlets = []
            for article_id in camp_articles:
                outlet = str(
                    by_id.get(article_id, {}).get("outlet")
                    or by_id.get(article_id, {}).get("sourceId")
                    or ""
                )
                if outlet and outlet not in outlets:
                    outlets.append(outlet)
            name = _clean_text(raw.get("name"), limit=40)
            if not name or _contains_ideology(name):
                name = f"관측 묶음 {len(camps) + 1}"
            camps.append(
                {
                    "name": name,
                    "gist": gist["text"],
                    "status": "observed",
                    "outlets": outlets,
                    "article_ids": camp_articles,
                    "evidence": gist["evidence"],
                    "index": len(camps),
                }
            )

    opposition = len(camps) >= 2
    if not opposition:
        if split and split.get("status") == "observed":
            split = {
                "text": None,
                "status": "explicit_not_stated",
                "evidence": [],
                "reason": "서로 다른 근거 그룹이 없어 대립 구도로 표시하지 않습니다.",
            }
        camps = []

    def _rows(raw_rows: object) -> list[dict[str, Any]]:
        if not isinstance(raw_rows, Sequence) or isinstance(raw_rows, (str, bytes)):
            return []
        rows: list[dict[str, Any]] = []
        for raw in raw_rows[:8]:
            if not isinstance(raw, Mapping):
                continue
            question = _clean_text(raw.get("question"), limit=80)
            if not question:
                continue
            common = _bound_claim(
                raw.get("common"), raw.get("evidence") or raw.get("common_evidence"), index
            )
            cells: list[dict[str, Any]] = []
            raw_cells = raw.get("cells")
            if isinstance(raw_cells, Sequence) and not isinstance(raw_cells, (str, bytes)):
                for cell in raw_cells[:4]:
                    if isinstance(cell, Mapping):
                        bound_cell = _bound_claim(
                            cell.get("text") or cell.get("value"), cell.get("evidence"), index
                        )
                    else:
                        bound_cell = _bound_claim(cell, raw.get("evidence"), index)
                    if bound_cell is not None:
                        cells.append(bound_cell)
            if common and common.get("status") == "observed":
                rows.append(
                    {
                        "question": question,
                        "common": common["text"],
                        "status": "observed",
                        "cells": None,
                        "evidence": common["evidence"],
                    }
                )
            elif opposition and any(
                cell.get("status") == "observed" and cell.get("text") for cell in cells
            ):
                rows.append(
                    {
                        "question": question,
                        "common": None,
                        "status": "observed",
                        "cells": [
                            cell.get("text") if cell.get("status") == "observed" else None
                            for cell in cells
                        ],
                        "cell_states": [cell.get("status") for cell in cells],
                        "evidence": [item for cell in cells for item in cell.get("evidence") or []],
                    }
                )
        return rows

    fact_rows = _rows(draft.get("fact_rows") or draft.get("factRows"))
    split_rows = _rows(draft.get("split_rows") or draft.get("splitRows")) if opposition else []

    terms: list[dict[str, Any]] = []
    raw_terms = draft.get("terms")
    if isinstance(raw_terms, Sequence) and not isinstance(raw_terms, (str, bytes)):
        for raw in raw_terms[:8]:
            if not isinstance(raw, Mapping):
                continue
            term = _clean_text(raw.get("term"), limit=40)
            gloss = _bound_claim(
                raw.get("gloss") or raw.get("explanation"), raw.get("evidence"), index
            )
            if term and not _contains_ideology(term) and not _contains_internal_marker(term) and gloss and gloss.get("status") == "observed":
                terms.append(
                    {
                        "term": term,
                        "gloss": gloss["text"],
                        "status": "observed",
                        "evidence": gloss["evidence"],
                    }
                )

    frame_functions: list[dict[str, Any]] = []
    raw_functions = draft.get("frame_functions") or draft.get("frameFunctions")
    if isinstance(raw_functions, Mapping):
        raw_function_rows = [
            {
                "dimension": name,
                **(raw_functions[name] if isinstance(raw_functions.get(name), Mapping) else {}),
            }
            for name in FRAME_FUNCTIONS
            if name in raw_functions
        ]
    elif isinstance(raw_functions, Sequence) and not isinstance(raw_functions, (str, bytes)):
        raw_function_rows = [row for row in raw_functions if isinstance(row, Mapping)]
    else:
        raw_function_rows = []
    for raw in raw_function_rows:
        dimension = str(raw.get("dimension") or "")
        if dimension not in FRAME_FUNCTIONS:
            continue
        claim = _bound_claim(raw.get("summary") or raw.get("text"), raw.get("evidence"), index)
        if claim is None:
            continue
        frame_functions.append(
            {
                "dimension": dimension,
                "summary": claim.get("text"),
                "status": claim["status"],
                "evidence": claim.get("evidence") or [],
            }
        )

    proof_rows: list[dict[str, Any]] = []
    raw_proof = draft.get("proof_rows") or draft.get("proofRows")
    if isinstance(raw_proof, Sequence) and not isinstance(raw_proof, (str, bytes)):
        for raw in raw_proof[:40]:
            if not isinstance(raw, Mapping):
                continue
            article_id = str(raw.get("article_id") or raw.get("articleId") or "")
            if article_id not in article_ids:
                continue
            claim = _bound_claim(
                raw.get("text") or raw.get("public_paraphrase"),
                raw.get("evidence"),
                index,
                allowed_article_ids={article_id},
            )
            if claim is None or claim.get("status") != "observed":
                continue
            proof_rows.append(
                {
                    "article_id": article_id,
                    "outlet": str(
                        by_id.get(article_id, {}).get("outlet")
                        or by_id.get(article_id, {}).get("sourceId")
                        or ""
                    ),
                    "dimension": str(raw.get("dimension") or ""),
                    "text": claim["text"],
                    "status": "observed",
                    "evidence": claim["evidence"],
                }
            )

    usable = bool(
        (what_happened and what_happened.get("status") == "observed")
        or (agreed and agreed.get("status") == "observed")
        or camps
        or fact_rows
    )
    return {
        "schemaVersion": SCHEMA_VERSION,
        "promptVersion": str(draft.get("prompt_version") or PROMPT_VERSION),
        "usable": usable,
        "opposition": opposition,
        "what_happened": what_happened,
        "agreed_line": agreed,
        "split_line": split,
        "so_what": so_what,
        "camps": camps,
        "terms": terms,
        "fact_rows": fact_rows,
        "split_rows": split_rows,
        "frame_functions": frame_functions,
        "proof_rows": proof_rows,
        **(
            {"invocation": dict(draft["_invocation"])}
            if isinstance(draft.get("_invocation"), Mapping)
            else {}
        ),
    }


def _claim_evidence(claim: object) -> list[dict[str, Any]]:
    if not isinstance(claim, Mapping):
        return []
    value = claim.get("evidence")
    return [dict(row) for row in value if isinstance(row, Mapping)] if isinstance(value, Sequence) and not isinstance(value, (str, bytes)) else []


def _merge_evidence(*claims: object) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    seen: set[tuple[Any, ...]] = set()
    for claim in claims:
        for row in _claim_evidence(claim):
            locator = row.get("locator") if isinstance(row.get("locator"), Mapping) else {}
            key = (
                row.get("article_id") or row.get("articleId"),
                locator.get("paragraph"),
                locator.get("sentence"),
                row.get("sentence_sha256") or row.get("sentenceSha256"),
            )
            if key in seen:
                continue
            seen.add(key)
            rows.append(row)
    return rows


def _v2_claim(
    value: object,
    fallback_evidence: object,
    index: Mapping[tuple[Any, ...], dict[str, Any]],
    *,
    allowed_article_ids: set[str] | None = None,
    limit: int = 560,
) -> dict[str, Any] | None:
    if isinstance(value, Mapping):
        text = value.get("text") or value.get("summary") or value.get("value")
        evidence = value.get("evidence") or fallback_evidence
        status = value.get("status")
    else:
        text = value
        evidence = fallback_evidence
        status = None
    return _bound_claim(
        text,
        evidence,
        index,
        allowed_article_ids=allowed_article_ids,
        status=status,
    ) if limit == 560 else _bound_claim_with_limit(
        text,
        evidence,
        index,
        allowed_article_ids=allowed_article_ids,
        status=status,
        limit=limit,
    )


def _bound_claim_with_limit(
    text: object,
    evidence: object,
    index: Mapping[tuple[Any, ...], dict[str, Any]],
    *,
    allowed_article_ids: set[str] | None = None,
    status: object = None,
    limit: int = 560,
) -> dict[str, Any] | None:
    cleaned = _clean_text(text, limit=limit)
    declared = str(status or "").strip()
    if declared in {"explicit_not_stated", "analysis_failed", "review_needed"} and not cleaned:
        return {"text": None, "status": declared, "evidence": []}
    bound = _bind_evidence(evidence, index, allowed_article_ids=allowed_article_ids)
    if not cleaned:
        return None
    if _contains_ideology(cleaned):
        return {"text": None, "status": "review_needed", "evidence": bound, "reason": "이념·성향 라벨은 공개 비교문에 쓰지 않습니다."}
    if _contains_internal_marker(cleaned):
        return {"text": None, "status": "review_needed", "evidence": bound, "reason": "내부 분류 코드는 공개 비교문에 쓰지 않습니다."}
    if not bound:
        return {"text": None, "status": "insufficient_evidence", "evidence": []}
    return {"text": cleaned, "status": "observed", "evidence": bound}


def _bind_event_synthesis_v2(
    draft: Mapping[str, Any],
    *,
    profiles: Sequence[Mapping[str, Any]],
    articles: Sequence[Mapping[str, Any]],
    legacy_mode: bool = False,
) -> dict[str, Any]:
    """Bind the v2 event contract while accepting the released v1 draft shape."""

    if _contains_forbidden_key(draft):
        raise EventSynthesisError("synthesis draft contains a forbidden public field")
    index = evidence_index(profiles)
    article_ids = {str(row.get("articleId") or row.get("article_id") or "") for row in articles}
    article_ids.discard("")
    by_id = _article_map(articles)

    raw_paragraphs = draft.get("event_paragraphs") or draft.get("eventParagraphs")
    if isinstance(raw_paragraphs, Sequence) and not isinstance(raw_paragraphs, (str, bytes)):
        event_paragraphs = []
        for raw in raw_paragraphs[:4]:
            claim = _v2_claim(raw, draft.get("event_paragraph_evidence") or draft.get("what_happened_evidence"), index, limit=720)
            if claim and claim.get("status") == "observed":
                event_paragraphs.append(claim)
    else:
        fallback = _v2_claim(
            draft.get("what_happened") or draft.get("whatHappened"),
            draft.get("what_happened_evidence") or draft.get("event_evidence"),
            index,
            limit=720,
        )
        event_paragraphs = [fallback] if fallback and (fallback.get("status") == "observed" or legacy_mode) else []

    raw_common = draft.get("common_ground") or draft.get("commonGround")
    common_ground = _v2_claim(
        raw_common or draft.get("agreed_line") or draft.get("agreedLine"),
        (raw_common.get("evidence") if isinstance(raw_common, Mapping) else None)
        or draft.get("common_ground_evidence")
        or draft.get("agreed_evidence"),
        index,
        limit=720,
    )

    raw_axis = draft.get("comparison_axis") or draft.get("comparisonAxis")
    axis: dict[str, Any] | None = None
    if isinstance(raw_axis, Mapping):
        axis_evidence = raw_axis.get("evidence") or draft.get("split_evidence")
        label = _v2_claim(raw_axis.get("label"), axis_evidence, index, limit=120)
        question = _v2_claim(raw_axis.get("question"), axis_evidence, index, limit=320)
        points: list[dict[str, Any]] = []
        raw_points = raw_axis.get("points")
        if isinstance(raw_points, Sequence) and not isinstance(raw_points, (str, bytes)):
            for raw_point in raw_points[:4]:
                point = _v2_claim(raw_point, axis_evidence, index, limit=160)
                if point and point.get("status") == "observed":
                    points.append(point)
        axis_evidence_bound = _merge_evidence(label, question, *points)
        if label and question and label.get("status") == "observed" and question.get("status") == "observed" and len(points) >= 2:
            axis = {
                "label": label["text"],
                "points": [{"text": point["text"], "status": "observed", "evidence": point["evidence"]} for point in points],
                "question": question["text"],
                "evidence": axis_evidence_bound,
            }

    raw_camps = draft.get("camps")
    camps: list[dict[str, Any]] = []
    if isinstance(raw_camps, Sequence) and not isinstance(raw_camps, (str, bytes)):
        for raw in raw_camps[:4]:
            if not isinstance(raw, Mapping):
                continue
            camp_articles = [
                str(item)
                for item in (raw.get("article_ids") or raw.get("articleIds") or [])
                if str(item) in article_ids
            ]
            if not camp_articles:
                continue
            allowed = set(camp_articles)
            fallback_evidence = raw.get("evidence")
            name = _clean_text(raw.get("name"), limit=60)
            if _contains_ideology(name) or _contains_internal_marker(name):
                continue
            headline = _v2_claim(raw.get("headline") or (name if legacy_mode else None), raw.get("headline_evidence") or fallback_evidence, index, allowed_article_ids=allowed, limit=180)
            summary = _v2_claim(raw.get("summary") or raw.get("gist"), raw.get("summary_evidence") or fallback_evidence, index, allowed_article_ids=allowed, limit=720)
            decisive = _v2_claim(
                raw.get("decisive_difference") or (f"다른 갈래보다 {name}에 초점을 맞춘 갈래입니다." if legacy_mode and name else None),
                raw.get("decisive_difference_evidence") or fallback_evidence,
                index,
                allowed_article_ids=allowed,
                limit=420,
            )
            if not name or not headline or not summary or not decisive:
                continue
            if any(item.get("status") != "observed" for item in (headline, summary, decisive)):
                continue

            raw_voice = raw.get("voice_basis") or raw.get("voiceBasis")
            if isinstance(raw_voice, Mapping):
                voice_kind = _clean_text(raw_voice.get("kind") or raw_voice.get("scope") or "not_observed", limit=40)
                voice_label = _clean_text(raw_voice.get("label") or raw_voice.get("text") or "발화 범위 미관측", limit=100)
                if _contains_ideology(voice_label) or _contains_internal_marker(voice_label):
                    voice_label = "발화 범위 미관측"
                voice_evidence = _bind_evidence(raw_voice.get("evidence") or fallback_evidence, index, allowed_article_ids=allowed)
            else:
                voice_kind = "not_observed"
                voice_label = "발화 범위 미관측"
                voice_evidence = []

            proof_rows: list[dict[str, Any]] = []
            raw_proof_rows = raw.get("proof_rows") or raw.get("proofRows")
            if not isinstance(raw_proof_rows, Sequence) or isinstance(raw_proof_rows, (str, bytes)):
                raw_proof_rows = []
            for proof in list(raw_proof_rows)[:12]:
                if not isinstance(proof, Mapping):
                    continue
                proof_article_id = str(proof.get("article_id") or proof.get("articleId") or "")
                if proof_article_id not in allowed:
                    continue
                paraphrase = _v2_claim(
                    proof.get("public_paraphrase") or proof.get("text"),
                    proof.get("evidence") or fallback_evidence,
                    index,
                    allowed_article_ids={proof_article_id},
                    limit=420,
                )
                if not paraphrase or paraphrase.get("status") != "observed":
                    continue
                dimension = _clean_text(proof.get("dimension"), limit=80) or "관측된 보도 선택"
                if _contains_ideology(dimension) or _contains_internal_marker(dimension):
                    dimension = "관측된 보도 선택"
                proof_rows.append(
                    {
                        "article_id": proof_article_id,
                        "outlet": str(by_id.get(proof_article_id, {}).get("outlet") or by_id.get(proof_article_id, {}).get("sourceId") or ""),
                        "dimension": dimension,
                        "public_paraphrase": paraphrase["text"],
                        "evidence": paraphrase["evidence"],
                    }
                )
            if not proof_rows and legacy_mode:
                for proof in draft.get("proof_rows") or []:
                    if not isinstance(proof, Mapping) or str(proof.get("article_id")) not in allowed:
                        continue
                    paraphrase = _v2_claim(proof.get("text") or proof.get("public_paraphrase"), proof.get("evidence"), index, allowed_article_ids={str(proof.get("article_id"))}, limit=420)
                    if paraphrase and paraphrase.get("status") == "observed":
                        article_id = str(proof.get("article_id"))
                        proof_rows.append({"article_id": article_id, "outlet": str(by_id.get(article_id, {}).get("outlet") or by_id.get(article_id, {}).get("sourceId") or ""), "dimension": _clean_text(proof.get("dimension"), limit=80) or "관측된 보도 선택", "public_paraphrase": paraphrase["text"], "evidence": paraphrase["evidence"]})

            camps.append(
                {
                    "name": name,
                    "headline": headline["text"],
                    "headline_evidence": headline["evidence"],
                    "summary": summary["text"],
                    "summary_evidence": summary["evidence"],
                    "gist": summary["text"],
                    "decisive_difference": decisive["text"],
                    "decisive_difference_evidence": decisive["evidence"],
                    "outlets": list(dict.fromkeys(str(by_id.get(article_id, {}).get("outlet") or by_id.get(article_id, {}).get("sourceId") or "") for article_id in camp_articles if by_id.get(article_id, {}).get("outlet") or by_id.get(article_id, {}).get("sourceId"))),
                    "article_ids": camp_articles,
                    "voice_basis": {"kind": voice_kind, "label": voice_label, "evidence": voice_evidence},
                    "evidence": _merge_evidence(headline, summary, decisive, {"evidence": voice_evidence}),
                    "proof_rows": proof_rows,
                    "index": len(camps),
                }
            )

    opposition = len(camps) >= 2
    if not opposition:
        camps = []
        if axis is not None:
            axis = None

    # Keep the detailed v1 projections available to existing readers, but make
    # the v2 fields the source of truth for the new comparison lead.
    legacy_draft = dict(draft)
    if event_paragraphs:
        legacy_draft["what_happened"] = event_paragraphs[0]["text"]
        legacy_draft["what_happened_evidence"] = event_paragraphs[0]["evidence"]
    if common_ground:
        legacy_draft["agreed_line"] = common_ground["text"]
        legacy_draft["agreed_evidence"] = common_ground["evidence"]
    if axis and axis.get("question"):
        legacy_draft["split_line"] = axis["question"]
        legacy_draft["split_evidence"] = axis["evidence"]
    legacy_draft["camps"] = [
        {
            "name": camp["name"],
            "gist": camp["summary"],
            "article_ids": camp["article_ids"],
            "evidence": camp["evidence"],
        }
        for camp in camps
    ]
    legacy = _bind_event_synthesis_legacy(legacy_draft, profiles=profiles, articles=articles)
    aggregate_proof = []
    for camp in camps:
        aggregate_proof.extend(camp.get("proof_rows") or [])
    if not aggregate_proof:
        aggregate_proof = legacy.get("proof_rows") or []
    split_claim = (
        {"text": axis["question"], "status": "observed", "evidence": axis["evidence"]}
        if axis
        else (legacy.get("split_line") if opposition and isinstance(legacy.get("split_line"), Mapping) else None)
    )
    if not split_claim or split_claim.get("status") != "observed":
        split_claim = {"text": None, "status": "explicit_not_stated", "evidence": [], "reason": "서로 다른 근거 그룹이 없어 대립 구도로 표시하지 않습니다."}
    return {
        "schemaVersion": SCHEMA_VERSION,
        "promptVersion": str(draft.get("prompt_version") or PROMPT_VERSION),
        "usable": bool(
            any(item.get("status") == "observed" for item in event_paragraphs)
            or (common_ground and common_ground.get("status") == "observed")
            or camps
        ),
        "opposition": opposition,
        "event_paragraphs": event_paragraphs,
        "terms": (legacy.get("terms") or [])[:4],
        "comparison_axis": axis,
        "common_ground": common_ground,
        "what_happened": event_paragraphs[0] if event_paragraphs else None,
        "agreed_line": common_ground,
        "split_line": split_claim,
        "so_what": {"text": None, "status": "explicit_not_stated", "evidence": [], "reason": "사건 종합에서는 취재원 맥락을 별도 해석으로 표시하지 않습니다."},
        "camps": camps,
        "fact_rows": legacy.get("fact_rows") or [],
        "split_rows": legacy.get("split_rows") or [],
        "frame_functions": legacy.get("frame_functions") or [],
        "proof_rows": aggregate_proof,
        **({"invocation": dict(draft["_invocation"])} if isinstance(draft.get("_invocation"), Mapping) else {}),
    }


def bind_event_synthesis(
    draft: Mapping[str, Any],
    *,
    profiles: Sequence[Mapping[str, Any]],
    articles: Sequence[Mapping[str, Any]],
) -> dict[str, Any]:
    """Bind v2 output; released v1 drafts are accepted and upgraded."""

    v2 = any(key in draft for key in ("event_paragraphs", "comparison_axis", "common_ground"))
    return _bind_event_synthesis_v2(draft, profiles=profiles, articles=articles, legacy_mode=not v2)


def _has_observed_evidence(value: object) -> bool:
    return (
        isinstance(value, Mapping)
        and value.get("status") == "observed"
        and isinstance(value.get("text"), str)
        and bool(value.get("text", "").strip())
        and isinstance(value.get("evidence"), Sequence)
        and bool(value.get("evidence"))
    )


def _v2_quality_ok(draft: Mapping[str, Any], bound: Mapping[str, Any]) -> bool:
    """Strict publish bar for a direct v2 Vertex result.

    Profile composition remains available for released legacy fixtures, but a
    live AI batch may only publish a complete v2 response with article-level
    evidence. This prevents a rules-only fallback from being labelled AI.
    """

    if str(draft.get("prompt_version") or "") != PROMPT_VERSION:
        return False
    if str(draft.get("schema_version") or "") != SCHEMA_VERSION:
        return False
    paragraphs = bound.get("event_paragraphs")
    terms = bound.get("terms")
    if not isinstance(paragraphs, Sequence) or not 2 <= len(paragraphs) <= 4:
        return False
    if not all(_has_observed_evidence(row) for row in paragraphs):
        return False
    if not isinstance(terms, Sequence) or not 1 <= len(terms) <= 4:
        return False
    if not all(
        isinstance(term, Mapping)
        and isinstance(term.get("term"), str)
        and isinstance(term.get("gloss"), str)
        and term.get("evidence")
        for term in terms
    ):
        return False
    if not _has_observed_evidence(bound.get("common_ground")):
        return False
    camps = bound.get("camps")
    if not isinstance(camps, Sequence) or len(camps) > 4:
        return False
    opposition = bool(bound.get("opposition"))
    if opposition != (len(camps) >= 2):
        return False
    if opposition:
        axis = bound.get("comparison_axis")
        if not isinstance(axis, Mapping) or not axis.get("label") or not axis.get("question"):
            return False
        points = axis.get("points")
        if not isinstance(points, Sequence) or not 2 <= len(points) <= 4:
            return False
        if not axis.get("evidence") or not all(_has_observed_evidence(point) for point in points):
            return False
        for camp in camps:
            if not isinstance(camp, Mapping):
                return False
            if not all(camp.get(field) for field in ("name", "headline", "summary", "decisive_difference")):
                return False
            if not all(camp.get(field) for field in ("evidence", "headline_evidence", "summary_evidence", "decisive_difference_evidence")):
                return False
            if not camp.get("article_ids") or not camp.get("proof_rows"):
                return False
            if not all(isinstance(row, Mapping) and row.get("article_id") and row.get("public_paraphrase") and row.get("evidence") for row in camp.get("proof_rows") or []):
                return False
    elif camps:
        return False
    return True


def _claim_text(claim: object) -> str | None:
    if isinstance(claim, Mapping) and claim.get("status") == "observed":
        value = claim.get("text")
        return value if isinstance(value, str) else None
    return None


def html_event_fields(bound: Mapping[str, Any]) -> dict[str, Any]:
    """Proto/HTML aliases so comparison.data can feed the example-page shape."""

    camps = []
    for camp in bound.get("camps") or []:
        if not isinstance(camp, Mapping):
            continue
        camps.append(
            {
                "name": camp.get("name"),
                "headline": camp.get("headline"),
                "headline_evidence": list(camp.get("headline_evidence") or []),
                "summary": camp.get("summary") or camp.get("gist"),
                "summary_evidence": list(camp.get("summary_evidence") or []),
                "gist": camp.get("gist"),
                "decisive_difference": camp.get("decisive_difference"),
                "decisive_difference_evidence": list(camp.get("decisive_difference_evidence") or []),
                "outlets": list(camp.get("outlets") or []),
                "article_ids": list(camp.get("article_ids") or []),
                "voice_basis": camp.get("voice_basis"),
                "evidence": list(camp.get("evidence") or []),
                "proof_rows": list(camp.get("proof_rows") or []),
                "index": camp.get("index"),
            }
        )
    fact_rows = []
    for row in bound.get("fact_rows") or []:
        if not isinstance(row, Mapping):
            continue
        fact_rows.append(
            {
                "question": row.get("question"),
                "common": row.get("common"),
                "cells": None,
            }
        )
    split_rows = []
    for row in bound.get("split_rows") or []:
        if not isinstance(row, Mapping):
            continue
        split_rows.append(
            {
                "question": row.get("question"),
                "common": None,
                "cells": list(row.get("cells") or []),
            }
        )
    terms = []
    for row in bound.get("terms") or []:
        if not isinstance(row, Mapping) or not row.get("term") or not row.get("gloss"):
            continue
        terms.append({"term": row.get("term"), "gloss": row.get("gloss")})
    return {
        "eventParagraphs": list(bound.get("event_paragraphs") or []),
        "comparisonAxis": bound.get("comparison_axis"),
        "commonGround": bound.get("common_ground"),
        "whatHappened": _claim_text(bound.get("what_happened")),
        "agreedLine": _claim_text(bound.get("agreed_line")),
        "splitLine": _claim_text(bound.get("split_line"))
        if bound.get("opposition")
        else "서로 다른 근거 그룹이 없어 대립 구도로 표시하지 않습니다.",
        "soWhat": _claim_text(bound.get("so_what")),
        "camps": camps,
        "factRows": fact_rows,
        "splitRows": split_rows,
        "terms": terms,
        "frameFunctions": list(bound.get("frame_functions") or []),
        "proofRows": list(bound.get("proof_rows") or []),
    }


def public_comparison_payload(
    bound: Mapping[str, Any], *, article_count: int, outlet_count: int
) -> dict[str, Any]:
    """Project a bound synthesis into the site comparison.data shape."""

    split_text = _claim_text(bound.get("split_line"))
    if not bound.get("opposition"):
        split_text = (
            "서로 다른 근거 그룹이 확인되지 않아 대립 구도로 표시하지 않고 공통 보도로 읽습니다."
        )
    payload = {
        "summary_30_seconds": {
            "sample": f"{article_count}건 · {outlet_count}개 매체",
            "common_ground": _claim_text(bound.get("common_ground") or bound.get("agreed_line")),
            "main_difference": split_text,
            "source_context": None,
            "limit": "기사 ID·locator·문장 해시가 연결된 관측만 표시합니다. 언론사 성향은 추론하지 않습니다.",
            "divergence_detected": bool(bound.get("opposition")),
        },
        "synthesis": bound,
    }
    payload.update(html_event_fields(bound))
    return payload


def build_bound_comparison(
    *,
    profiles: Sequence[Mapping[str, Any]],
    articles: Sequence[Mapping[str, Any]],
    title: str = "",
    issue_id: str = "",
    synthesizer: EventSynthesizer | None = None,
) -> dict[str, Any] | None:
    """Vertex draft first, then profile composition.  None if neither is usable."""

    if synthesizer is not None:
        request = synthesis_request(
            issue_id=issue_id,
            title=title,
            articles=articles,
            profiles=profiles,
        )
        vertex_config = getattr(getattr(synthesizer, "config", None), "vertex", None)
        max_attempts = max(1, min(int(getattr(vertex_config, "max_attempts", 1)), 3))
        for _attempt in range(max_attempts):
            try:
                draft = synthesizer.synthesize(request)
                bound = bind_event_synthesis(draft, profiles=profiles, articles=articles)
            except (TypeError, ValueError, KeyError):
                continue
            if bound.get("usable") and _v2_quality_ok(draft, bound):
                bound = dict(bound)
                bound["source"] = "gcp:event-synthesis"
                return bound
        # A live Vertex request must not silently become a profile-only,
        # rules-generated comparison. Raising here makes the batch abort before
        # it can write a partial or rules-only public snapshot.
        raise EventSynthesisError("direct event-synthesis v2 did not pass the evidence gate")
    try:
        bound = bind_event_synthesis(
            compose_event_synthesis(profiles=profiles, articles=articles, title=title),
            profiles=profiles,
            articles=articles,
        )
    except (TypeError, ValueError, KeyError):
        return None
    if not bound.get("usable"):
        return None
    bound = dict(bound)
    bound["source"] = "gcp:profile-event-composition"
    return bound


def synthesis_request(
    *,
    issue_id: str,
    title: str,
    articles: Sequence[Mapping[str, Any]],
    profiles: Sequence[Mapping[str, Any]],
) -> dict[str, Any]:
    """Build the body-free model input from public profiles only."""

    compact_profiles = []
    for entry in profiles:
        profile = entry.get("profile")
        if not isinstance(profile, Mapping):
            continue
        dimensions = profile.get("dimensions")
        items: list[dict[str, Any]] = []
        if isinstance(dimensions, Mapping):
            for name, node in dimensions.items():
                if not isinstance(node, Mapping):
                    continue
                for item in node.get("items") or []:
                    if not isinstance(item, Mapping):
                        continue
                    evidence = (
                        item.get("evidence") if isinstance(item.get("evidence"), Mapping) else {}
                    )
                    locator = evidence.get("locator") if isinstance(evidence, Mapping) else None
                    digest = None
                    if isinstance(evidence, Mapping):
                        digest = evidence.get("sentence_sha256") or evidence.get("sentenceSha256")
                    items.append(
                        {
                            "dimension": name,
                            "status": node.get("status") or node.get("model_status"),
                            "public_paraphrase": item.get("public_paraphrase"),
                            "frame_family": item.get("frame_family"),
                            "voice": (item.get("voice") or {}).get("kind")
                            if isinstance(item.get("voice"), Mapping)
                            else None,
                            "article_id": entry.get("articleId"),
                            "locator": locator,
                            "sentence_sha256": digest,
                        }
                    )
        compact_profiles.append(
            {
                "articleId": entry.get("articleId"),
                "items": items,
                "evidence": entry.get("evidence") or [],
            }
        )
    return {
        "prompt_version": PROMPT_VERSION,
        "schema_version": SCHEMA_VERSION,
        "issue_id": issue_id,
        "title": title,
        "articles": [
            {
                "articleId": row.get("articleId"),
                "outlet": row.get("outlet") or row.get("sourceId"),
                "title": row.get("title"),
                "canonicalUrl": row.get("canonicalUrl"),
            }
            for row in articles
        ],
        "profiles": compact_profiles,
    }


class VertexEventSynthesizer:
    """Issue-level Vertex call over public profiles only.

    Construction does not import the Google SDK.  Unit tests inject a fake
    ``client_factory`` or skip this class entirely.
    """

    def __init__(self, config: Any, *, client_factory: Any | None = None) -> None:
        self.config = config
        self.client_factory = client_factory

    def synthesize(self, request: Mapping[str, Any]) -> Mapping[str, Any]:
        prompt = _build_prompt(request)
        try:
            from google import genai
            from google.genai import types

            client = (
                self.client_factory(self.config)
                if self.client_factory is not None
                else genai.Client(
                    vertexai=True,
                    project=self.config.project_id,
                    location=self.config.vertex.location,
                )
            )
            response = client.models.generate_content(
                model=self.config.vertex.model,
                contents=prompt,
                config=types.GenerateContentConfig(
                    temperature=0,
                    max_output_tokens=int(self.config.vertex.max_output_tokens),
                    response_mime_type="application/json",
                    response_json_schema=_vertex_response_schema(),
                    thinking_config=(
                        types.ThinkingConfig(
                            thinking_budget=int(self.config.vertex.thinking_budget)
                        )
                        if self.config.vertex.model.startswith("gemini-2.5-pro")
                        else types.ThinkingConfig(
                            thinking_budget=int(self.config.vertex.thinking_budget)
                        )
                    ),
                ),
            )
            response_text = response.text
            payload = json.loads(response_text)
        except Exception:
            return {"prompt_version": PROMPT_VERSION, "usable": False}
        if not isinstance(payload, Mapping):
            return {"prompt_version": PROMPT_VERSION, "usable": False}
        return {
            **dict(payload),
            "_invocation": {
                "provider": "vertex_ai",
                "model": self.config.vertex.model,
                "prompt_version": PROMPT_VERSION,
                "attempt": 1,
                "request_sha256": hashlib.sha256(prompt.encode("utf-8")).hexdigest(),
                "response_sha256": hashlib.sha256(response_text.encode("utf-8")).hexdigest(),
                "response_id": getattr(response, "response_id", None)
                or getattr(response, "id", None),
                "completed_at": datetime.now(UTC).isoformat(),
            },
        }


def _vertex_response_schema() -> dict[str, Any]:
    evidence = {
        "type": "object",
        "properties": {
            "article_id": {"type": "string"},
            "locator": {
                "type": "object",
                "properties": {
                    "paragraph": {"type": "integer"},
                    "sentence": {"type": "integer"},
                },
                "required": ["paragraph", "sentence"],
            },
            "sentence_sha256": {"type": "string"},
        },
        "required": ["article_id", "locator", "sentence_sha256"],
    }
    return {
        "type": "object",
        "properties": {
            "prompt_version": {"type": "string", "enum": [PROMPT_VERSION]},
            "schema_version": {"type": "string", "enum": [SCHEMA_VERSION]},
            "event_paragraphs": {
                "type": "array",
                "minItems": 2,
                "maxItems": 4,
                "items": {"type": "object", "properties": {"text": {"type": "string"}, "evidence": {"type": "array", "items": evidence}}, "required": ["text", "evidence"]},
            },
            "terms": {
                "type": "array",
                "minItems": 1,
                "maxItems": 4,
                "items": {"type": "object", "properties": {"term": {"type": "string"}, "gloss": {"type": "string"}, "evidence": {"type": "array", "items": evidence}}, "required": ["term", "gloss", "evidence"]},
            },
            "comparison_axis": {
                "type": ["object", "null"],
                "properties": {
                    "label": {"type": "string"},
                    "points": {"type": "array", "minItems": 2, "maxItems": 4, "items": {"type": "object", "properties": {"text": {"type": "string"}, "evidence": {"type": "array", "items": evidence}}, "required": ["text", "evidence"]}},
                    "question": {"type": "string"},
                    "evidence": {"type": "array", "items": evidence},
                },
                "required": ["label", "points", "question", "evidence"],
            },
            "common_ground": {"type": "object", "properties": {"text": {"type": "string"}, "evidence": {"type": "array", "items": evidence}}, "required": ["text", "evidence"]},
            "camps": {
                "type": "array",
                "minItems": 0,
                "maxItems": 4,
                "items": {
                    "type": "object",
                    "properties": {
                        "name": {"type": "string"},
                        "headline": {"type": "string"},
                        "summary": {"type": "string"},
                        "decisive_difference": {"type": "string"},
                        "article_ids": {"type": "array", "items": {"type": "string"}},
                        "voice_basis": {"type": "object", "properties": {"kind": {"type": "string"}, "label": {"type": "string"}, "evidence": {"type": "array", "items": evidence}}, "required": ["kind", "label", "evidence"]},
                        "evidence": {"type": "array", "items": evidence},
                        "headline_evidence": {"type": "array", "items": evidence},
                        "summary_evidence": {"type": "array", "items": evidence},
                        "decisive_difference_evidence": {"type": "array", "items": evidence},
                        "proof_rows": {"type": "array", "items": {"type": "object", "properties": {"article_id": {"type": "string"}, "outlet": {"type": "string"}, "dimension": {"type": "string"}, "public_paraphrase": {"type": "string"}, "evidence": {"type": "array", "items": evidence}}, "required": ["article_id", "dimension", "public_paraphrase", "evidence"]}},
                    },
                    "required": ["name", "headline", "summary", "decisive_difference", "article_ids", "voice_basis", "evidence", "headline_evidence", "summary_evidence", "decisive_difference_evidence", "proof_rows"],
                },
            },
            "fact_rows": {"type": "array"},
            "split_rows": {"type": "array"},
            "frame_functions": {"type": "array"},
            "proof_rows": {"type": "array"},
        },
        "required": [
            "prompt_version",
            "schema_version",
            "event_paragraphs",
            "terms",
            "comparison_axis",
            "common_ground",
            "camps",
        ],
    }


def _build_prompt(request: Mapping[str, Any]) -> str:
    payload = json.dumps(request, ensure_ascii=False, sort_keys=True)
    return (
        "You are producing event-synthesis-v2.0.0 for one Korean news event from already-coded article profiles. "
        "The input contains article titles, outlet names, public paraphrases, voice kind, frame families, and evidence locators; it never contains article bodies. "
        "Write natural Korean that describes observable editorial choices, never hidden outlet intent or fixed political ideology. "
        "Create 2-4 event_paragraphs: first the event, then only evidence-supported chronology or context. Create 1-4 terms with simple glosses. "
        "Create comparison_axis only when at least two distinct evidence groups exist: a short label, 2-4 natural-language points, and the concrete question that separates the coverage. "
        "Create common_ground from the whole or majority of articles. Use 모두 only when every article supports it, 대부분 for 70% or more, and 일부 below that; name a single outlet when only one outlet supports a point. "
        "Create 0 camps when no real opposition is observed; otherwise create 2-4 camps. Every camp must have name, strong headline, 2-3 sentence summary, decisive_difference, article_ids, voice_basis, evidence, and proof_rows. "
        "Keep journalist narration separate from source-attributed speech: write '매체가 평가했다' only when the profile voice is journalist_narration; otherwise write that the outlet placed a source's statement in the title, lead, or body. "
        "Every public sentence and every camp field must cite article_id, locator.paragraph, locator.sentence, and sentence_sha256 copied from the supplied profiles. Do not put locator tuples or hashes inline in prose; put them only in evidence arrays. "
        "proof_rows must contain article_id, outlet, dimension, public_paraphrase, and evidence, and must be drawn from the supplied paraphrases. "
        "Do not copy article body text, HTML, raw sentences, or English internal codes. Do not output so_what or source-context interpretation. "
        "Return only JSON matching the v2 schema. If a field cannot be supported, use an empty array or null rather than inventing text. "
        f"Input: {payload}"
    )


CAMP_LABELS = {
    "legal_institutional": "제도 안전장치 약화를 앞세운 쪽",
    "no_treatment": "구체적 대응보다 경고를 전한 쪽",
    "institutional_check": "대통령의 침묵과 거부권 요구를 앞세운 쪽",
    "investigation_accountability": "수사와 책임 추궁을 앞세운 쪽",
}
CAMP_SPLIT_CLAUSES = {
    "institutional_check": "대통령의 침묵과 정치적 책임을 앞세웠",
    "legal_institutional": "제도적 안전장치 약화를 앞세웠",
    "no_treatment": "구체적 대응보다 경고를 전했",
    "investigation_accountability": "수사와 책임 추궁을 앞세웠",
}


def _item_evidence(article_id: str, item: Mapping[str, Any]) -> dict[str, Any] | None:
    evidence = item.get("evidence")
    if not isinstance(evidence, Mapping):
        return None
    locator = evidence.get("locator")
    digest = evidence.get("sentence_sha256") or evidence.get("sentenceSha256")
    if not isinstance(locator, Mapping) or not isinstance(digest, str):
        return None
    if not SHA256_PATTERN.fullmatch(digest):
        return None
    if locator.get("paragraph") in (None, "") or locator.get("sentence") in (None, ""):
        return None
    return {
        "article_id": article_id,
        "locator": {"paragraph": locator.get("paragraph"), "sentence": locator.get("sentence")},
        "sentence_sha256": digest.lower(),
    }


def _first_observed_item(
    profile: Mapping[str, Any], dimension: str
) -> tuple[dict[str, Any], dict[str, Any]] | None:
    node = (profile.get("dimensions") or {}).get(dimension)
    if not isinstance(node, Mapping):
        return None
    items = node.get("items")
    if not isinstance(items, Sequence) or isinstance(items, (str, bytes)):
        return None
    for item in items:
        if isinstance(item, Mapping) and item.get("public_paraphrase"):
            return dict(item), dict(node)
    return None


def _camp_key(profile: Mapping[str, Any]) -> str:
    problem = _first_observed_item(profile, "problem_definition")
    treatment = _first_observed_item(profile, "treatment_recommendation")
    problem_family = ""
    if problem:
        problem_family = str(problem[0].get("frame_family") or "")
    if problem_family == "legal_institutional":
        return "legal_institutional"
    if treatment is None:
        return "no_treatment"
    treatment_family = str(treatment[0].get("frame_family") or "")
    if treatment_family == "institutional_check":
        return "institutional_check"
    return treatment_family or problem_family or "other"


def compose_event_synthesis(
    *,
    profiles: Sequence[Mapping[str, Any]],
    articles: Sequence[Mapping[str, Any]],
    title: str = "",
) -> dict[str, Any]:
    """Build an evidence-citing draft from already-coded public profiles.

    This is not an ideology classifier.  It groups observed frame families and
    reuses the public paraphrases that already carry locator+hash evidence.
    Vertex can replace the wording later; uncited invented prose is never added.
    """

    by_id = _article_map(articles)
    coded: list[dict[str, Any]] = []
    for entry in profiles:
        article_id = str(entry.get("articleId") or "")
        profile = entry.get("profile")
        if not article_id or not isinstance(profile, Mapping):
            continue
        coded.append(
            {
                "articleId": article_id,
                "outlet": str(
                    by_id.get(article_id, {}).get("outlet")
                    or by_id.get(article_id, {}).get("sourceId")
                    or ""
                ),
                "profile": profile,
                "camp": _camp_key(profile),
            }
        )
    if not coded:
        return {"prompt_version": PROMPT_VERSION, "usable": False}

    def _rows_for(dimension: str) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        for row in coded:
            found = _first_observed_item(row["profile"], dimension)
            if not found:
                continue
            item, _node = found
            evidence = _item_evidence(row["articleId"], item)
            if evidence is None:
                continue
            rows.append(
                {
                    "article_id": row["articleId"],
                    "outlet": row["outlet"],
                    "text": _clean_text(item.get("public_paraphrase")),
                    "family": str(item.get("frame_family") or ""),
                    "voice": (item.get("voice") or {}).get("kind")
                    if isinstance(item.get("voice"), Mapping)
                    else None,
                    "evidence": evidence,
                }
            )
        return rows

    problems = _rows_for("problem_definition")
    causes = _rows_for("causal_interpretation")
    duties = _rows_for("responsibility_attribution")
    morals = _rows_for("moral_evaluation")
    remedies = _rows_for("treatment_recommendation")

    grouped: dict[str, list[dict[str, Any]]] = {}
    for row in coded:
        grouped.setdefault(row["camp"], []).append(row)

    camps = []
    for key, members in grouped.items():
        if key == "other" and len(grouped) > 1:
            continue
        gists = _rows_for("treatment_recommendation")
        if key == "no_treatment":
            gists = [
                item
                for item in problems
                if item["article_id"] in {row["articleId"] for row in members}
            ]
        elif key == "legal_institutional":
            gists = [
                item
                for item in problems
                if item["article_id"] in {row["articleId"] for row in members}
            ]
        else:
            gists = [
                item
                for item in remedies
                if item["article_id"] in {row["articleId"] for row in members}
            ]
            if not gists:
                gists = [
                    item
                    for item in problems
                    if item["article_id"] in {row["articleId"] for row in members}
                ]
        if not gists:
            continue
        lead = gists[0]
        camps.append(
            {
                "key": key,
                "name": CAMP_LABELS.get(key, "관측된 강조 묶음"),
                "gist": lead["text"],
                "article_ids": [row["articleId"] for row in members],
                "evidence": [lead["evidence"]],
            }
        )
    camps = camps[:4]

    agreed_bits = []
    agreed_evidence = []
    if causes and len({row["family"] for row in causes}) == 1:
        agreed_bits.append(causes[0]["text"])
        agreed_evidence.append(causes[0]["evidence"])
    if duties and len({row["family"] for row in duties}) == 1:
        agreed_bits.append(duties[0]["text"])
        agreed_evidence.append(duties[0]["evidence"])
    agreed_line = " ".join(agreed_bits) if agreed_bits else (causes[0]["text"] if causes else None)
    if agreed_line and not agreed_evidence and causes:
        agreed_evidence = [causes[0]["evidence"]]

    split_line = None
    split_evidence = []
    if len(camps) >= 2:
        clauses = [
            CAMP_SPLIT_CLAUSES.get(str(camp.get("key") or ""), "관측된 강조를 앞세웠")
            for camp in camps
        ]
        if len(clauses) == 2:
            split_line = f"한쪽은 {clauses[0]}고, 다른 쪽은 {clauses[1]}다."
        else:
            split_line = (
                f"한쪽은 {clauses[0]}고, 다른 쪽은 {clauses[1]}으며, 또 다른 쪽은 {clauses[2]}다."
            )
        split_evidence = [item for camp in camps for item in camp["evidence"]]

    what_evidence = [row["evidence"] for row in (problems or causes)[:4]]
    what_happened = title.strip() or (problems[0]["text"] if problems else None)
    if problems and title.strip():
        what_happened = f"{title.strip()}. {problems[0]['text']}"

    so_what = None
    so_evidence = []
    if len(camps) >= 2:
        so_what = "어느 기사 묶음을 먼저 읽느냐에 따라 이 사안이 정치 책임 문제로 보이는지, 제도 문제로 보이는지, 경고만 남는지가 달라진다."
        so_evidence = split_evidence

    fact_rows = []
    if causes and len({row["family"] for row in causes}) == 1:
        fact_rows.append(
            {
                "question": "왜 이렇게 됐다고 했나",
                "common": causes[0]["text"],
                "evidence": [causes[0]["evidence"]],
            }
        )
    if duties and len({row["family"] for row in duties}) == 1:
        fact_rows.append(
            {
                "question": "누구 책임이라고 했나",
                "common": duties[0]["text"],
                "evidence": [duties[0]["evidence"]],
            }
        )

    split_rows = []
    if len(camps) >= 2:
        problem_cells = []
        remedy_cells = []
        for camp in camps:
            member_ids = set(camp["article_ids"])
            problem = next((row for row in problems if row["article_id"] in member_ids), None)
            remedy = next((row for row in remedies if row["article_id"] in member_ids), None)
            problem_cells.append(
                {
                    "text": problem["text"] if problem else None,
                    "evidence": [problem["evidence"]] if problem else [],
                }
            )
            if remedy:
                remedy_cells.append({"text": remedy["text"], "evidence": [remedy["evidence"]]})
            else:
                remedy_cells.append(
                    {
                        "text": "기사에서 구체적 대응·해법이 명시되지 않음",
                        "evidence": camp["evidence"],
                    }
                )
        split_rows.append(
            {
                "question": "무엇이 문제라고 했나",
                "cells": problem_cells,
                "evidence": [item for cell in problem_cells for item in cell.get("evidence") or []],
            }
        )
        split_rows.append(
            {
                "question": "어떻게 하자고 했나",
                "cells": remedy_cells,
                "evidence": [item for cell in remedy_cells for item in cell.get("evidence") or []],
            }
        )

    frame_functions = []
    for dimension, rows in (
        ("problem_definition", problems),
        ("causal_interpretation", causes),
        ("responsibility_attribution", duties),
        ("evaluation", morals),
        ("treatment_recommendation", remedies),
    ):
        if not rows:
            continue
        families = {row["family"] for row in rows if row["family"]}
        if len(families) == 1:
            frame_functions.append(
                {
                    "dimension": dimension,
                    "summary": rows[0]["text"],
                    "evidence": [rows[0]["evidence"]],
                }
            )
        elif len(camps) >= 2:
            frame_functions.append(
                {
                    "dimension": dimension,
                    "summary": " / ".join(camp["gist"] for camp in camps[:3]),
                    "evidence": [item for camp in camps for item in camp["evidence"]],
                }
            )

    proof_rows = []
    for dimension, rows in (
        ("problem_definition", problems),
        ("causal_interpretation", causes),
        ("responsibility_attribution", duties),
        ("evaluation", morals),
        ("treatment_recommendation", remedies),
    ):
        for row in rows:
            proof_rows.append(
                {
                    "article_id": row["article_id"],
                    "dimension": dimension,
                    "text": row["text"],
                    "evidence": [row["evidence"]],
                }
            )

    return {
        "prompt_version": PROMPT_VERSION,
        "schema_version": SCHEMA_VERSION,
        "what_happened": what_happened,
        "what_happened_evidence": what_evidence,
        "agreed_line": agreed_line,
        "agreed_evidence": agreed_evidence,
        "split_line": split_line,
        "split_evidence": split_evidence,
        "so_what": so_what,
        "so_what_evidence": so_evidence,
        "camps": camps,
        "fact_rows": fact_rows,
        "split_rows": split_rows,
        "frame_functions": frame_functions,
        "proof_rows": proof_rows,
        "terms": [],
    }


def source_lens_from_profiles(
    profiles: Sequence[Mapping[str, Any]],
    articles: Sequence[Mapping[str, Any]],
) -> dict[str, Any]:
    """Count observed source roles per outlet.  Visibility, not intent."""

    by_id = _article_map(articles)
    outlets: dict[str, dict[str, Any]] = {}
    for entry in profiles:
        article_id = str(entry.get("articleId") or "")
        profile = entry.get("profile")
        if not article_id or not isinstance(profile, Mapping):
            continue
        outlet = str(
            by_id.get(article_id, {}).get("outlet")
            or by_id.get(article_id, {}).get("sourceId")
            or article_id
        )
        bucket = outlets.setdefault(outlet, {"outlet": outlet, "roles": {}})
        actors = profile.get("actors_and_sources")
        if not isinstance(actors, Sequence) or isinstance(actors, (str, bytes)):
            continue
        for actor in actors:
            if not isinstance(actor, Mapping):
                continue
            role = str(actor.get("role_label") or actor.get("role") or "미분류")
            count = int(actor.get("direct_quote_count") or 0) + int(
                actor.get("indirect_attribution_count") or 0
            )
            if count <= 0:
                count = 1
            current = bucket["roles"].setdefault(
                role, {"role": actor.get("role"), "role_label": role, "count": 0}
            )
            current["count"] += count
    return {
        "by_outlet": [
            {
                "outlet": row["outlet"],
                "roles": sorted(
                    row["roles"].values(), key=lambda item: (-item["count"], item["role_label"])
                ),
            }
            for row in outlets.values()
        ],
        "caution": "취재원 구성은 발화 가시성의 관측이지 매체의 의도 판정이 아닙니다.",
    }


__all__ = [
    "LEGACY_PROMPT_VERSION",
    "LEGACY_SCHEMA_VERSION",
    "PROMPT_VERSION",
    "SCHEMA_VERSION",
    "EventSynthesisError",
    "EventSynthesizer",
    "VertexEventSynthesizer",
    "bind_event_synthesis",
    "build_bound_comparison",
    "compose_event_synthesis",
    "evidence_index",
    "html_event_fields",
    "public_comparison_payload",
    "source_lens_from_profiles",
    "synthesis_request",
]
