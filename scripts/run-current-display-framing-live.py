"""Analyze the articles visible in the current AgendaFrame public screen.

This is a one-shot, explicitly live, body-transient batch.  It reads the
current public Vercel manifest and its five issue payloads, fetches only those
article URLs, sends private bodies to Vertex for article coding, synthesizes
each issue from body-free public profiles, verifies every locator/hash before
writing the body-free site artifacts, and never serializes article bodies,
HTML, prompts, or raw model responses.

The current-display input is intentionally discovered at runtime.  No issue
title, article URL, or historical snapshot is hard-coded here.
"""

from __future__ import annotations

import argparse
import copy
import gzip
import hashlib
import json
import os
import re
import subprocess
import sys
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import replace
from datetime import UTC, date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Mapping, Sequence
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from ai.event_synthesis import (  # noqa: E402, I001
    PROMPT_VERSION as EVENT_PROMPT_VERSION,
    SCHEMA_VERSION as EVENT_SCHEMA_VERSION,
    VertexEventSynthesizer,
    build_bound_comparison,
    public_comparison_payload,
    source_lens_from_profiles,
)
from ai.framing import (  # noqa: E402
    FRAME_DIMENSIONS,
    FRAME_FAMILIES,
    SOURCE_ROLES,
    STRUCTURED_CONTEXT_CODES,
    FrameResult,
    _unsafe_public_value_reason,
    validate_frame_result,
)
from backend.analysis_state import AnalysisState, analysis_idempotency_fingerprint  # noqa: E402
from backend.config import RuntimeConfig  # noqa: E402
from backend.gcp_live_dependencies import (  # noqa: E402
    FetchedResponse,
    NewsArticleParser,
    UrlLibFeedFetcher,
)
from backend.publisher import public_profile  # noqa: E402
from crawler.models import ArticleDocument, canonicalize_url  # noqa: E402
from crawler.text import sentence_rows  # noqa: E402

DEFAULT_SCREEN_URL = "https://agendaframe-capstone.vercel.app/"
DEFAULT_CONFIG = ROOT / "config" / "gcp-runtime.yaml"
DEFAULT_OUTPUT_ROOT = ROOT / "site" / "public" / "initial-five"
DEFAULT_SUMMARY_ROOT = ROOT / "tmp" / "current-display-batch"
KST = timezone(timedelta(hours=9))
FORBIDDEN_PUBLIC_KEYS = frozenset(
    {
        "body_text",
        "bodytext",
        "raw_body",
        "rawbody",
        "html",
        "sentence_text",
        "sentencetext",
        "full_article",
        "fullarticle",
        "article_content",
        "articlecontent",
        "articlebody",
        "content",
        "full_content",
        "fullcontent",
        "raw_body_retained",
        "prompt_payload",
        "promptpayload",
        "evidence_text",
        "evidencetext",
    }
)
SHA256_PATTERN = re.compile(r"^[0-9a-fA-F]{64}$")
ANALYSIS_SCHEMA_VERSION = "agendaframe.article-frame-profile.v2"


class BatchError(RuntimeError):
    """The current-display batch cannot safely produce a public result."""


def utc_now() -> datetime:
    return datetime.now(UTC)


def parse_datetime(value: str | None) -> datetime:
    if not value:
        return utc_now()
    parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def request_bytes(url: str, *, timeout: float = 30.0, max_bytes: int = 2_000_000) -> bytes:
    request = Request(
        url,
        headers={
            "User-Agent": "AgendaFrameCurrentDisplayBatch/1.0 (+https://agendaframe-capstone.vercel.app)",
            "Accept": "application/json,text/html;q=0.9,*/*;q=0.1",
            "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.5",
        },
        method="GET",
    )
    with urlopen(request, timeout=timeout) as response:  # noqa: S310
        data = response.read(max_bytes + 1)
    if len(data) > max_bytes:
        raise BatchError(f"response exceeded {max_bytes} bytes: {url}")
    return data


def request_json(url: str) -> dict[str, Any]:
    try:
        payload = json.loads(request_bytes(url).decode("utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise BatchError(f"cannot read current-display JSON: {url}") from error
    if not isinstance(payload, dict):
        raise BatchError(f"current-display JSON must be an object: {url}")
    return payload


def public_json(payload: object) -> str:
    return json.dumps(payload, ensure_ascii=False, indent=2) + "\n"


def strip_private_flags(value: object) -> object:
    """Remove internal retention flags before a public profile is serialized."""

    if isinstance(value, Mapping):
        return {
            key: strip_private_flags(child)
            for key, child in value.items()
            if str(key).lower() != "raw_body_retained"
        }
    if isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray)):
        return [strip_private_flags(child) for child in value]
    return value


def atomic_write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(public_json(payload), encoding="utf-8")
    temporary.replace(path)


def contains_forbidden_key(value: object) -> bool:
    if isinstance(value, Mapping):
        return any(
            str(key).lower() in FORBIDDEN_PUBLIC_KEYS or contains_forbidden_key(child)
            for key, child in value.items()
        )
    if isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray)):
        return any(contains_forbidden_key(child) for child in value)
    return False


def collect_evidence(value: object, article_id: str) -> list[dict[str, Any]]:
    """Collect public locator/hash pairs without exposing any profile prose."""

    rows: list[dict[str, Any]] = []
    seen: set[tuple[Any, ...]] = set()

    def visit(node: object) -> None:
        if isinstance(node, Mapping):
            locator = node.get("locator")
            digest = node.get("sentence_sha256") or node.get("sentenceSha256")
            if isinstance(locator, Mapping) and isinstance(digest, str) and SHA256_PATTERN.fullmatch(digest):
                paragraph = locator.get("paragraph")
                sentence = locator.get("sentence")
                if paragraph is not None and sentence is not None:
                    key = (article_id, paragraph, sentence, digest.lower())
                    if key not in seen:
                        seen.add(key)
                        rows.append(
                            {
                                "articleId": article_id,
                                "locator": {"paragraph": paragraph, "sentence": sentence},
                                "sentenceSha256": digest.lower(),
                            }
                        )
            for child in node.values():
                visit(child)
        elif isinstance(node, Sequence) and not isinstance(node, (str, bytes, bytearray)):
            for child in node:
                visit(child)

    visit(value)
    return rows


def body_evidence_index(article: ArticleDocument) -> set[tuple[int, int, str]]:
    """Rebuild the exact public evidence fingerprint from the private body."""

    body = article.body_text or ""
    result: set[tuple[int, int, str]] = set()
    for row in sentence_rows(body):
        digest = hashlib.sha256(
            "agendaframe:evidence:v2:"
            f"{article.article_id}:{row['paragraph']}:{row['sentence']}:{row['text']}".encode("utf-8")
        ).hexdigest()
        result.add((int(row["paragraph"]), int(row["sentence"]), digest))
    return result


