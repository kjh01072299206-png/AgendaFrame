from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from typing import Any
from urllib.request import Request, urlopen

from ai.framing import FRAME_DIMENSIONS, FrameResult, validate_frame_result
from backend.analysis_state import AnalysisState
from crawler.models import ArticleDocument
from crawler.text import sentence_rows

PUBLIC_PROFILE_SCHEMA = "agendaframe.article-frame-profile.v2"
COMPARISON_ENGINE_VERSION = "korean-evidence-rules-v2"
DIMENSION_MAP = {
    "problem_definition": "problem_definition",
    "causal_attribution": "causal_interpretation",
    "responsibility_attribution": "responsibility_attribution",
    "evaluation": "moral_evaluation",
    "treatment_recommendation": "treatment_recommendation",
}
ROLE_LABELS = {
    "government_official": "정부·공공기관",
    "political_actor": "정당·정치권",
    "judiciary_law_enforcement": "법조·수사기관",
    "expert_research": "전문가·연구자",
    "civil_society": "시민사회·이익집단",
    "business": "기업·산업계",
    "affected_person": "당사자·시민",
    "anonymous_official": "익명·비실명 관계자",
    "other": "기타 취재원",
}


def _sha256(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _semantic_variant_key(dimension: str, value: str, frame_family: str | None) -> str:
    if frame_family:
        return f"semantic:{dimension}:family:{frame_family}"
    normalized = unicodedata.normalize("NFKC", value).casefold()
    normalized = re.sub(r"[^\w]+", " ", normalized, flags=re.UNICODE)
    normalized = " ".join(normalized.split())
    if not normalized:
        raise ValueError("A semantic frame value must contain meaningful text.")
    return f"semantic:{dimension}:{_sha256(normalized)}"


def _claim_id(
    article_id: str,
    dimension: str,
    variant_key: str,
    voice_kind: str,
) -> str:
    material = f"agendaframe:claim:v1:{article_id}:{dimension}:{variant_key}:{voice_kind}"
    return f"claim:{_sha256(material)}"


def _sentences(body: str) -> list[dict[str, Any]]:
    return sentence_rows(body)


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


def _public_context_evidence(
    article: ArticleDocument,
    body: str,
    spans: Any,
    sentences: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    if not isinstance(spans, list):
        return []
    return [
        _evidence_locator(article.article_id, body, span, sentences)
        for span in spans
        if isinstance(span, dict)
    ]


def public_profile(article: ArticleDocument, result: FrameResult) -> dict[str, Any]:
    validate_frame_result(article, result)
    body = article.body_text or ""
    if not body or not article.body_hash:
        raise ValueError("A verified article body is required to publish an analyzed profile.")
    sentence_rows = _sentences(body)
    analyzed_character_count = (
        result.analyzed_character_count
        if result.analyzed_character_count is not None
        else len(body)
    )
    input_truncated = (
        result.input_truncated
        if result.input_truncated is not None
        else analyzed_character_count < len(body)
    )
    text_scope = result.text_scope or article.text_scope
    dimensions_by_name = {str(dimension["dimension"]): dimension for dimension in result.dimensions}
    missing = FRAME_DIMENSIONS - dimensions_by_name.keys()
    if missing:
        raise ValueError(f"Missing frame dimensions: {', '.join(sorted(missing))}")

    semantic_ai_succeeded = (
        result.decision == "analyze"
        and result.fallback_reason is None
        and result.analysis_state in {None, AnalysisState.SUCCEEDED.value}
    )
    limitations = [
        "취재원 발언은 언론사의 서술이나 입장으로 자동 합산하지 않습니다.",
        "확인되지 않음은 분석 가능한 본문에서 직접 근거를 찾지 못했다는 뜻입니다.",
    ]
    if semantic_ai_succeeded:
        limitations.insert(0, "AI가 생성한 구조화 분석 초안이며 사람 검토 전 확정 판정이 아닙니다.")
    else:
        limitations.insert(
            0,
            "AI 호출 또는 근거 검증이 완료되지 않아 의미 분석을 보류했습니다. 사람 검토가 필요합니다.",
        )

    dimensions: dict[str, Any] = {}
    for source_name, public_name in DIMENSION_MAP.items():
        source = dimensions_by_name[source_name]
        if source["status"] == "explicit_not_stated":
            dimensions[public_name] = {
                "status": "not_observed",
                "model_status": "explicit_not_stated",
                "outlet_narration_observed": False,
                "items": [],
            }
            continue
        voice_kind = str(source["voice_kind"])
        frame_family = source.get("frame_family")
        variant_key = _semantic_variant_key(
            public_name,
            str(source["value"]),
            str(frame_family) if frame_family else None,
        )
        claim_id = _claim_id(
            article.article_id,
            public_name,
            variant_key,
            voice_kind,
        )
        dimensions[public_name] = {
            "status": ("observed" if voice_kind == "journalist_narration" else "source_attributed"),
            "model_status": str(source["status"]),
            "outlet_narration_observed": voice_kind == "journalist_narration",
            "items": [
                {
                    "claim_id": claim_id,
                    "code": f"semantic_{public_name}",
                    "frame_family": frame_family,
                    "variant_key": variant_key,
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

    actor_groups: dict[str, dict[str, Any]] = {}
    for actor in result.actors:
        role = str(actor["role"])
        current = actor_groups.setdefault(
            role,
            {
                "actor_id": f"actor:{_sha256(f'agendaframe:actor:v1:{article.article_id}:{role}')}",
                "role": role,
                "role_label": ROLE_LABELS[role],
                "direct_quote_count": 0,
                "indirect_attribution_count": 0,
                "evidence": [],
            },
        )
        evidence = [
            _evidence_locator(article.article_id, body, span, sentence_rows)
            for span in actor["evidence"]
        ]
        if actor["voice_kind"] == "direct_quote":
            current["direct_quote_count"] += len(evidence)
        else:
            current["indirect_attribution_count"] += len(evidence)
        known = {item["sentence_sha256"] for item in current["evidence"]}
        current["evidence"].extend(
            item for item in evidence if item["sentence_sha256"] not in known
        )

    actors_and_sources = sorted(actor_groups.values(), key=lambda item: item["role"])
    actor_source = dimensions_by_name["actor_visibility"]
    if not actors_and_sources and actor_source["status"] != "explicit_not_stated":
        evidence = [
            _evidence_locator(article.article_id, body, span, sentence_rows)
            for span in actor_source["evidence"]
        ]
        actors_and_sources.append(
            {
                "actor_id": f"actor:{_sha256(f'agendaframe:actor:v1:{article.article_id}:other')}",
                "role": "other",
                "role_label": ROLE_LABELS["other"],
                "direct_quote_count": (
                    len(evidence) if actor_source["voice_kind"] == "direct_quote" else 0
                ),
                "indirect_attribution_count": (
                    0 if actor_source["voice_kind"] == "direct_quote" else len(evidence)
                ),
                "evidence": evidence,
            }
        )

    raw_context = result.structured_context or {}
    structured_context: dict[str, Any] = {}
    for key in ("genre", "scope", "context_depth"):
        value = raw_context.get(key)
        if not isinstance(value, dict):
            continue
        structured_context[key] = {
            "code": value.get("code", "unknown"),
            "label": value.get("label"),
            "evidence": _public_context_evidence(article, body, value.get("evidence", []), sentence_rows),
            **({"reason": value["reason"]} if value.get("reason") else {}),
        }
        if key == "context_depth":
            structured_context[key]["level"] = value.get("code", "unknown")
    for source_key, public_key in (("generic_frames", "generic_frames"), ("policy_frames", "policy_frames"), ("framing_devices", "framing_devices")):
        rows = raw_context.get(source_key, [])
        if not isinstance(rows, list):
            continue
        public_rows: list[dict[str, Any]] = []
        for row in rows:
            if not isinstance(row, dict):
                continue
            public_row = {
                "code": row.get("code", "unknown"),
                "label": row.get("label"),
                "evidence": _public_context_evidence(article, body, row.get("evidence", []), sentence_rows),
            }
            if source_key == "framing_devices":
                public_row["appears_in_lead"] = bool(row.get("appears_in_lead", False))
            public_rows.append(public_row)
        structured_context[public_key] = public_rows

    return {
        "schema_version": PUBLIC_PROFILE_SCHEMA,
        "lineage": {
            "model_id": result.model_id,
            "prompt_version": result.prompt_version,
            "analysis_schema_version": PUBLIC_PROFILE_SCHEMA,
            "model_output_schema_version": result.schema_version,
            "comparison_engine_version": COMPARISON_ENGINE_VERSION,
            "approval": result.approval_lineage,
        },
        "engine": {
            "name": "AgendaFrame Vertex evidence coder",
            "version": result.model_id,
            "approach": (
                "semantic_evidence_bounded"
                if semantic_ai_succeeded
                else "semantic_evidence_bounded_fallback"
            ),
            "semantic_ai": semantic_ai_succeeded,
            "status": "semantic_draft" if semantic_ai_succeeded else "review_needed",
            "prompt_version": result.prompt_version,
            "analysis_schema_version": result.schema_version,
            "evidence_storage": "locator_and_salted_sha256_only",
            "limitations": limitations,
        },
        "article": {
            "article_id": article.article_id,
            # The site importer may assign a local database ID. Preserve the
            # upstream identity used to derive title and evidence fingerprints.
            "upstream_article_id": article.article_id,
            "published_at": article.published_at.isoformat(),
            "title_sha256": _sha256(f"agendaframe:title:v2:{article.article_id}:{article.title}"),
            "body_sha256": article.body_hash,
            "body_character_count": len(body),
            "body_word_count": len(body.split()),
            "paragraph_count": max((row["paragraph"] for row in sentence_rows), default=0),
            "sentence_count": len(sentence_rows),
            "raw_body_retained": False,
        },
        "extraction": {
            "text_scope": text_scope,
            "analyzed_character_count": analyzed_character_count,
            "input_truncated": input_truncated,
        },
        "genre": structured_context.get("genre", {"code": "unknown", "label": "자동 분류 안 함", "evidence": []}),
        "dimensions": dimensions,
        "actors_and_sources": actors_and_sources,
        "context_depth": structured_context.get("context_depth", {"level": "unknown"}),
        "scope": structured_context.get("scope", {"code": "unknown"}),
        "secondary_descriptors": {
            "generic_frames": structured_context.get("generic_frames", []),
            "policy_frames": structured_context.get("policy_frames", []),
            "controlled_associations": [],
        },
        "framing_devices": structured_context.get("framing_devices", []),
        "review": {
            "status": "automatic_draft",
            "analysis_decision": result.decision,
            "analysis_state": result.analysis_state,
            "attempt_count": result.attempt_count,
            "idempotency_fingerprint": result.idempotency_fingerprint,
            "error_code": result.error_code,
            "fallback_reason": result.fallback_reason,
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
        self.origin = origin.rstrip("/")
        self.import_url = f"{self.origin}{endpoint_path}"
        self.token = token

    def publish(self, rows: list[dict[str, object]]) -> dict[str, object]:
        return self._post(
            self.import_url,
            {"rows": rows},
            extra_headers={"x-agendaframe-source": "gcp-batch-v1"},
        )

    def analyze(
        self,
        target_date: str,
        *,
        approved_same_event_clusters: list[dict[str, object]] | None = None,
    ) -> dict[str, object]:
        payload: dict[str, object] = {"date": target_date}
        if approved_same_event_clusters:
            payload["approved_same_event_clusters"] = approved_same_event_clusters
        return self._post(f"{self.origin}/api/analyze", payload)

    def _post(
        self,
        url: str,
        payload: dict[str, object],
        *,
        extra_headers: dict[str, str] | None = None,
    ) -> dict[str, object]:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        headers = {
            "authorization": f"Bearer {self.token}",
            "content-type": "application/json",
            "user-agent": "AgendaFrame-GCP-Publisher/1.0",
        }
        headers.update(extra_headers or {})
        request = Request(
            url,
            data=body,
            method="POST",
            headers=headers,
        )
        with urlopen(request, timeout=30) as response:  # noqa: S310
            return json.loads(response.read().decode("utf-8"))
