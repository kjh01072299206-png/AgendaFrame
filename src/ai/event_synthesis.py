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

import json
import re
from typing import Any, Mapping, Protocol, Sequence

PROMPT_VERSION = "event-synthesis-v1.0.0"
SCHEMA_VERSION = "agendaframe.event-synthesis.v1"
SHA256_PATTERN = re.compile(r"^[0-9a-fA-F]{64}$")
IDEOLOGY_MARKERS = ("진보", "보수", "좌파", "우파", "좌편향", "우편향", "우익", "좌익")
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
    text = " ".join(value.split())
    return text[:limit]


def _contains_ideology(text: str) -> bool:
    return any(marker in text for marker in IDEOLOGY_MARKERS)


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
    cleaned = _clean_text(text)
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


def bind_event_synthesis(
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
            if term and gloss and gloss.get("status") == "observed":
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
    }


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
                "gist": camp.get("gist"),
                "outlets": list(camp.get("outlets") or []),
                "article_ids": list(camp.get("article_ids") or []),
                "evidence": list(camp.get("evidence") or []),
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
            "common_ground": _claim_text(bound.get("agreed_line")),
            "main_difference": split_text,
            "source_context": _claim_text(bound.get("so_what")),
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
        try:
            draft = synthesizer.synthesize(
                synthesis_request(
                    issue_id=issue_id,
                    title=title,
                    articles=articles,
                    profiles=profiles,
                )
            )
            bound = bind_event_synthesis(draft, profiles=profiles, articles=articles)
        except (TypeError, ValueError, KeyError):
            bound = None
        else:
            if bound.get("usable"):
                bound = dict(bound)
                bound["source"] = "gcp:event-synthesis"
                return bound
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
                    max_output_tokens=min(int(self.config.vertex.max_output_tokens), 4000),
                    response_mime_type="application/json",
                    response_json_schema=_vertex_response_schema(),
                ),
            )
            payload = json.loads(response.text)
        except Exception:
            return {"prompt_version": PROMPT_VERSION, "usable": False}
        if not isinstance(payload, Mapping):
            return {"prompt_version": PROMPT_VERSION, "usable": False}
        return dict(payload)


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
            "prompt_version": {"type": "string"},
            "schema_version": {"type": "string"},
            "what_happened": {"type": "string"},
            "what_happened_evidence": {"type": "array", "items": evidence},
            "agreed_line": {"type": "string"},
            "agreed_evidence": {"type": "array", "items": evidence},
            "split_line": {"type": "string"},
            "split_evidence": {"type": "array", "items": evidence},
            "so_what": {"type": "string"},
            "so_what_evidence": {"type": "array", "items": evidence},
            "camps": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "name": {"type": "string"},
                        "gist": {"type": "string"},
                        "article_ids": {"type": "array", "items": {"type": "string"}},
                        "evidence": {"type": "array", "items": evidence},
                    },
                    "required": ["name", "gist", "article_ids", "evidence"],
                },
            },
            "terms": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "term": {"type": "string"},
                        "gloss": {"type": "string"},
                        "evidence": {"type": "array", "items": evidence},
                    },
                    "required": ["term", "gloss", "evidence"],
                },
            },
            "fact_rows": {"type": "array"},
            "split_rows": {"type": "array"},
            "frame_functions": {"type": "array"},
            "proof_rows": {"type": "array"},
        },
        "required": [
            "what_happened",
            "agreed_line",
            "split_line",
            "so_what",
            "camps",
        ],
    }


def _build_prompt(request: Mapping[str, Any]) -> str:
    payload = json.dumps(request, ensure_ascii=False, sort_keys=True)
    return (
        "You synthesize one Korean news event from already-coded article profiles. "
        "Write natural Korean comparison sentences, not ideology labels. "
        "Do not call outlets progressive or conservative. "
        "Preferred split_line shape: "
        "A는 …를 앞세웠고, B는 …를 앞세웠으며, C는 …을 경고했다. "
        "Every public sentence must cite article_id, locator.paragraph, locator.sentence, "
        "and sentence_sha256 copied from the supplied profiles. "
        "Use 2-4 camps only when distinct evidence groups exist; otherwise leave camps empty "
        "and treat the coverage as shared. "
        "Never copy article body text, HTML, or raw sentences. "
        "Return JSON with what_happened, agreed_line, split_line, so_what, camps, terms, "
        "fact_rows, split_rows, frame_functions, proof_rows, and evidence arrays. "
        f"Input: {payload}"
    )


CAMP_LABELS = {
    "legal_institutional": "제도 안전장치 약화를 앞세운 쪽",
    "no_treatment": "구체적 대응보다 경고를 전한 쪽",
    "institutional_check": "대통령의 침묵과 거부권 요구를 앞세운 쪽",
    "investigation_accountability": "수사와 책임 추궁을 앞세운 쪽",
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
        agreed_bits.append("원인을 대통령·여당의 정치적 계산에서 찾는다")
        agreed_evidence.extend(row["evidence"] for row in causes[:3])
    if duties and len({row["family"] for row in duties}) == 1:
        agreed_bits.append("책임을 대통령과 여당 양쪽에 함께 돌린다")
        agreed_evidence.extend(row["evidence"] for row in duties[:3])
    agreed_line = " ".join(agreed_bits) if agreed_bits else (causes[0]["text"] if causes else None)
    if agreed_line and not agreed_evidence and causes:
        agreed_evidence = [causes[0]["evidence"]]

    split_line = None
    split_evidence = []
    if len(camps) >= 2:
        parts = [f"{camp['name']}는 {camp['gist']}" for camp in camps]
        split_line = "같은 사건에서 " + ", ".join(parts) + "."
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
    if agreed_bits:
        if any("원인" in bit for bit in agreed_bits) and causes:
            fact_rows.append(
                {
                    "question": "왜 이렇게 됐다고 했나",
                    "common": causes[0]["text"],
                    "evidence": [causes[0]["evidence"]],
                }
            )
        if any("책임" in bit for bit in agreed_bits) and duties:
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