def evidence_key(row: Mapping[str, Any]) -> tuple[Any, ...] | None:
    locator = row.get("locator")
    digest = row.get("sentenceSha256") or row.get("sentence_sha256")
    if not isinstance(locator, Mapping) or not isinstance(digest, str):
        return None
    paragraph = locator.get("paragraph")
    sentence = locator.get("sentence")
    if not isinstance(paragraph, int) or not isinstance(sentence, int) or not SHA256_PATTERN.fullmatch(digest):
        return None
    return paragraph, sentence, digest.lower()


def make_client(config: RuntimeConfig, token: str) -> Any:
    from google import genai
    from google.oauth2.credentials import Credentials

    return genai.Client(
        vertexai=True,
        project=config.project_id,
        location=config.vertex.location,
        credentials=Credentials(token=token),
    )


def resolve_access_token(args: argparse.Namespace) -> str:
    direct = os.environ.get(args.access_token_env, "").strip()
    if direct:
        return direct
    environment = os.environ.copy()
    if args.gcloud_config:
        environment["CLOUDSDK_CONFIG"] = str(args.gcloud_config)
    try:
        completed = subprocess.run(
            [str(args.gcloud_bin), "auth", "print-access-token"],
            cwd=ROOT,
            env=environment,
            check=True,
            capture_output=True,
            text=True,
            timeout=45,
        )
    except (OSError, subprocess.SubprocessError) as error:
        raise BatchError("cannot obtain the explicitly authorized Vertex access token") from error
    token = completed.stdout.strip()
    if not token:
        raise BatchError("gcloud returned an empty Vertex access token")
    return token


def require_live_opt_in(config: RuntimeConfig, args: argparse.Namespace) -> None:
    if not args.live:
        raise BatchError("live execution requires --live")
    if os.environ.get("AGENDAFRAME_LIVE_TESTS") != "1":
        raise BatchError("live execution requires AGENDAFRAME_LIVE_TESTS=1")
    approved_project = os.environ.get("AGENDAFRAME_NONPROD_PROJECT_ID", "").strip()
    if approved_project != config.project_id:
        raise BatchError("live execution requires the explicit non-production project ID")
    if any(marker in config.project_id.lower() for marker in ("prod", "production")):
        raise BatchError("production projects are not allowed for this batch")
    if args.budget_usd <= 0:
        raise BatchError("budget must be positive")


def projected_cost_usd(config: RuntimeConfig, articles: Sequence[Mapping[str, Any]], *, issue_count: int, attempts: int) -> float:
    """Conservative guard for the one-off Pro run, not a billing statement."""

    input_tokens = sum(
        min(len(str(row.get("title") or "")) + 20_000, config.vertex.max_input_characters_per_article) // 4
        for row in articles
    )
    article_output_tokens = len(articles) * config.vertex.max_output_tokens
    synthesis_input_tokens = max(1, len(articles) * 260)
    synthesis_output_tokens = issue_count * min(config.vertex.max_output_tokens, 4_000)
    input_cost = (input_tokens + synthesis_input_tokens * issue_count) / 1_000_000 * 1.25
    output_cost = (article_output_tokens * attempts + synthesis_output_tokens) / 1_000_000 * 10.0
    return input_cost + output_cost


def current_display_sources(screen_url: str) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    origin = screen_url.rstrip("/")
    manifest = request_json(f"{origin}/api/initial-five")
    issues = manifest.get("issues")
    if manifest.get("basisDate") is None or not isinstance(issues, list):
        raise BatchError("current public screen did not return an initial-five manifest")
    if len(issues) != 5 or int(manifest.get("issueCount") or 0) != 5:
        raise BatchError("current public screen must contain exactly five issues")
    bundles: list[dict[str, Any]] = []
    for issue in issues:
        if not isinstance(issue, Mapping):
            raise BatchError("current public screen contains an invalid issue descriptor")
        payload_key = str(issue.get("payloadKey") or "").lstrip("/")
        if not payload_key.startswith("issues/"):
            raise BatchError("current public screen returned an unsafe issue payload key")
        bundles.append(request_json(f"{origin}/initial-five/{payload_key}"))
    article_count = sum(len(bundle.get("articles") or []) for bundle in bundles)
    if article_count != int(manifest.get("articleCount") or 0) or article_count < 1:
        raise BatchError("current public screen manifest/article payload counts do not match")
    return manifest, bundles


def article_document(row: Mapping[str, Any], *, body: str, collected_at: datetime) -> ArticleDocument:
    article_id = str(row.get("articleId") or row.get("id") or "").strip()
    source_id = str(row.get("sourceId") or "").strip()
    url = canonicalize_url(str(row.get("canonicalUrl") or ""))
    if not article_id or not source_id:
        raise BatchError("current article metadata is missing articleId/sourceId")
    return ArticleDocument(
        article_id=article_id,
        source_id=source_id,
        canonical_url=url,
        title=str(row.get("title") or "").strip(),
        published_at=parse_datetime(str(row.get("publishedAt") or "")),
        collected_at=collected_at,
        section=str(row.get("section")) if row.get("section") is not None else None,
        body_text=body,
        text_scope="authorized_transient_body",
        title_source=str(row.get("titleSource") or "current_display_metadata"),
    )


def fetch_one_body(row: Mapping[str, Any], *, basis_date: str) -> tuple[Mapping[str, Any], ArticleDocument | None, dict[str, Any]]:
    article_id = str(row.get("articleId") or row.get("id") or "")
    url = str(row.get("canonicalUrl") or "")
    try:
        canonical = canonicalize_url(url)
        fetcher = UrlLibFeedFetcher(timeout_seconds=25.0)
        response = fetcher.fetch(canonical, source_id=str(row.get("sourceId") or "unknown"))
        raw = response.body
        if raw[:2] == b"\x1f\x8b":
            raw = gzip.decompress(raw)
            response = FetchedResponse(response.url, response.status, response.content_type, raw)
        # The public screen's basis date is the display snapshot date, not a
        # publication-date filter.  The current screen intentionally includes
        # recent articles from 8/13-8/15, so validate each fetched page against
        # that row's own publishedAt date instead of rejecting 8/13-8/14 pages.
        row_published = parse_datetime(str(row.get("publishedAt") or ""))
        article_date = row_published.astimezone(KST).date().isoformat()
        parser = NewsArticleParser(
            fetcher,
            collection_start=article_date,
            collection_end=article_date,
        )
        parsed = parser._article_page(  # noqa: SLF001 - use the reviewed bounded parser
            response,
            source_id=str(row.get("sourceId") or "unknown"),
            canonical_url=canonical,
            fallback_title=str(row.get("title") or ""),
            allow_fallback_title=True,
            fallback_published=parse_datetime(str(row.get("publishedAt") or "")),
            collected_at=utc_now(),
        )
        if parsed is None or not parsed.body_text:
            return row, None, {
                "articleId": article_id,
                "status": "excluded",
                "reason": "analysis_excluded_body_unavailable",
                "httpStatus": response.status,
                "bodyCharacters": len(parsed.body_text or "") if parsed else 0,
            }
        document = article_document(row, body=parsed.body_text, collected_at=parsed.collected_at)
        return row, document, {
            "articleId": article_id,
            "status": "fetched",
            "httpStatus": response.status,
            "bodyCharacters": len(parsed.body_text),
            "bodySha256": document.body_hash,
        }
    except Exception as error:  # body failures are article-level review states
        return row, None, {
            "articleId": article_id,
            "status": "excluded",
            "reason": "analysis_excluded_body_unavailable",
            "errorType": type(error).__name__,
        }


