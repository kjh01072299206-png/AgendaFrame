from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Any

from ai.framing import FrameResult
from backend.config import RuntimeConfig
from backend.publisher import public_profile
from crawler.models import ArticleDocument


class GcpAnalysisStore:
    """BigQuery metadata/results plus private Cloud Storage for authorized bodies."""

    def __init__(self, config: RuntimeConfig) -> None:
        from google.cloud import bigquery, storage

        self.config = config
        self.bigquery = bigquery
        self.bq = bigquery.Client(project=config.project_id, location=config.region)
        self.storage = storage.Client(project=config.project_id)
        self.bucket = self.storage.bucket(config.bucket)

    def already_analyzed(self, analysis_key: str) -> bool:
        query = f"""
            SELECT 1
            FROM `{self.config.project_id}.{self.config.dataset}.frame_analyses`
            WHERE analysis_key = @analysis_key
              AND analyzed_at >= TIMESTAMP("2026-01-01")
            LIMIT 1
        """
        job_config = self.bigquery.QueryJobConfig(
            query_parameters=[
                self.bigquery.ScalarQueryParameter("analysis_key", "STRING", analysis_key)
            ],
            maximum_bytes_billed=self.config.maximum_bytes_billed,
        )
        return next(iter(self.bq.query(query, job_config=job_config).result()), None) is not None

    def analyzed_today_count(self) -> int:
        # `frame_analyses` is PARTITION BY DATE(analyzed_at) with
        # require_partition_filter=TRUE. A `DATE(analyzed_at, "Asia/Seoul")`
        # predicate cannot be used for partition elimination, so the timezone
        # comparison alone is rejected before any model call happens. Bound the
        # raw partitioning column as well. The 2-day window is deliberate: the
        # KST day (UTC+9) straddles two UTC partitions, so a tighter bound would
        # drop rows analyzed earlier on the same Seoul day.
        query = f"""
            SELECT COUNT(*) AS count
            FROM `{self.config.project_id}.{self.config.dataset}.frame_analyses`
            WHERE analyzed_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 2 DAY)
              AND DATE(analyzed_at, "Asia/Seoul") = CURRENT_DATE("Asia/Seoul")
        """
        job_config = self.bigquery.QueryJobConfig(
            maximum_bytes_billed=self.config.maximum_bytes_billed,
        )
        row = next(iter(self.bq.query(query, job_config=job_config).result()), None)
        return int(row["count"]) if row else 0

    def save_result(
        self,
        article: ArticleDocument,
        result: FrameResult,
        analysis_key: str,
        retain_body: bool,
        delete_on: str,
    ) -> None:
        body_object = None
        if retain_body and article.body_text:
            body_object = self._store_private_body(article, delete_on)

        article_row = {
            "article_id": article.article_id,
            "source_id": article.source_id,
            "canonical_url": article.canonical_url,
            "title": article.title,
            "published_at": article.published_at.isoformat(),
            "collected_at": article.collected_at.isoformat(),
            "section": article.section,
            "body_hash": article.body_hash,
            "body_object": body_object,
            "text_scope": article.text_scope,
        }
        self._insert_json("articles", article_row, article.article_id)

        analysis_row: dict[str, Any] = {
            "analysis_key": analysis_key,
            "article_id": article.article_id,
            "decision": result.decision,
            "profile_json": public_profile(article, result),
            "model_id": result.model_id,
            "prompt_version": result.prompt_version,
            "schema_version": result.schema_version,
            "input_tokens": result.input_tokens,
            "output_tokens": result.output_tokens,
            "review_status": "automatic_draft",
            "publication_status": "pending",
            "analyzed_at": datetime.now(UTC).isoformat(),
        }
        self._insert_json("frame_analyses", analysis_row, analysis_key)

    def pending_publication_rows(
        self,
        limit: int,
        *,
        target_date: str | None = None,
        article_ids: list[str] | None = None,
    ) -> list[dict[str, Any]]:
        selected_article_ids = article_ids or []
        query = f"""
            SELECT
              f.analysis_key,
              f.profile_json,
              a.article_id,
              a.source_id,
              a.canonical_url,
              a.title,
              a.published_at,
              a.collected_at,
              a.section,
              a.body_hash,
              a.text_scope
            FROM `{self.config.project_id}.{self.config.dataset}.frame_analyses` f
            JOIN `{self.config.project_id}.{self.config.dataset}.articles` a
              ON a.article_id = f.article_id
              AND a.published_at >= TIMESTAMP("2026-01-01")
            WHERE f.analyzed_at >= TIMESTAMP("2026-01-01")
              AND f.publication_status = "pending"
              AND (
                @target_date IS NULL
                OR DATE(a.published_at, "Asia/Seoul") = DATE(@target_date)
              )
              AND (
                ARRAY_LENGTH(@article_ids) = 0
                OR f.article_id IN UNNEST(@article_ids)
              )
            ORDER BY f.analyzed_at ASC
            LIMIT @limit
        """
        job_config = self.bigquery.QueryJobConfig(
            query_parameters=[
                self.bigquery.ScalarQueryParameter("limit", "INT64", limit),
                self.bigquery.ScalarQueryParameter("target_date", "STRING", target_date),
                self.bigquery.ArrayQueryParameter(
                    "article_ids",
                    "STRING",
                    selected_article_ids,
                ),
            ],
            maximum_bytes_billed=self.config.maximum_bytes_billed,
        )
        rows = []
        for row in self.bq.query(query, job_config=job_config).result():
            profile = row["profile_json"]
            if isinstance(profile, str):
                profile = json.loads(profile)
            rows.append(
                {
                    "analysis_key": row["analysis_key"],
                    "article": {
                        "article_id": row["article_id"],
                        "source_id": row["source_id"],
                        "canonical_url": row["canonical_url"],
                        "title": row["title"],
                        "published_at": row["published_at"].isoformat(),
                        "collected_at": row["collected_at"].isoformat(),
                        "section": row["section"],
                        "text_scope": row["text_scope"],
                        "body_hash": row["body_hash"],
                        "body_characters": profile["article"]["body_character_count"],
                    },
                    "profile": profile,
                }
            )
        return rows

    def mark_published(self, analysis_keys: list[str]) -> None:
        if not analysis_keys:
            return
        query = f"""
            UPDATE `{self.config.project_id}.{self.config.dataset}.frame_analyses`
            SET publication_status = "published", published_at = CURRENT_TIMESTAMP()
            WHERE analyzed_at >= TIMESTAMP("2026-01-01")
              AND analysis_key IN UNNEST(@analysis_keys)
        """
        job_config = self.bigquery.QueryJobConfig(
            query_parameters=[
                self.bigquery.ArrayQueryParameter("analysis_keys", "STRING", analysis_keys)
            ],
            maximum_bytes_billed=self.config.maximum_bytes_billed,
        )
        self.bq.query(query, job_config=job_config).result()

    def _store_private_body(self, article: ArticleDocument, delete_on: str) -> str:
        delete_at = datetime.fromisoformat(f"{delete_on}T00:00:00+09:00").astimezone(UTC)
        object_name = (
            f"bodies/{article.source_id}/{article.published_at:%Y/%m/%d}/{article.article_id}.txt"
        )
        blob = self.bucket.blob(object_name)
        blob.custom_time = delete_at
        blob.metadata = {
            "article_id": article.article_id,
            "source_id": article.source_id,
            "delete_on": delete_on,
            "body_hash": article.body_hash or "",
        }
        blob.upload_from_string(article.body_text or "", content_type="text/plain; charset=utf-8")
        return f"gs://{self.config.bucket}/{object_name}"

    def _insert_json(self, table: str, row: dict[str, Any], row_id: str) -> None:
        table_id = f"{self.config.project_id}.{self.config.dataset}.{table}"
        errors = self.bq.insert_rows_json(table_id, [row], row_ids=[row_id])
        if errors:
            raise RuntimeError(f"BigQuery insert failed for {table}: {errors}")
