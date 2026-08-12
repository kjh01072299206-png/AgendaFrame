-- PostgreSQL/Cloud SQL metadata contract for AgendaFrame.
--
-- This file is deliberately body-free.  Article bodies stay in the private
-- Cloud Storage bucket until the configured 2026-10-31 KST expiry.  Public
-- payloads contain only structured claims, locators, hashes, and URLs.
-- Applying this file is an external operation and is not performed by tests.

CREATE TABLE IF NOT EXISTS collection_runs (
  run_id TEXT PRIMARY KEY,
  basis_date DATE NOT NULL,
  source_policy_version TEXT NOT NULL,
  scheduled_at TIMESTAMPTZ NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed', 'quarantined')),
  discovered_article_count INTEGER NOT NULL DEFAULT 0 CHECK (discovered_article_count >= 0),
  analyzed_article_count INTEGER NOT NULL DEFAULT 0 CHECK (analyzed_article_count >= 0),
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS article_metadata (
  article_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES collection_runs(run_id),
  source_id TEXT NOT NULL,
  canonical_url TEXT NOT NULL,
  title TEXT NOT NULL,
  published_at TIMESTAMPTZ NOT NULL,
  collected_at TIMESTAMPTZ NOT NULL,
  body_sha256 CHAR(64),
  private_body_object TEXT,
  body_expires_at TIMESTAMPTZ NOT NULL DEFAULT '2026-10-31 14:59:59+00',
  text_scope TEXT NOT NULL,
  UNIQUE (source_id, canonical_url, published_at)
);

CREATE TABLE IF NOT EXISTS issue_candidates (
  issue_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES collection_runs(run_id),
  issue_rank INTEGER NOT NULL CHECK (issue_rank >= 1),
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  article_count INTEGER NOT NULL CHECK (article_count >= 0),
  source_count INTEGER NOT NULL CHECK (source_count >= 0),
  agenda_score NUMERIC(12, 4) NOT NULL,
  clustering_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS issue_articles (
  issue_id TEXT NOT NULL REFERENCES issue_candidates(issue_id),
  article_id TEXT NOT NULL REFERENCES article_metadata(article_id),
  similarity NUMERIC(8, 6),
  representative BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (issue_id, article_id)
);

CREATE TABLE IF NOT EXISTS semantic_profiles (
  profile_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES collection_runs(run_id),
  issue_id TEXT NOT NULL REFERENCES issue_candidates(issue_id),
  article_id TEXT NOT NULL REFERENCES article_metadata(article_id),
  analysis_state TEXT NOT NULL CHECK (analysis_state IN ('queued', 'running', 'succeeded', 'review_needed', 'dead_letter')),
  model_revision TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  public_profile JSONB NOT NULL,
  evidence_locator JSONB NOT NULL,
  evidence_sha256 CHAR(64),
  analyzed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (
    public_profile::TEXT NOT ILIKE '%body_text%'
    AND public_profile::TEXT NOT ILIKE '%raw_body%'
    AND public_profile::TEXT NOT ILIKE '%sentence_text%'
    AND public_profile::TEXT NOT ILIKE '%prompt_payload%'
    AND public_profile::TEXT NOT ILIKE '%evidence_text%'
  )
);

CREATE TABLE IF NOT EXISTS quality_gate_results (
  gate_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES collection_runs(run_id),
  status TEXT NOT NULL CHECK (status IN ('pass', 'fail', 'quarantined')),
  top_issue_count INTEGER NOT NULL CHECK (top_issue_count >= 0 AND top_issue_count <= 5),
  analyzed_article_count INTEGER NOT NULL CHECK (analyzed_article_count >= 0),
  unsupported_claim_rate NUMERIC(8, 6) NOT NULL CHECK (unsupported_claim_rate >= 0 AND unsupported_claim_rate <= 1),
  evidence_lineage_complete BOOLEAN NOT NULL,
  raw_body_absent BOOLEAN NOT NULL,
  evaluated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public_snapshots (
  snapshot_id CHAR(32) PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES collection_runs(run_id),
  basis_date DATE NOT NULL,
  object_prefix TEXT NOT NULL UNIQUE,
  manifest_object TEXT NOT NULL UNIQUE,
  manifest_sha256 CHAR(64) NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('candidate', 'published', 'superseded', 'quarantined')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  published_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS snapshot_objects (
  snapshot_id CHAR(32) NOT NULL REFERENCES public_snapshots(snapshot_id),
  object_name TEXT NOT NULL,
  object_sha256 CHAR(64) NOT NULL,
  public_json JSONB NOT NULL,
  PRIMARY KEY (snapshot_id, object_name),
  CHECK (
    public_json::TEXT NOT ILIKE '%body_text%'
    AND public_json::TEXT NOT ILIKE '%raw_body%'
    AND public_json::TEXT NOT ILIKE '%sentence_text%'
    AND public_json::TEXT NOT ILIKE '%prompt_payload%'
    AND public_json::TEXT NOT ILIKE '%evidence_text%'
  )
);

-- Exactly one row is the active pointer.  The publisher writes immutable
-- objects first and updates this row last in a transaction.
CREATE TABLE IF NOT EXISTS active_snapshot_pointer (
  pointer_id SMALLINT PRIMARY KEY CHECK (pointer_id = 1),
  snapshot_id CHAR(32) NOT NULL REFERENCES public_snapshots(snapshot_id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS one_published_snapshot_pointer
  ON public_snapshots (status)
  WHERE status = 'published';

CREATE INDEX IF NOT EXISTS article_metadata_expiry_idx
  ON article_metadata (body_expires_at)
  WHERE private_body_object IS NOT NULL;

CREATE INDEX IF NOT EXISTS semantic_profiles_issue_idx
  ON semantic_profiles (issue_id, analysis_state);