def review_entry(row: Mapping[str, Any], *, config: RuntimeConfig, reason: str, body_sha256: str | None = None) -> dict[str, Any]:
    article_id = str(row.get("articleId") or row.get("id") or "")
    return {
        "articleId": article_id,
        "status": "review_needed",
        "engine": {
            "label": "unavailable",
            "engineLabel": "unavailable",
            "semanticAi": False,
            "status": "review_needed",
            "model": config.vertex.model,
            "promptVersion": config.vertex.prompt_version,
            "schemaVersion": ANALYSIS_SCHEMA_VERSION,
            "source": "gcp:vertex:current-display-batch",
            "articleId": article_id,
            "evidenceCount": 0,
            "bodySha256": body_sha256,
            "reviewRequired": True,
            "fallbackReason": reason,
        },
        "evidence": [],
        "profile": None,
    }


def sentence_anchor_schema() -> dict[str, Any]:
    """Keep the model output small: evidence is a parsed sentence index."""

    evidence_ids = {"type": "array", "items": {"type": "integer"}}
    dimension = {
        "type": "object",
        "properties": {
            "dimension": {"type": "string"},
            "status": {"type": "string"},
            "value": {"type": ["string", "null"]},
            "frame_family": {"type": ["string", "null"]},
            "voice_kind": {"type": ["string", "null"]},
            "evidence_sentence_ids": evidence_ids,
            "reason": {"type": ["string", "null"]},
        },
        "required": [
            "dimension",
            "status",
            "value",
            "frame_family",
            "voice_kind",
            "evidence_sentence_ids",
            "reason",
        ],
    }
    actor = {
        "type": "object",
        "properties": {
            "role": {"type": "string"},
            "voice_kind": {"type": "string"},
            "evidence_sentence_ids": evidence_ids,
        },
        "required": ["role", "voice_kind", "evidence_sentence_ids"],
    }
    context_value = {
        "type": "object",
        "properties": {
            "code": {"type": "string"},
            "label": {"type": ["string", "null"]},
            "evidence_sentence_ids": evidence_ids,
            "reason": {"type": ["string", "null"]},
        },
        "required": ["code", "evidence_sentence_ids"],
    }
    context_item = {
        "type": "object",
        "properties": {
            "code": {"type": "string"},
            "label": {"type": ["string", "null"]},
            "evidence_sentence_ids": evidence_ids,
            "appears_in_lead": {"type": "boolean"},
        },
        "required": ["code", "evidence_sentence_ids"],
    }
    return {
        "type": "object",
        "required": ["decision", "dimensions", "actors"],
        "properties": {
            "decision": {"type": "string"},
            "dimensions": {"type": "array", "items": dimension},
            "actors": {"type": "array", "items": actor},
            "structured_context": {
                "type": "object",
                "properties": {
                    "genre": context_value,
                    "scope": context_value,
                    "context_depth": context_value,
                    "generic_frames": {"type": "array", "items": context_item},
                    "policy_frames": {"type": "array", "items": context_item},
                    "framing_devices": {"type": "array", "items": context_item},
                },
            },
        },
    }


def sentence_anchor_prompt(article: ArticleDocument, rows: Sequence[Mapping[str, Any]]) -> str:
    taxonomy = json.dumps(
        {name: sorted(values) for name, values in FRAME_FAMILIES.items()},
        ensure_ascii=False,
        sort_keys=True,
    )
    roles = json.dumps(sorted(SOURCE_ROLES), ensure_ascii=False)
    context_codes = json.dumps(
        {key: sorted(values) for key, values in STRUCTURED_CONTEXT_CODES.items()},
        ensure_ascii=False,
        sort_keys=True,
    )
    sentence_input = [
        {
            "id": index,
            "paragraph": row["paragraph"],
            "sentence": row["sentence"],
            "text": row["text"],
        }
        for index, row in enumerate(rows)
    ]
    return f"""You are an evidence-bounded Korean news framing coder.
Analyze only the supplied article. Do not infer hidden outlet intent, ideology,
political leaning, or any cause not stated or visibly narrated in the article.
The article is divided into PARSED_SENTENCES. Evidence must be returned only as
integer evidence_sentence_ids copied from those sentence ids. Never return an
evidence excerpt, offset, or invented sentence number. The application maps
those ids back to the exact source sentence and computes its evidence hash.

Return JSON only. Return exactly one dimension object for each of:
problem_definition, causal_attribution, responsibility_attribution, evaluation,
treatment_recommendation, actor_visibility. For each supported or conflicting
dimension provide one concise Korean value (maximum 160 characters), one valid
frame_family from FRAME_FAMILY_TAXONOMY, a voice_kind, and one or two sentence
ids. If the article does not explicitly support a dimension, use
status=explicit_not_stated, value=null, frame_family=null, voice_kind=null, and
an empty evidence_sentence_ids array. A source statement is attributed to the
source, not converted into the journalist's position. Actors must use only the
listed source roles and source voice kinds; do not return names.
Structured context is optional; use only the listed codes and sentence ids.
FRAME_FAMILY_TAXONOMY: {taxonomy}
SOURCE_ROLES: {roles}
STRUCTURED_CONTEXT_CODES: {context_codes}

ARTICLE_ID: {article.article_id}
ARTICLE_TITLE: {article.title}
PARSED_SENTENCES:
{json.dumps(sentence_input, ensure_ascii=False)}
"""


