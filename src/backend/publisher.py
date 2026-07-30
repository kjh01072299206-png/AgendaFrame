from __future__ import annotations

import hashlib
import json
import re
from typing import Any
from urllib.request import Request, urlopen

from ai.framing import FRAME_DIMENSIONS, FrameResult
from crawler.models import ArticleDocument

PUBLIC_PROFILE_SCHEMA = "agendaframe.article-frame-profile.v2"
DIMENSION_MAP = {
    "problem_definition": "problem_definition",
    "causal_attribution": "causal_interpretation",
    "responsibility_attribution": "responsibility_attribution",
    "evaluation": "moral_evaluation",
    "treatment_recommendation": "treatment_recommendation",
}


def _sha256(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _sentences(body: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    cursor = 0
    paragraphs = re.split(r"\n\s*\n", body)
    for paragraph_number, paragraph in enumerate(paragraphs, start=1):
        paragraph_start = body.find(paragraph, cursor)
        cursor = paragraph_start + len(paragraph)
        sentence_cursor = paragraph_start
        parts = [part for part in re.split(r"(?<=[.!?。！？])\s+|\n+", paragraph) if part.strip()]
        for sentence_number, part in enumerate(parts, start=1):
            stripped = part.strip()
            start = body.find(stripped, sentence_cursor)
            if start < 0:
                continue
            end = start + len(stripped)
            sentence_cursor = end
            rows.append(
                {
                    "paragraph": paragraph_number,
                    "sentence": sentence_number,
                    "start": start,
                    "end": end,
                    "text": stripped,
                }
            )
    return rows


def _evidence_locator(
    article_id: str,
    body: str,
    span: dict[str, Any],
    sentences: list[dict[str, Any]],
) -> dict[str, Any]:
    start = int(span["start"])
    end = int(span["end"])
    sentence = next(
        (row for row in sentences if row["start"] <= start < row["end"] and end <= row["end"]),
        None,
    )
    if sentence is None:
        raise ValueError("Evidence must fit inside one locatable article sentence.")
    fingerprint = _sha256(
        "agendaframe:evidence:v2:"
        f"{article_id}:{sentence['paragraph']}:{sentence['sentence']}:{sentence['text']}"
    )
    return {
        "locator": {
            "paragraph": sentence["paragraph"],
            "sentence": sentence["sentence"],
        },
        "sentence_sha256": fingerprint,
    }


def public_profile(article: ArticleDocument, result: FrameResult) -> dict[str, Any]:
    body = article.body_text or ""
    if not body or not article.body_hash:
        raise ValueError("A verified article body is required to publish an analyzed profile.")
    sentence_rows = _sentences(body)
    dimensions_by_name = {str(dimension["dimension"]): dimension for dimension in result.dimensions}
    missing = FRAME_DIMENSIONS - dimensions_by_name.keys()
    if missing:
        raise ValueError(f"Missing frame dimensions: {', '.join(sorted(missing))}")

    dimensions: dict[str, Any] = {}
    for source_name, public_name in DIMENSION_MAP.items():
        source = dimensions_by_name[source_name]
        if source["status"] == "explicit_not_stated":
            dimensions[public_name] = {
                "status": "not_observed",
                "outlet_narration_observed": False,
                "items": [],
            }
            continue
        voice_kind = str(source["voice_kind"])
        dimensions[public_name] = {
            "status": ("observed" if voice_kind == "journalist_narration" else "source_attributed"),
            "outlet_narration_observed": voice_kind == "journalist_narration",
            "items": [
                {
                    "code": f"semantic_{source_name}",
                    "public_paraphrase": str(source["value"]),
                    "voice": {
                        "kind": voice_kind,
                        "speaker_role": None,
                    },
                    "evidence": _evidence_locator(
                        article.article_id,
                        body,
                        span,
                        sentence_rows,
                    ),
                }
                for span in source["evidence"]
            ],
        }

    actor_source = dimensions_by_name["actor_visibility"]
    actors_and_sources = []
    if actor_source["status"] != "explicit_not_stated":
        actors_and_sources.append(
            {
                "role": "other",
                "role_label": str(actor_source["value"]),
                "direct_quote_count": sum(
                    1
                    for _ in actor_source["evidence"]
                    if actor_source["voice_kind"] == "direct_quote"
                ),
                "indirect_attribution_count": sum(
                    1
                    for _ in actor_source["evidence"]
                    if actor_source["voice_kind"] != "direct_quote"
                ),
            }
        )

    return {
        "schema_version": PUBLIC_PROFILE_SCHEMA,
        "engine": {
            "name": "AgendaFrame Vertex evidence coder",
            "version": result.model_id,
            "approach": "semantic_evidence_bounded",
            "semantic_ai": True,
            "prompt_version": result.prompt_version,
            "analysis_schema_version": result.schema_version,
            "evidence_storage": "locator_and_salted_sha256_only",
            "limitations": [
                "AI가 생성한 구조화 분석 초안이며 사람 검토 전 확정 판정이 아닙니다.",
                "취재원 발언은 언론사의 서술이나 입장으로 자동 합산하지 않습니다.",
                "확인되지 않음은 분석 가능한 본문에서 직접 근거를 찾지 못했다는 뜻입니다.",
            ],
        },
        "article": {
            "article_id": article.article_id,
            "published_at": article.published_at.isoformat(),
            "title_sha256": _sha256(f"agendaframe:title:v2:{article.article_id}:{article.title}"),
            "body_sha256": article.body_hash,
            "body_character_count": len(body),
            "body_word_count": len(body.split()),
            "paragraph_count": max((row["paragraph"] for row in sentence_rows), default=0),
            "sentence_count": len(sentence_rows),
            "raw_body_retained": False,
        },
        "genre": {"code": "unknown", "label": "자동 분류 안 함", "evidence": []},
        "dimensions": dimensions,
        "actors_and_sources": actors_and_sources,
        "context_depth": {"level": "unknown"},
        "scope": {"code": "unknown"},
        "secondary_descriptors": {
            "generic_frames": [],
            "policy_frames": [],
            "controlled_associations": [],
        },
        "framing_devices": [],
        "review": {
            "status": "ai_draft",
            "requires_human_review": True,
            "publication_rule": "사람 검토 전에는 자동 분석 초안으로만 표시합니다.",
        },
    }


def publication_row(article: ArticleDocument, result: FrameResult) -> dict[str, object]:
    profile = public_profile(article, result)
    payload = {
        "article": {
            "article_id": article.article_id,
            "source_id": article.source_id,
            "canonical_url": article.canonical_url,
            "title": article.title,
            "published_at": article.published_at.isoformat(),
            "collected_at": article.collected_at.isoformat(),
            "section": article.section,
            "text_scope": article.text_scope,
            "body_hash": article.body_hash,
            "body_characters": len(article.body_text or ""),
        },
        "profile": profile,
    }
    serialized = json.dumps(payload, ensure_ascii=False)
    if article.body_text and article.body_text in serialized:
        raise ValueError("Article body must never be included in a publication payload.")
    return payload


class StructuredPublisher:
    def __init__(self, origin: str, endpoint_path: str, token: str) -> None:
        self.url = f"{origin.rstrip('/')}{endpoint_path}"
        self.token = token

    def publish(self, rows: list[dict[str, object]]) -> dict[str, object]:
        body = json.dumps({"rows": rows}, ensure_ascii=False).encode("utf-8")
        request = Request(
            self.url,
            data=body,
            method="POST",
            headers={
                "authorization": f"Bearer {self.token}",
                "content-type": "application/json",
                "user-agent": "AgendaFrame-GCP-Publisher/1.0",
                "x-agendaframe-source": "gcp-batch-v1",
            },
        )
        with urlopen(request, timeout=30) as response:  # noqa: S310
            return json.loads(response.read().decode("utf-8"))
