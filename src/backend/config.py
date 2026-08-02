from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import yaml


@dataclass(frozen=True)
class VertexLimits:
    location: str
    model: str
    prompt_version: str
    schema_version: int
    max_articles_per_run: int
    max_articles_per_day: int
    max_input_characters_per_article: int
    max_output_tokens: int
    max_attempts: int
    thinking_budget: int
    input_usd_per_million_tokens: float
    output_usd_per_million_tokens: float


@dataclass(frozen=True)
class RuntimeConfig:
    project_id: str
    region: str
    dataset: str
    bucket: str
    delete_all_bodies_on: str
    maximum_bytes_billed: int
    estimated_daily_vertex_limit_usd: float
    vertex: VertexLimits
    publication_endpoint_path: str

    @classmethod
    def from_yaml(cls, path: str | Path) -> RuntimeConfig:
        payload = yaml.safe_load(Path(path).read_text(encoding="utf-8"))
        if payload.get("schema_version") != 1:
            raise ValueError("Unsupported runtime schema version.")
        vertex = payload["vertex"]
        return cls(
            project_id=payload["project_id"],
            region=payload["region"],
            dataset=payload["bigquery"]["dataset"],
            bucket=payload["storage"]["private_body_bucket"],
            delete_all_bodies_on=payload["storage"]["delete_all_bodies_on"],
            maximum_bytes_billed=int(payload["bigquery"]["maximum_bytes_billed"]),
            estimated_daily_vertex_limit_usd=float(
                payload["cost_controls"]["estimated_daily_vertex_limit_usd"]
            ),
            vertex=VertexLimits(
                location=vertex["location"],
                model=vertex["model"],
                prompt_version=vertex["prompt_version"],
                schema_version=int(vertex["schema_version"]),
                max_articles_per_run=int(vertex["max_articles_per_run"]),
                max_articles_per_day=int(vertex["max_articles_per_day"]),
                max_input_characters_per_article=int(vertex["max_input_characters_per_article"]),
                max_output_tokens=int(vertex["max_output_tokens"]),
                max_attempts=int(vertex["max_attempts"]),
                thinking_budget=int(vertex["thinking_budget"]),
                input_usd_per_million_tokens=float(
                    vertex["estimated_input_usd_per_million_tokens"]
                ),
                output_usd_per_million_tokens=float(
                    vertex["estimated_output_usd_per_million_tokens"]
                ),
            ),
            publication_endpoint_path=payload["publication"]["endpoint_path"],
        )