def anchor_rows(rows: Sequence[Mapping[str, Any]], ids: object, article_id: str) -> list[dict[str, Any]]:
    if not isinstance(ids, Sequence) or isinstance(ids, (str, bytes, bytearray)):
        return []
    output: list[dict[str, Any]] = []
    seen: set[int] = set()
    for raw_id in ids[:2]:
        if isinstance(raw_id, bool):
            continue
        try:
            index = int(raw_id)
        except (TypeError, ValueError):
            continue
        if index < 0 or index >= len(rows) or index in seen:
            continue
        seen.add(index)
        row = rows[index]
        output.append(
            {
                "article_id": article_id,
                "start": int(row["start"]),
                "end": int(row["end"]),
                "text": str(row["text"]),
            }
        )
    return output


def explicit_dimension(name: str, reason: str = "문장 근거가 확인되지 않아 명시하지 않음") -> dict[str, Any]:
    return {
        "dimension": name,
        "status": "explicit_not_stated",
        "value": None,
        "frame_family": None,
        "voice_kind": None,
        "evidence": [],
        "reason": reason,
    }


def normalize_voice_kind(value: object) -> str | None:
    normalized = str(value or "").strip().lower().replace("-", "_").replace(" ", "_")
    return {
        "journalist": "journalist_narration",
        "reporter": "journalist_narration",
        "journalist_voice": "journalist_narration",
        "narration": "journalist_narration",
        "source": "indirect_source",
        "source_attributed": "indirect_source",
        "attributed_source": "indirect_source",
        "quote": "direct_quote",
        "direct": "direct_quote",
        "direct_quote": "direct_quote",
        "indirect": "indirect_source",
        "indirect_source": "indirect_source",
        "uncertain": "uncertain_quote",
        "uncertain_quote": "uncertain_quote",
    }.get(normalized)


def sentence_anchor_result(
    article: ArticleDocument,
    payload: Mapping[str, Any],
    *,
    config: RuntimeConfig,
    prompt: str,
    response_text: str,
    response: Any,
    attempt: int,
    rows: Sequence[Mapping[str, Any]],
) -> FrameResult:
    body = article.body_text or ""
    raw_dimensions = payload.get("dimensions")
    by_name: dict[str, Mapping[str, Any]] = {}
    if isinstance(raw_dimensions, Sequence) and not isinstance(raw_dimensions, (str, bytes, bytearray)):
        for raw in raw_dimensions:
            if isinstance(raw, Mapping):
                name = str(raw.get("dimension") or "")
                if name in FRAME_DIMENSIONS and name not in by_name:
                    by_name[name] = raw
    dimensions: list[dict[str, Any]] = []
    observed = 0
    for name in sorted(FRAME_DIMENSIONS):
        raw = by_name.get(name)
        if raw is None:
            dimensions.append(explicit_dimension(name, "모델이 해당 차원을 반환하지 않아 명시하지 않음"))
            continue
        status = str(raw.get("status") or "")
        value = raw.get("value")
        family = raw.get("frame_family")
        voice = normalize_voice_kind(raw.get("voice_kind"))
        evidence = anchor_rows(rows, raw.get("evidence_sentence_ids"), article.article_id)
        if (
            status not in {"supported", "conflicting"}
            or not isinstance(value, str)
            or not value.strip()
            or len(value.strip()) > 160
            or family not in FRAME_FAMILIES.get(name, set())
            or voice not in {"journalist_narration", "direct_quote", "indirect_source", "uncertain_quote"}
            or not evidence
            or _unsafe_public_value_reason(body, value.strip()) is not None
        ):
            dimensions.append(explicit_dimension(name, "모델 판정과 문장 근거가 함께 검증되지 않아 명시하지 않음"))
            continue
        observed += 1
        dimensions.append(
            {
                "dimension": name,
                "status": status,
                "value": value.strip(),
                "frame_family": family,
                "voice_kind": voice,
                "evidence": evidence,
                "reason": raw.get("reason"),
            }
        )

    actors: list[dict[str, Any]] = []
    raw_actors = payload.get("actors")
    if isinstance(raw_actors, Sequence) and not isinstance(raw_actors, (str, bytes, bytearray)):
        for raw in raw_actors[:12]:
            if not isinstance(raw, Mapping):
                continue
            role = raw.get("role")
            voice = normalize_voice_kind(raw.get("voice_kind"))
            evidence = anchor_rows(rows, raw.get("evidence_sentence_ids"), article.article_id)
            if role not in SOURCE_ROLES or voice not in {"direct_quote", "indirect_source", "uncertain_quote"} or not evidence:
                continue
            actors.append({"role": role, "voice_kind": voice, "evidence": evidence})

    context: dict[str, Any] = {}
    raw_context = payload.get("structured_context")
    if isinstance(raw_context, Mapping):
        for key in ("genre", "scope", "context_depth"):
            raw = raw_context.get(key)
            if not isinstance(raw, Mapping):
                continue
            code = str(raw.get("code") or "unknown")
            allowed = STRUCTURED_CONTEXT_CODES[key]
            if code not in allowed:
                code = "unknown"
            evidence = anchor_rows(rows, raw.get("evidence_sentence_ids"), article.article_id)
            if code != "unknown" and not evidence:
                code = "unknown"
                evidence = []
            context[key] = {
                "code": code,
                "label": raw.get("label"),
                "evidence": evidence,
            }
        for key in ("generic_frames", "policy_frames", "framing_devices"):
            values = raw_context.get(key)
            if not isinstance(values, Sequence) or isinstance(values, (str, bytes, bytearray)):
                continue
            allowed = STRUCTURED_CONTEXT_CODES["generic_frame" if key == "generic_frames" else "policy_frame" if key == "policy_frames" else "framing_device"]
            items: list[dict[str, Any]] = []
            for raw in values[:8]:
                if not isinstance(raw, Mapping):
                    continue
                code = str(raw.get("code") or "unknown")
                if code not in allowed:
                    continue
                evidence = anchor_rows(rows, raw.get("evidence_sentence_ids"), article.article_id)
                if code != "unknown" and not evidence:
                    code = "unknown"
                    evidence = []
                items.append(
                    {
                        "code": code,
                        "label": raw.get("label"),
                        "evidence": evidence,
                        **({"appears_in_lead": bool(raw.get("appears_in_lead", False))} if key == "framing_devices" else {}),
                    }
                )
            context[key] = items

    usage = getattr(response, "usage_metadata", None)
    result = FrameResult(
        article_id=article.article_id,
        decision=(
            "analyze"
            if observed and str(payload.get("decision") or "").strip().lower() not in {"defer", "cannot_analyze"}
            else "review_needed"
        ),
        dimensions=tuple(dimensions),
        model_id=config.vertex.model,
        prompt_version=config.vertex.prompt_version,
        schema_version=config.vertex.schema_version,
        actors=tuple(actors),
        structured_context=context or None,
        input_tokens=getattr(usage, "prompt_token_count", None),
        output_tokens=getattr(usage, "candidates_token_count", None),
        invocation_receipt={
            "provider": "vertex_ai",
            "model": config.vertex.model,
            "prompt_version": config.vertex.prompt_version,
            "attempt": attempt,
            "request_sha256": hashlib.sha256(prompt.encode("utf-8")).hexdigest(),
            "response_sha256": hashlib.sha256(response_text.encode("utf-8")).hexdigest(),
            "response_id": getattr(response, "response_id", None) or getattr(response, "id", None),
            "completed_at": utc_now().isoformat(),
        },
        text_scope=article.text_scope,
        analyzed_character_count=len(article.body_text or ""),
        input_truncated=False,
        analysis_state=(
            AnalysisState.SUCCEEDED.value
            if observed and str(payload.get("decision") or "").strip().lower() not in {"defer", "cannot_analyze"}
            else AnalysisState.REVIEW_NEEDED.value
        ),
        attempt_count=attempt,
        idempotency_fingerprint=analysis_idempotency_fingerprint(
            article,
            model_id=config.vertex.model,
            prompt_version=config.vertex.prompt_version,
            schema_version=config.vertex.schema_version,
        ),
    )
    validate_frame_result(article, result)
    return result


