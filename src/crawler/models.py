from __future__ import annotations

import hashlib
import ipaddress
from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

TRACKING_QUERY_PREFIXES = ("utm_",)
TRACKING_QUERY_NAMES = {"fbclid", "gclid", "ref", "source"}


class RightsLevel(StrEnum):
    METADATA_ONLY = "metadata_only"
    TRANSIENT_ANALYSIS = "transient_analysis"
    RETAINED_AUTHORIZED = "retained_authorized"
    BLOCKED = "blocked"


@dataclass(frozen=True)
class SourcePolicy:
    source_id: str
    display_name: str
    domains: tuple[str, ...]
    rights_level: RightsLevel
    permission_status: str
    body_retention_until: str | None = None

    @property
    def body_processing_allowed(self) -> bool:
        return self.rights_level in {
            RightsLevel.TRANSIENT_ANALYSIS,
            RightsLevel.RETAINED_AUTHORIZED,
        }

    @property
    def body_retention_allowed(self) -> bool:
        return self.rights_level is RightsLevel.RETAINED_AUTHORIZED


@dataclass(frozen=True)
class ArticleDocument:
    article_id: str
    source_id: str
    canonical_url: str
    title: str
    published_at: datetime
    collected_at: datetime
    section: str | None
    body_text: str | None
    text_scope: str
    title_source: str = "unknown"

    @property
    def body_hash(self) -> str | None:
        if self.body_text is None:
            return None
        return hashlib.sha256(self.body_text.encode("utf-8")).hexdigest()

    def analysis_key(self, analysis_version: str) -> str:
        source_hash = self.body_hash or hashlib.sha256(self.title.encode("utf-8")).hexdigest()
        return f"{self.canonical_url}|{source_hash}|{analysis_version}"


def canonicalize_url(value: str) -> str:
    parsed = urlsplit(value.strip())
    if parsed.scheme.lower() != "https" or not parsed.hostname:
        raise ValueError("Only public HTTPS article URLs are accepted.")
    validate_public_hostname(parsed.hostname)
    query = [
        (key, item)
        for key, item in parse_qsl(parsed.query, keep_blank_values=True)
        if key.lower() not in TRACKING_QUERY_NAMES
        and not key.lower().startswith(TRACKING_QUERY_PREFIXES)
    ]
    host = parsed.hostname.lower()
    if parsed.port and parsed.port != 443:
        host = f"{host}:{parsed.port}"
    path = parsed.path or "/"
    return urlunsplit(("https", host, path, urlencode(query), ""))


def validate_public_hostname(hostname: str) -> None:
    lowered = hostname.rstrip(".").lower()
    if lowered in {"localhost", "metadata.google.internal"}:
        raise ValueError("Local and cloud metadata hosts are blocked.")
    try:
        address = ipaddress.ip_address(lowered)
    except ValueError:
        return
    if not address.is_global:
        raise ValueError("Private, loopback, and link-local addresses are blocked.")


def is_domain_allowed(hostname: str, allowed_domains: tuple[str, ...]) -> bool:
    lowered = hostname.rstrip(".").lower()
    return any(lowered == domain or lowered.endswith(f".{domain}") for domain in allowed_domains)
