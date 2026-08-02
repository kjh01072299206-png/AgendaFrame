from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime
from typing import Any

from ai.framing import FrameResult
from backend.analysis_state import (
    AnalysisState,
    assert_state_transition,
    utc_now_iso,
)
from backend.config import RuntimeConfig
from backend.publisher import public_profile
from crawler.models import ArticleDocument


def _result_state(result: FrameResult) -> AnalysisState:
    if result.analysis_state:
        return AnalysisState(result.analysis_state)
    return AnalysisState.SUCCEEDED if result.decision == "analyze" else AnalysisState.REVIEW_NEEDED


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
        current_state = self.current_state(analysis_key)
        if current_state is AnalysisState.SUCCEEDED:
            return True
        query = f"""
            SELECT 1
            FROM `{self.config.project_id}.{self.config.dataset}.frame_analyses`
            WHERE (
                analysis_key = @analysis_key
                OR STARTS_WITH(analysis_key, CONCAT(@analysis_key, "|retry:"))
            )
              AND analyzed_at >= TIMESTAMP("2026-01-01")
              AND decision = "analyze"
            LIMIT 1
        """
        job_config = self.bigquery.QueryJobConfig(
            query_parameters=[
                self.bigquery.ScalarQueryParameter("analysis_key", "STRING", analysis_key)
            ],
            maximum_bytes_billed=self.config.maximum_bytes_billed,
        )
        return next(iter(self.bq.query(query, job_config=job_config).result()), None) is not None

    def current_state(self, analysis_key: str) -> AnalysisState | None:
        query = f"""
            SELECT analysis_state
            FROM `{self.config.project_id}.{self.config.dataset}.analysis_states`
            WHERE updated_at >= TIMESTAMP("2026-01-01")
              AND idempotency_fingerprint = @analysis_key
            ORDER BY updated_at DESC
            LIMIT 1
        """
        job_config = self.bigquery.QueryJobConfig(
            query_parameters=[
                self.bigquery.ScalarQueryParameter("analysis_key", "STRING", analysis_key)
            ],
            maximum_bytes_billed=self.config.maximum_bytes_billed,
        )
        try:
            row = next(iter(self.bq.query(query, job_config=job_config).result()), None)
        except Exception as error:
            # A pre-migration deployment has no state table yet. The legacy
            # frame row remains the fallback for the success check, while a
            # live pilot will fail its schema preflight before model calls.
            if "analysis_states" not in str(error):
                raise
            return None
        if not row or not row["analysis_state"]:
            return None
        return AnalysisState(str(row["analysis_state"]))

    def attempt_count(self, analysis_key: str) -> int:
        query = f"""
            SELECT attempt_count
            FROM `{self.config.project_id}.{self.config.dataset}.analysis_states`
            WHERE updated_at >= TIMESTAMP("2026-01-01")
              AND idempotency_fingerprint = @analysis_key
            ORDER BY updated_at DESC
            LIMIT 1
        """
        job_config = self.bigquery.QueryJobConfig(
            query_parameters=[
                self.bigquery.ScalarQueryParameter("analysis_key", "STRING", analysis_key)
            ],
            maximum_bytes_billed=self.config.maximum_bytes_billed,
        )
        try:
            row = next(iter(self.bq.query(query, job_config=job_config).result()), None)
        except Exception as error:
            if "analysis_states" not in str(error):
                raise
            return 0
        return int(row["attempt_count"] or 0) if row else 0

    def mark_state(
        self,
        analysis_key: str,
        article_id: str,
        state: AnalysisState,
        *,
        attempt_count: int,
        error_code: str | None = None,
        next_attempt_at: str | None = None,
    ) -> None:
        previous = self.current_state(analysis_key)
        assert_state_transition(previous, state)
        if attempt_count < 0:
            raise ValueError("Analysis attempt count cannot be negative.")
        query = f"""
            MERGE `{self.config.project_id}.{self.config.dataset}.analysis_states` AS target
            USING (
              SELECT
                @idempotency_fingerprint AS idempotency_fingerprint,
                @article_id AS article_id,
                @analysis_state AS analysis_state,
                @attempt_count AS attempt_count,
                @error_code AS error_code,
                @next_attempt_at AS next_attempt_at,
                @updated_at AS updated_at
            ) AS incoming
            ON target.idempotency_fingerprint = incoming.idempotency_fingerprint
              AND target.updated_at >= TIMESTAMP("2026-01-01")
            WHEN MATCHED THEN UPDATE SET
              article_id = incoming.article_id,
              analysis_state = incoming.analysis_state,
              attempt_count = incoming.attempt_count,
              error_code = incoming.error_code,
              next_attempt_at = incoming.next_attempt_at,
              updated_at = incoming.updated_at
            WHEN NOT MATCHED THEN INSERT (
              idempotency_fingerprint,
              article_id,
              analysis_state,
              attempt_count,
              error_code,
              next_attempt_at,
              updated_at
            ) VALUES (
              incoming.idempotency_fingerprint,
              incoming.article_id,
              incoming.analysis_state,
              incoming.attempt_count,
              incoming.error_code,
              incoming.next_attempt_at,
              incoming.updated_at
            )
        """
        job_config = self.bigquery.QueryJobConfig(
            query_parameters=[
                self.bigquery.ScalarQueryParameter(
                    "idempotency_fingerprint", "STRING", analysis_key
                ),
                self.bigquery.ScalarQueryParameter("article_id", "STRING", article_id),
                self.bigquery.ScalarQueryParameter("analysis_state", "STRING", state.value),
                self.bigquery.ScalarQueryParameter("attempt_count", "INT64", attempt_count),
                self.bigquery.ScalarQueryParameter("error_code", "STRING", error_code),
                self.bigquery.ScalarQueryParameter("next_attempt_at", "TIMESTAMP", next_attempt_at),
                self.bigquery.ScalarQueryParameter("updated_at", "TIMESTAMP", utc_now_iso()),
            ],
            maximum_bytes_billed=self.config.maximum_bytes_billed,
        )
        self.bq.query(query, job_config=job_config).result()

    def status_summary(
        self,
        *,
        article_ids: list[str],
        target_date: str,
    ) -> dict[str, Any]:
        query = f"""
            SELECT analysis_state, COUNT(*) AS count
            FROM `{self.config.project_id}.{self.config.dataset}.analysis_states`
            WHERE updated_at >= TIMESTAMP("2026-01-01")
              AND DATE(updated_at, "Asia/Seoul") >= DATE(@target_date)
              AND DATE(updated_at, "Asia/Seoul") < DATE_ADD(DATE(@target_date), INTERVAL 1 DAY)
              AND article_id IN UNNEST(@article_ids)
            GROUP BY analysis_state
            ORDER BY analysis_state
        """
        job_config = self.bigquery.QueryJobConfig(
            query_parameters=[
                self.bigquery.ScalarQueryParameter("target_date", "STRING", target_date),
                self.bigquery.ArrayQueryParameter("article_ids", "STRING", article_ids),
            ],
            maximum_bytes_billed=self.config.maximum_bytes_billed,
        )
        rows = self.bq.query(query, job_config=job_config).result()
        counts = {state.value: 0 for state in AnalysisState}
        for row in rows:
            state = str(row["analysis_state"])
            if state in counts:
                counts[state] = int(row["count"])
        return {"target_date": target_date, "article_count": len(article_ids), "states": counts}

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
            # BigQuery's JSON column accepts a JSON document string through
            # insert_rows_json. Passing the Python dict makes the REST client
            # treat it as a RECORD and fails with "profile_json is not a
            # record" against the deployed JSON schema.
            "profile_json": json.dumps(public_profile(article, result), ensure_ascii=False),
            "model_id": result.model_id,
            "prompt_version": result.prompt_version,
            "schema_version": result.schema_version,
            "input_tokens": result.input_tokens,
            "output_tokens": result.output_tokens,
            "review_status": "automatic_draft",
            "publication_status": "pending",
            "analyzed_at": datetime.now(UTC).isoformat(),
        }
        if self._update_pending_analysis(analysis_row):
            self.mark_state(
                result.idempotency_fingerprint or analysis_key,
                article.article_id,
                _result_state(result),
                attempt_count=result.attempt_count,
                error_code=result.error_code,
            )
            return
        self._insert_json("frame_analyses", analysis_row, str(analysis_row["analysis_key"]))
        self.mark_state(
            result.idempotency_fingerprint or analysis_key,
            article.article_id,
            _result_state(result),
            attempt_count=result.attempt_count,
            error_code=result.error_code,
        )

    def _update_pending_analysis(self, row: dict[str, Any]) -> bool:
        """Replace a prior review-needed draft when a bounded retry succeeds."""

        query = f"""
            UPDATE `{self.config.project_id}.{self.config.dataset}.frame_analyses`
            SET
              article_id = @article_id,
              decision = @decision,
              profile_json = PARSE_JSON(@profile_json),
              model_id = @model_id,
              prompt_version = @prompt_version,
              schema_version = @schema_version,
              input_tokens = @input_tokens,
              output_tokens = @output_tokens,
              review_status = @review_status,
              publication_status = @publication_status,
              published_at = NULL,
              analyzed_at = @analyzed_at
            WHERE analysis_key = @analysis_key
              AND publication_status = "pending"
              AND analyzed_at >= TIMESTAMP("2026-01-01")
        """
        job_config = self.bigquery.QueryJobConfig(
            query_parameters=[
                self.bigquery.ScalarQueryParameter("analysis_key", "STRING", row["analysis_key"]),
                self.bigquery.ScalarQueryParameter("article_id", "STRING", row["article_id"]),
                self.bigquery.ScalarQueryParameter("decision", "STRING", row["decision"]),
                self.bigquery.ScalarQueryParameter("profile_json", "STRING", row["profile_json"]),
                self.bigquery.ScalarQueryParameter("model_id", "STRING", row["model_id"]),
                self.bigquery.ScalarQueryParameter(
                    "prompt_version", "STRING", row["prompt_version"]
                ),
                self.bigquery.ScalarQueryParameter(
                    "schema_version", "INT64", row["schema_version"]
                ),
                self.bigquery.ScalarQueryParameter("input_tokens", "INT64", row["input_tokens"]),
                self.bigquery.ScalarQueryParameter("output_tokens", "INT64", row["output_tokens"]),
                self.bigquery.ScalarQueryParameter("review_status", "STRING", row["review_status"]),
                self.bigquery.ScalarQueryParameter(
                    "publication_status", "STRING", row["publication_status"]
                ),
                self.bigquery.ScalarQueryParameter("analyzed_at", "TIMESTAMP", row["analyzed_at"]),
            ],
            maximum_bytes_billed=self.config.maximum_bytes_billed,
        )
        try:
            result = self.bq.query(query, job_config=job_config).result()
        except Exception as error:
            if "streaming buffer" not in str(error).lower():
                raise
            # BigQuery cannot update a row that is still in the streaming
            # buffer. Keep the failed draft for audit and write this successful
            # retry under a deterministic successor key instead.
            row["analysis_key"] = (
                f"{row['analysis_key']}|retry:"
                f"{hashlib.sha256(str(row['profile_json']).encode('utf-8')).hexdigest()[:16]}"
            )
            return False
        return bool(getattr(result, "num_dml_affected_rows", 0))

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
              AND f.decision = "analyze"
              AND f.publication_status = "pending"
              AND (
                @target_date IS NULL
                OR DATE(a.published_at, "Asia/Seoul") = DATE(@target_date)
              )
              AND (
                ARRAY_LENGTH(@article_ids) = 0
                OR f.article_id IN UNNEST(@article_ids)
              )
            QUALIFY ROW_NUMBER() OVER (
                PARTITION BY f.article_id
                ORDER BY f.analyzed_at DESC
            ) = 1
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