def analyze_with_sentence_anchors(article: ArticleDocument, *, config: RuntimeConfig, token: str) -> FrameResult:
    from google import genai
    from google.genai import types
    from google.oauth2.credentials import Credentials

    body = article.body_text or ""
    rows = sentence_rows(body[: config.vertex.max_input_characters_per_article])
    prompt = sentence_anchor_prompt(article, rows)
    client = genai.Client(
        vertexai=True,
        project=config.project_id,
        location=config.vertex.location,
        credentials=Credentials(token=token),
    )
    last_error: Exception | None = None
    for attempt in range(1, max(1, min(config.vertex.max_attempts, 3)) + 1):
        try:
            response = client.models.generate_content(
                model=config.vertex.model,
                contents=prompt,
                config=types.GenerateContentConfig(
                    temperature=0,
                    max_output_tokens=config.vertex.max_output_tokens,
                    response_mime_type="application/json",
                    response_json_schema=sentence_anchor_schema(),
                    thinking_config=types.ThinkingConfig(thinking_budget=config.vertex.thinking_budget),
                ),
            )
            response_text = response.text or ""
            payload = json.loads(response_text)
            if not isinstance(payload, Mapping):
                raise ValueError("sentence-anchor response must be an object")
            return sentence_anchor_result(
                article,
                payload,
                config=config,
                prompt=prompt,
                response_text=response_text,
                response=response,
                attempt=attempt,
                rows=rows,
            )
        except Exception as error:
            last_error = error
            if attempt < config.vertex.max_attempts:
                continue
    dimensions = tuple(explicit_dimension(name, "문장 번호 기반 근거 검증 실패") for name in sorted(FRAME_DIMENSIONS))
    detail = re.sub(r"\s+", " ", str(last_error)).strip()[:240] if last_error else "unknown"
    return FrameResult(
        article_id=article.article_id,
        decision="review_needed",
        dimensions=dimensions,
        model_id=config.vertex.model,
        prompt_version=config.vertex.prompt_version,
        schema_version=config.vertex.schema_version,
        text_scope=article.text_scope,
        analyzed_character_count=len(body),
        input_truncated=False,
        fallback_reason=f"sentence_anchor_analysis_failed:{type(last_error).__name__ if last_error else 'unknown'}:{detail}",
        analysis_state=AnalysisState.REVIEW_NEEDED.value,
        attempt_count=max(1, min(config.vertex.max_attempts, 3)),
        error_code=type(last_error).__name__ if last_error else "sentence_anchor_analysis_failed",
        retryable_failure=False,
    )


def analyze_one(
    row: Mapping[str, Any],
    document: ArticleDocument | None,
    *,
    config: RuntimeConfig,
    token: str,
    run_id: str,
) -> tuple[str, dict[str, Any], dict[str, Any]]:
    article_id = str(row.get("articleId") or row.get("id") or "")
    if document is None:
        return article_id, review_entry(row, config=config, reason="analysis_excluded_body_unavailable"), {
            "articleId": article_id,
            "status": "excluded",
            "reason": "analysis_excluded_body_unavailable",
        }
    try:
        result = analyze_with_sentence_anchors(document, config=config, token=token)
        if result.decision != "analyze" or result.fallback_reason is not None or result.analysis_state == "review_needed":
            return article_id, review_entry(
                row,
                config=config,
                reason=result.fallback_reason or result.error_code or "vertex_analysis_review_needed",
                body_sha256=document.body_hash,
            ), {
                "articleId": article_id,
                "status": "review_needed",
                "reason": result.error_code or "vertex_analysis_review_needed",
                "attemptCount": result.attempt_count,
            }
        profile = strip_private_flags(public_profile(document, result))
        if not isinstance(profile, dict):
            raise BatchError(f"public profile must remain an object: {article_id}")
        profile.setdefault("lineage", {})["batch_run_id"] = run_id
        profile["lineage"]["source"] = "gcp:vertex:current-display-batch"
        evidence = collect_evidence(profile, article_id)
        entry = {
            "articleId": article_id,
            "status": "succeeded",
            "engine": {
                "label": "ai_semantic",
                "engineLabel": "ai_semantic",
                "semanticAi": True,
                "status": "succeeded",
                "model": config.vertex.model,
                "promptVersion": config.vertex.prompt_version,
                "schemaVersion": ANALYSIS_SCHEMA_VERSION,
                "source": "gcp:vertex:current-display-batch",
                "articleId": article_id,
                "evidenceCount": len(evidence),
                "bodySha256": document.body_hash,
                "reviewRequired": True,
                "fallbackReason": None,
            },
            "evidence": evidence,
            "profile": profile,
        }
        serialized = public_json(entry)
        if document.body_text and document.body_text in serialized:
            raise BatchError(f"body leaked into public profile: {article_id}")
        return article_id, entry, {
            "articleId": article_id,
            "status": "succeeded",
            "evidenceCount": len(evidence),
            "attemptCount": result.attempt_count,
            "inputTokens": result.input_tokens,
            "outputTokens": result.output_tokens,
        }
    except Exception as error:
        return article_id, review_entry(
            row,
            config=config,
            reason=f"vertex_analysis_failed:{type(error).__name__}",
            body_sha256=document.body_hash,
        ), {
            "articleId": article_id,
            "status": "review_needed",
            "reason": f"vertex_analysis_failed:{type(error).__name__}",
        }


