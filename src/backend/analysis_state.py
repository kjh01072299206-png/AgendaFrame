from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from typing import Any, Mapping

from crawler.models import ArticleDocument


class AnalysisState(StrEnum):
    """Durable state for one article/model/approval analysis identity."""

    QUEUED = "queued"
    RUNNING = "running"
    RETRY_WAIT = "retry_wait"
    SUCCEEDED = "succeeded"
    REVIEW_NEEDED = "review_needed"
    DEAD_LETTER = "dead_letter"


MAX_BATCH_REDRIVE_ROUNDS = 3

_ALLOWED_TRANSITIONS: dict[AnalysisState | None, frozenset[AnalysisState]] = {
    None: frozenset({AnalysisState.QUEUED, AnalysisState.RUNNING}),
    AnalysisState.QUEUED: frozenset({AnalysisState.RUNNING, AnalysisState.DEAD_LETTER}),
    AnalysisState.RUNNING: frozenset(
        {
            AnalysisState.RETRY_WAIT,
            AnalysisState.SUCCEEDED,
            AnalysisState.REVIEW_NEEDED,
            AnalysisState.DEAD_LETTER,
        }
    ),
    AnalysisState.RETRY_WAIT: frozenset(
        {AnalysisState.QUEUED, AnalysisState.RUNNING, AnalysisState.DEAD_LETTER}
    ),
    AnalysisState.REVIEW_NEEDED: frozenset(
        {AnalysisState.QUEUED, AnalysisState.RUNNING, AnalysisState.DEAD_LETTER}
    ),
    AnalysisState.SUCCEEDED: frozenset(),
    AnalysisState.DEAD_LETTER: frozenset(),
}


@dataclass(frozen=True)
class AnalysisStateRecord:
    fingerprint: str
    article_id: str
    state: AnalysisState
    attempt_count: int = 0
    error_code: str | None = None
    next_attempt_at: str | None = None
    updated_at: str | None = None


def analysis_idempotency_fingerprint(
    article: ArticleDocument,
    *,
    model_id: str,
    prompt_version: str,
    schema_version: int,
    approval_lineage: Mapping[str, Any] | None = None,
) -> str:
    """Return a body-free, deterministic identity for one analysis request.

    The body itself is never included in the fingerprint. Its SHA-256 is the
    stable content binding, while the approval fingerprint makes an otherwise
    identical article under a different reviewed dataset a distinct request.
    """

    approval = ""
    if approval_lineage:
        approval = str(approval_lineage.get("fingerprint") or "")
        if not approval:
            approval = json.dumps(
                dict(approval_lineage), ensure_ascii=False, sort_keys=True, separators=(",", ":")
            )
    material = {
        "article_id": article.article_id,
        "body_hash": article.body_hash or "",
        "model": model_id,
        "prompt": prompt_version,
        "schema": int(schema_version),
        "approval": approval,
    }
    serialized = json.dumps(material, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


def coerce_analysis_state(value: str | AnalysisState | None) -> AnalysisState | None:
    if value is None:
        return None
    try:
        return value if isinstance(value, AnalysisState) else AnalysisState(value)
    except ValueError as error:
        raise ValueError(f"Invalid analysis state: {value!r}.") from error


def assert_state_transition(
    previous: str | AnalysisState | None,
    current: str | AnalysisState,
) -> AnalysisState:
    previous_state = coerce_analysis_state(previous)
    current_state = coerce_analysis_state(current)
    assert current_state is not None
    allowed = _ALLOWED_TRANSITIONS[previous_state]
    if current_state not in allowed:
        previous_value = previous_state.value if previous_state else "none"
        raise ValueError(
            f"Invalid analysis state transition: {previous_value} -> {current_state.value}."
        )
    return current_state


def max_total_attempts(per_call_attempts: int) -> int:
    """Bound batch re-drive attempts without allowing an unbounded loop."""

    bounded = max(1, min(int(per_call_attempts), 3))
    return bounded * MAX_BATCH_REDRIVE_ROUNDS


def utc_now_iso() -> str:
    # Kept here so stores and tests use one serializable representation.
    from datetime import UTC

    return datetime.now(UTC).isoformat()
