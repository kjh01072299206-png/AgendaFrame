from __future__ import annotations

from pathlib import Path

import yaml

from crawler.models import RightsLevel, SourcePolicy


class SourcePolicyRegistry:
    def __init__(self, policies: dict[str, SourcePolicy], policy_version: str) -> None:
        self._policies = policies
        self.policy_version = policy_version

    @classmethod
    def from_yaml(cls, path: str | Path) -> SourcePolicyRegistry:
        payload = yaml.safe_load(Path(path).read_text(encoding="utf-8"))
        if payload.get("schema_version") != 1:
            raise ValueError("Unsupported source-policy schema version.")
        policies: dict[str, SourcePolicy] = {}
        for item in payload.get("sources", []):
            policy = SourcePolicy(
                source_id=item["id"],
                display_name=item["display_name"],
                domains=tuple(domain.lower() for domain in item["domains"]),
                rights_level=RightsLevel(item["rights_level"]),
                permission_status=item["permission_status"],
                body_retention_until=item.get("body_retention_until"),
            )
            policies[policy.source_id] = policy
        return cls(policies, payload["policy_version"])

    def require(self, source_id: str) -> SourcePolicy:
        try:
            return self._policies[source_id]
        except KeyError as error:
            raise ValueError(f"Unregistered source: {source_id}") from error

    def all(self) -> tuple[SourcePolicy, ...]:
        return tuple(self._policies.values())