def with_article_body_metadata(
    row: Mapping[str, Any], document: ArticleDocument | None, *, issue_id: str
) -> dict[str, Any]:
    output = dict(row)
    output["bodySha256"] = document.body_hash if document is not None else None
    output["issueId"] = str(output.get("issueId") or issue_id)
    return output


def comparison_evidence(value: object) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []

    def visit(node: object) -> None:
        if isinstance(node, Mapping):
            article_id = node.get("article_id") or node.get("articleId")
            locator = node.get("locator")
            digest = node.get("sentence_sha256") or node.get("sentenceSha256")
            if article_id and isinstance(locator, Mapping) and isinstance(digest, str):
                rows.append(
                    {
                        "articleId": str(article_id),
                        "locator": dict(locator),
                        "sentenceSha256": digest,
                    }
                )
            for child in node.values():
                visit(child)
        elif isinstance(node, Sequence) and not isinstance(node, (str, bytes, bytearray)):
            for child in node:
                visit(child)

    visit(value)
    return rows


def synthesize_issue(
    bundle: Mapping[str, Any],
    entries_by_article: Mapping[str, Mapping[str, Any]],
    *,
    config: RuntimeConfig,
    token: str,
    run_id: str,
) -> tuple[dict[str, Any], dict[str, Any]]:
    issue = dict(bundle.get("issue") or {})
    articles = [dict(row) for row in (bundle.get("articles") or []) if isinstance(row, Mapping)]
    issue_id = str(issue.get("issueId") or bundle.get("lineage", {}).get("issueId") or "")
    profiles = [
        dict(entry)
        for article in articles
        if (entry := entries_by_article.get(str(article.get("articleId") or "")))
        and isinstance(entry.get("profile"), Mapping)
    ]
    synthesizer = VertexEventSynthesizer(
        config,
        client_factory=lambda cfg: make_client(cfg, token),
    )
    bound = build_bound_comparison(
        profiles=profiles,
        articles=articles,
        title=str(issue.get("title") or ""),
        issue_id=issue_id,
        synthesizer=synthesizer,
    )
    if bound is None:
        return {
            "engine": {
                "label": "unavailable",
                "engineLabel": "unavailable",
                "semanticAi": False,
                "status": "review_needed",
                "model": config.vertex.model,
                "promptVersion": EVENT_PROMPT_VERSION,
                "schemaVersion": EVENT_SCHEMA_VERSION,
                "source": "gcp:event-synthesis",
            },
            "data": {
                "summary_30_seconds": {
                    "what_happened": None,
                    "common_ground": None,
                    "main_difference": None,
                    "source_context": None,
                    "divergence_detected": False,
                },
                "synthesis": {
                    "schemaVersion": EVENT_SCHEMA_VERSION,
                    "promptVersion": EVENT_PROMPT_VERSION,
                    "usable": False,
                    "source": "gcp:event-synthesis",
                },
                "not_observed_statements": ["의제 종합은 근거 검증을 통과한 문장이 없어 공개하지 않습니다."],
            },
            "evidence": [],
        }, {
            "issueId": issue_id,
            "status": "failed",
            "source": "gcp:event-synthesis",
        }
    bound = dict(bound)
    bound["run_id"] = run_id
    payload = public_comparison_payload(
        bound,
        article_count=len(articles),
        outlet_count=len({str(row.get("outlet") or row.get("sourceId") or "") for row in articles}),
    )
    payload["source_lens"] = source_lens_from_profiles(profiles, articles)
    payload["not_observed_statements"] = [
        f"{len(articles) - len(profiles)}건은 본문 확보·분석에서 제외되어 종합 근거로 사용하지 않았습니다."
    ] if len(profiles) < len(articles) else []
    comparison = {
        "engine": {
            "label": "ai_semantic",
            "engineLabel": "ai_semantic",
            "semanticAi": True,
            "status": "succeeded",
            "model": config.vertex.model,
            "promptVersion": EVENT_PROMPT_VERSION,
            "schemaVersion": EVENT_SCHEMA_VERSION,
            "source": "gcp:event-synthesis",
        },
        "data": payload,
        "evidence": comparison_evidence(payload),
    }
    return comparison, {
        "issueId": issue_id,
        "status": "succeeded",
        "source": str(bound.get("source") or "gcp:profile-event-composition"),
        "vertexInvocation": bool(bound.get("invocation")),
        "usable": bool(bound.get("usable")),
        "evidenceCount": len(comparison["evidence"]),
    }


def verify_issue(
    bundle: Mapping[str, Any],
    documents: Mapping[str, ArticleDocument],
) -> dict[str, Any]:
    issue_id = str(bundle.get("issue", {}).get("issueId") or "")
    profiles = bundle.get("semanticProfiles") or []
    profile_evidence: set[tuple[str, int, int, str]] = set()
    public_claim_count = 0
    invalid_evidence = 0
    for entry in profiles:
        if not isinstance(entry, Mapping) or entry.get("status") != "succeeded":
            continue
        article_id = str(entry.get("articleId") or "")
        document = documents.get(article_id)
        if document is None or contains_forbidden_key(entry):
            invalid_evidence += 1
            continue
        valid_body = body_evidence_index(document)
        for evidence in entry.get("evidence") or []:
            key = evidence_key(evidence) if isinstance(evidence, Mapping) else None
            if key is None or key not in valid_body:
                invalid_evidence += 1
            else:
                profile_evidence.add((article_id, key[0], key[1], key[2]))
        profile = entry.get("profile")
        if isinstance(profile, Mapping):
            for dimension in (profile.get("dimensions") or {}).values():
                if not isinstance(dimension, Mapping):
                    continue
                for item in dimension.get("items") or []:
                    if not isinstance(item, Mapping):
                        continue
                    if item.get("public_paraphrase"):
                        public_claim_count += 1
                    key = evidence_key(item.get("evidence") or {})
                    if key is None or key not in valid_body:
                        invalid_evidence += 1
    synthesis = ((bundle.get("comparison") or {}).get("data") or {}).get("synthesis")
    synthesis_claim_count = 0
    if isinstance(synthesis, Mapping):
        for claim in synthesis.values():
            if isinstance(claim, Mapping) and claim.get("status") == "observed" and claim.get("text"):
                synthesis_claim_count += 1
    comparison_refs = comparison_evidence((bundle.get("comparison") or {}).get("data") or {})
    unbound_comparison = 0
    for ref in comparison_refs:
        key = evidence_key(ref)
        if key is None or (ref["articleId"], key[0], key[1], key[2]) not in profile_evidence:
            unbound_comparison += 1
    if contains_forbidden_key(bundle):
        invalid_evidence += 1
    return {
        "issueId": issue_id,
        "articleCount": len(bundle.get("articles") or []),
        "succeededArticleCount": sum(1 for entry in profiles if isinstance(entry, Mapping) and entry.get("status") == "succeeded"),
        "profileEvidenceCount": len(profile_evidence),
        "publicClaimCount": public_claim_count + synthesis_claim_count,
        "synthesisClaimCount": synthesis_claim_count,
        "comparisonEvidenceCount": len(comparison_refs),
        "unboundComparisonEvidence": unbound_comparison,
        "invalidEvidence": invalid_evidence,
        "passed": invalid_evidence == 0 and unbound_comparison == 0,
    }


