"""Validated twelve-source discovery policy for the GCP collector.

The legacy ``config/source-policies.yaml`` remains the reviewed, metadata-only
policy used by the original batch importer.  The live collection plan is a
separate JSON document because it contains endpoint and schedule information
that the GCP collector must consume.  Keeping the two files separate prevents
an accidental switch from metadata-only processing to body processing.

This module is intentionally offline-only.  It validates the repository
policy and never contacts a publisher or a Google Cloud service.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping

EXPECTED_SOURCE_COUNT = 12
EXPECTED_GENERAL_DAILY_COUNT = 10
EXPECTED_BROADCASTER_COUNT = 2
EXPECTED_SCHEDULED_HOURS_KST = (0, 6, 12, 18)
EXPECTED_TOPICS = ("politics", "economy", "society", "international")


class DiscoveryPolicyError(ValueError):
    """Raised when the GCP discovery contract is not safe to run."""


@dataclass(frozen=True)
class GcpDiscoveryPolicy:
    """The validated, metadata-only portion of the 12-source policy."""

    schema_version: int
    policy_version: str
    collection_start: str
    collection_end: str
    timezone: str
    raw_content_delete_after: str
    topics: tuple[str, ...]
    scheduled_hours_kst: tuple[int, ...]
    interval_minutes: int
    source_count: int
    general_daily_count: int
    broadcaster_count: int
    source_ids: tuple[str, ...]

    @classmethod
    def from_path(cls, path: str | Path) -> "GcpDiscoveryPolicy":
        resolved = Path(path)
        try:
            payload = json.loads(resolved.read_text(encoding="utf-8"))
        except FileNotFoundError as error:
            raise DiscoveryPolicyError(f"discovery policy does not exist: {resolved}") from error
        except json.JSONDecodeError as error:
            raise DiscoveryPolicyError(f"discovery policy is not valid JSON: {resolved}") from error
        if not isinstance(payload, Mapping):
            raise DiscoveryPolicyError("discovery policy root must be an object")
        return cls.from_payload(payload, path=resolved)

    @classmethod
    def from_payload(
        cls,
        payload: Mapping[str, Any],
        *,
        path: str | Path | None = None,
    ) -> "GcpDiscoveryPolicy":
        location = f" in {path}" if path else ""

        def required_mapping(value: object, name: str) -> Mapping[str, Any]:
            if not isinstance(value, Mapping):
                raise DiscoveryPolicyError(f"{name}{location} must be an object")
            return value

        def required_string(value: object, name: str) -> str:
            if not isinstance(value, str) or not value.strip():
                raise DiscoveryPolicyError(f"{name}{location} must be a non-empty string")
            return value.strip()

        schema_version = payload.get("schemaVersion")
        if schema_version != 1:
            raise DiscoveryPolicyError(f"schemaVersion{location} must be 1")
        policy_version = required_string(payload.get("policyVersion"), "policyVersion")

        window = required_mapping(payload.get("collectionWindow"), "collectionWindow")
        collection_start = required_string(window.get("startDate"), "collectionWindow.startDate")
        collection_end = required_string(window.get("endDate"), "collectionWindow.endDate")
        timezone = required_string(window.get("timezone"), "collectionWindow.timezone")
        if timezone != "Asia/Seoul":
            raise DiscoveryPolicyError("collectionWindow.timezone must be Asia/Seoul")
        raw_delete_after = required_string(
            window.get("rawContentDeleteAfter"),
            "collectionWindow.rawContentDeleteAfter",
        )
        if not raw_delete_after.startswith(f"{collection_end}T"):
            raise DiscoveryPolicyError(
                "rawContentDeleteAfter must fall on the collection window end date"
            )

        topics = payload.get("topics")
        if not isinstance(topics, list) or tuple(topics) != EXPECTED_TOPICS:
            raise DiscoveryPolicyError(
                f"topics{location} must be exactly {list(EXPECTED_TOPICS)}"
            )

        polling = required_mapping(payload.get("polling"), "polling")
        scheduled_hours = polling.get("scheduledHoursKst")
        if not isinstance(scheduled_hours, list) or tuple(scheduled_hours) != EXPECTED_SCHEDULED_HOURS_KST:
            raise DiscoveryPolicyError(
                f"polling.scheduledHoursKst{location} must be [0, 6, 12, 18]"
            )
        interval_minutes = polling.get("intervalMinutes")
        if interval_minutes != 360:
            raise DiscoveryPolicyError("polling.intervalMinutes must be 360")
        if polling.get("runsPerDay") != 4:
            raise DiscoveryPolicyError("polling.runsPerDay must be 4")
        if polling.get("concurrency") != 1:
            raise DiscoveryPolicyError("polling.concurrency must remain 1")
        if set(polling.get("stopStatuses", [])) != {403, 429}:
            raise DiscoveryPolicyError("polling.stopStatuses must be [403, 429]")

        sources = payload.get("sources")
        if not isinstance(sources, list):
            raise DiscoveryPolicyError(f"sources{location} must be an array")
        if len(sources) != EXPECTED_SOURCE_COUNT:
            raise DiscoveryPolicyError(
                f"sources{location} must contain exactly {EXPECTED_SOURCE_COUNT} entries"
            )
        source_ids: list[str] = []
        type_counts = {"general_daily": 0, "broadcaster": 0}
        for index, source in enumerate(sources):
            source_mapping = required_mapping(source, f"sources[{index}]")
            source_id = required_string(source_mapping.get("id"), f"sources[{index}].id")
            if source_id in source_ids:
                raise DiscoveryPolicyError(f"duplicate source id: {source_id}")
            source_ids.append(source_id)
            source_type = source_mapping.get("sourceType")
            if source_type not in type_counts:
                raise DiscoveryPolicyError(
                    f"sources[{index}].sourceType must be general_daily or broadcaster"
                )
            type_counts[source_type] += 1
            endpoints = source_mapping.get("endpoints")
            if not isinstance(endpoints, list) or not endpoints:
                raise DiscoveryPolicyError(f"sources[{index}].endpoints must be non-empty")

        if type_counts["general_daily"] != EXPECTED_GENERAL_DAILY_COUNT:
            raise DiscoveryPolicyError("the policy must contain ten general daily newspapers")
        if type_counts["broadcaster"] != EXPECTED_BROADCASTER_COUNT:
            raise DiscoveryPolicyError("the policy must contain KBS and SBS as two broadcasters")

        return cls(
            schema_version=1,
            policy_version=policy_version,
            collection_start=collection_start,
            collection_end=collection_end,
            timezone=timezone,
            raw_content_delete_after=raw_delete_after,
            topics=EXPECTED_TOPICS,
            scheduled_hours_kst=EXPECTED_SCHEDULED_HOURS_KST,
            interval_minutes=interval_minutes,
            source_count=len(sources),
            general_daily_count=type_counts["general_daily"],
            broadcaster_count=type_counts["broadcaster"],
            source_ids=tuple(source_ids),
        )


__all__ = ["DiscoveryPolicyError", "GcpDiscoveryPolicy"]