def build_bundle(
    original: Mapping[str, Any],
    entries_by_article: Mapping[str, Mapping[str, Any]],
    documents: Mapping[str, ArticleDocument],
    comparison: Mapping[str, Any],
    comparison_status: Mapping[str, Any],
    *,
    config: RuntimeConfig,
    run_id: str,
    source_manifest: Mapping[str, Any],
) -> dict[str, Any]:
    bundle = copy.deepcopy(dict(original))
    articles = [
        with_article_body_metadata(
            row,
            documents.get(str(row.get("articleId") or "")),
            issue_id=str(bundle.get("issue", {}).get("issueId") or ""),
        )
        for row in (bundle.get("articles") or [])
        if isinstance(row, Mapping)
    ]
    bundle["articles"] = articles
    bundle["semanticProfiles"] = [
        copy.deepcopy(entries_by_article[str(article.get("articleId") or "")])
        for article in articles
        if str(article.get("articleId") or "") in entries_by_article
    ]
    bundle["comparison"] = copy.deepcopy(dict(comparison))
    succeeded = sum(1 for entry in bundle["semanticProfiles"] if entry.get("status") == "succeeded")
    article_count = len(articles)
    semantic_status = "succeeded" if succeeded == article_count and article_count else "review_needed"
    bundle["analysisStatus"] = copy.deepcopy(bundle.get("analysisStatus") or {})
    bundle["analysisStatus"]["state"] = "succeeded" if semantic_status == "succeeded" and comparison_status.get("usable") else "review_needed"
    bundle["analysisStatus"]["semantic"] = {
        "status": semantic_status,
        "engineLabel": "ai_semantic" if succeeded else "unavailable",
        "semanticAi": succeeded > 0,
        "model": config.vertex.model,
        "promptVersion": config.vertex.prompt_version,
        "schemaVersion": ANALYSIS_SCHEMA_VERSION,
        "source": "gcp:vertex:current-display-batch",
        "articleCount": article_count,
        "succeededArticleCount": succeeded,
        "reviewNeededArticleCount": article_count - succeeded,
        "requiresHumanReview": True,
    }
    bundle["status"] = bundle["analysisStatus"]["state"]
    bundle["lineage"] = copy.deepcopy(bundle.get("lineage") or {})
    bundle["lineage"]["runId"] = run_id
    bundle["lineage"]["basisDate"] = source_manifest.get("basisDate")
    source = bundle["lineage"].setdefault("source", {})
    source["semanticDirectory"] = f"current-display-batch/{run_id}"
    source["semanticFileCount"] = succeeded
    source["semanticBatchModel"] = config.vertex.model
    source["semanticBatchPromptVersion"] = config.vertex.prompt_version
    source["eventSynthesisPromptVersion"] = EVENT_PROMPT_VERSION
    bundle["lineage"]["analysisBoundary"] = "current Vercel display articles only; collection/ranking/scheduler untouched"
    if not contains_forbidden_key(bundle):
        return bundle
    raise BatchError(f"forbidden public key in generated issue bundle: {bundle.get('issue', {}).get('issueId')}")


def run(args: argparse.Namespace) -> dict[str, Any]:
    config = RuntimeConfig.from_yaml(args.config)
    config = replace(
        config,
        vertex=replace(
            config.vertex,
            model=args.model,
            max_attempts=args.max_attempts,
            # Gemini 2.5 Pro rejects an explicit thinking_budget=0.  A bounded
            # thinking budget leaves enough room for the evidence JSON; lite
            # keeps the repository's configured zero-budget behavior.
            thinking_budget=(
                2048 if args.model.startswith("gemini-2.5-pro") else config.vertex.thinking_budget
            ),
            max_output_tokens=(
                6000 if args.model.startswith("gemini-2.5-pro") else config.vertex.max_output_tokens
            ),
        ),
    )
    require_live_opt_in(config, args)
    manifest, source_bundles = current_display_sources(args.screen_url)
    basis_date = str(manifest.get("basisDate"))
    try:
        date.fromisoformat(basis_date)
    except ValueError as error:
        raise BatchError(f"current display basisDate is invalid: {basis_date}") from error
    all_rows = [
        row
        for bundle in source_bundles
        for row in (bundle.get("articles") or [])
        if isinstance(row, Mapping)
    ]
    if len(all_rows) > config.vertex.max_articles_per_run:
        raise BatchError("current display article count exceeds the configured per-run cap")
    if len({str(row.get("articleId") or row.get("id") or "") for row in all_rows}) != len(all_rows):
        raise BatchError("current display contains duplicate article IDs")
    estimated = projected_cost_usd(
        config,
        all_rows,
        issue_count=len(source_bundles),
        attempts=config.vertex.max_attempts,
    )
    if estimated > args.budget_usd:
        raise BatchError(f"conservative projected Pro cost ${estimated:.2f} exceeds supplied budget ${args.budget_usd:.2f}")
    token = resolve_access_token(args)
    run_id = uuid.uuid4().hex

    documents: dict[str, ArticleDocument] = {}
    body_results: dict[str, dict[str, Any]] = {}
    with ThreadPoolExecutor(max_workers=args.fetch_workers) as pool:
        futures = [pool.submit(fetch_one_body, row, basis_date=basis_date) for row in all_rows]
        for future in as_completed(futures):
            row, document, result = future.result()
            article_id = str(row.get("articleId") or row.get("id") or "")
            body_results[article_id] = result
            if document is not None:
                documents[article_id] = document

    entries_by_article: dict[str, dict[str, Any]] = {}
    article_results: list[dict[str, Any]] = []
    with ThreadPoolExecutor(max_workers=args.article_workers) as pool:
        futures = [
            pool.submit(
                analyze_one,
                row,
                documents.get(str(row.get("articleId") or row.get("id") or "")),
                config=config,
                token=token,
                run_id=run_id,
            )
            for row in all_rows
        ]
        for future in as_completed(futures):
            article_id, entry, result = future.result()
            entries_by_article[article_id] = entry
            article_results.append(result)

    comparison_by_issue: dict[str, dict[str, Any]] = {}
    comparison_status_by_issue: dict[str, dict[str, Any]] = {}
    with ThreadPoolExecutor(max_workers=args.synthesis_workers) as pool:
        futures = []
        for source_bundle in source_bundles:
            issue_id = str(source_bundle.get("issue", {}).get("issueId") or "")
            issue_entries = {
                str(article.get("articleId") or ""): entries_by_article[str(article.get("articleId") or "")]
                for article in source_bundle.get("articles") or []
                if str(article.get("articleId") or "") in entries_by_article
            }
            futures.append(
                pool.submit(
                    synthesize_issue,
                    source_bundle,
                    issue_entries,
                    config=config,
                    token=token,
                    run_id=run_id,
                )
            )
        for future in as_completed(futures):
            comparison, status = future.result()
            issue_id = str(status.get("issueId") or "")
            comparison_by_issue[issue_id] = comparison
            comparison_status_by_issue[issue_id] = status

    output_bundles: dict[str, dict[str, Any]] = {}
    for source_bundle in source_bundles:
        issue_id = str(source_bundle.get("issue", {}).get("issueId") or "")
        output_bundles[issue_id] = build_bundle(
            source_bundle,
            {
                article_id: entries_by_article[article_id]
                for article_id in entries_by_article
                if any(str(row.get("articleId") or "") == article_id for row in source_bundle.get("articles") or [])
            },
            documents,
            comparison_by_issue[issue_id],
            comparison_status_by_issue[issue_id],
            config=config,
            run_id=run_id,
            source_manifest=manifest,
        )

    total_succeeded = sum(
        1
        for bundle in output_bundles.values()
        for entry in bundle.get("semanticProfiles") or []
        if isinstance(entry, Mapping) and entry.get("status") == "succeeded"
    )
    if total_succeeded == 0:
        raise BatchError("no current-display article produced a verified Vertex profile; no public artifact was written")

    verification: dict[str, dict[str, Any]] = {}
    with ThreadPoolExecutor(max_workers=args.verification_workers) as pool:
        futures = {
            pool.submit(verify_issue, bundle, documents): issue_id
            for issue_id, bundle in output_bundles.items()
        }
        for future in as_completed(futures):
            issue_id = futures[future]
            verification[issue_id] = future.result()
    if not all(row.get("passed") for row in verification.values()):
        raise BatchError("evidence verification failed; no public artifact was written")

    output_manifest = copy.deepcopy(manifest)
    output_manifest["analysisRunId"] = run_id
    output_manifest["analysisGeneratedAt"] = utc_now().isoformat()
    output_manifest["analysisModel"] = config.vertex.model
    output_manifest["analysisPromptVersion"] = config.vertex.prompt_version
    output_manifest["analysisEvidencePolicy"] = "article URL locators and SHA-256 fingerprints only"
    for descriptor in output_manifest.get("issues") or []:
        issue_id = str(descriptor.get("issueId") or "")
        bundle = output_bundles[issue_id]
        semantic = bundle["analysisStatus"]["semantic"]
        descriptor["status"] = bundle["status"]
        descriptor["semantic"] = {
            "status": semantic["status"],
            "engineLabel": semantic["engineLabel"],
            "semanticAi": semantic["semanticAi"],
            "model": semantic["model"],
            "promptVersion": semantic["promptVersion"],
            "schemaVersion": semantic["schemaVersion"],
            "succeededArticleCount": semantic["succeededArticleCount"],
            "reviewNeededArticleCount": semantic["reviewNeededArticleCount"],
        }
    if contains_forbidden_key(output_manifest):
        raise BatchError("forbidden public key in generated manifest")

    for issue_id, bundle in output_bundles.items():
        atomic_write_json(args.output_root / f"issues/{issue_id}.json", bundle)
    atomic_write_json(args.output_root / "manifest.json", output_manifest)

    summary = {
        "runId": run_id,
        "screenUrl": args.screen_url,
        "basisDate": basis_date,
        "sourceGeneratedAt": manifest.get("generatedAt"),
        "model": config.vertex.model,
        "articleConcurrency": args.article_workers,
        "synthesisConcurrency": args.synthesis_workers,
        "verificationConcurrency": args.verification_workers,
        "issueCount": len(source_bundles),
        "articleCount": len(all_rows),
        "bodyFetch": {
            "fetched": len(documents),
            "excluded": len(all_rows) - len(documents),
            "results": sorted(body_results.values(), key=lambda row: str(row.get("articleId"))),
        },
        "articleAnalysis": {
            "succeeded": sum(1 for row in article_results if row.get("status") == "succeeded"),
            "reviewNeeded": sum(1 for row in article_results if row.get("status") != "succeeded"),
        },
        "synthesis": sorted(comparison_status_by_issue.values(), key=lambda row: str(row.get("issueId"))),
        "verification": sorted(verification.values(), key=lambda row: str(row.get("issueId"))),
        "conservativeProjectedCostUsd": round(estimated, 4),
        "rawArticleBodyWritten": False,
        "outputRoot": str(args.output_root),
    }
    args.summary_root.mkdir(parents=True, exist_ok=True)
    atomic_write_json(args.summary_root / f"{run_id}.json", summary)
    return summary


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--live", action="store_true")
    parser.add_argument("--screen-url", default=DEFAULT_SCREEN_URL)
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    parser.add_argument("--output-root", type=Path, default=DEFAULT_OUTPUT_ROOT)
    parser.add_argument("--summary-root", type=Path, default=DEFAULT_SUMMARY_ROOT)
    parser.add_argument("--model", default="gemini-2.5-pro")
    parser.add_argument("--max-attempts", type=int, choices=(1, 2, 3), default=3)
    parser.add_argument("--budget-usd", type=float, default=12.0)
    parser.add_argument("--fetch-workers", type=int, choices=(4, 6, 8, 10), default=8)
    parser.add_argument("--article-workers", type=int, choices=(4, 6, 8, 10), default=8)
    parser.add_argument("--synthesis-workers", type=int, choices=(3, 4, 5), default=5)
    parser.add_argument("--verification-workers", type=int, choices=(3, 4, 5), default=5)
    parser.add_argument("--access-token-env", default="AGENDAFRAME_ACCESS_TOKEN")
    parser.add_argument("--gcloud-bin", type=Path, default=Path("gcloud"))
    parser.add_argument("--gcloud-config", type=Path)
    args = parser.parse_args(argv)
    try:
        summary = run(args)
    except (BatchError, OSError, ValueError, KeyError) as error:
        print(json.dumps({"ok": False, "error": str(error)}, ensure_ascii=False), file=sys.stderr)
        return 1
    print(json.dumps({"ok": True, **summary}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
