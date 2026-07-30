CREATE SCHEMA IF NOT EXISTS `project-40bc06fc-fb4b-46b6-a10.agendaframe`
OPTIONS(location="asia-northeast3");

CREATE TABLE IF NOT EXISTS `project-40bc06fc-fb4b-46b6-a10.agendaframe.collection_runs` (
  run_id STRING NOT NULL,
  started_at TIMESTAMP NOT NULL,
  finished_at TIMESTAMP,
  status STRING NOT NULL,
  discovered_articles INT64 NOT NULL,
  analyzed_articles INT64 NOT NULL,
  estimated_cost_usd FLOAT64,
  source_policy_version STRING NOT NULL,
  code_version STRING NOT NULL
)
PARTITION BY DATE(started_at)
OPTIONS(require_partition_filter=TRUE);

CREATE TABLE IF NOT EXISTS `project-40bc06fc-fb4b-46b6-a10.agendaframe.articles` (
  article_id STRING NOT NULL,
  source_id STRING NOT NULL,
  canonical_url STRING NOT NULL,
  title STRING NOT NULL,
  published_at TIMESTAMP NOT NULL,
  collected_at TIMESTAMP NOT NULL,
  section STRING,
  body_hash STRING,
  body_object STRING,
  text_scope STRING NOT NULL
)
PARTITION BY DATE(published_at)
CLUSTER BY source_id, article_id
OPTIONS(require_partition_filter=TRUE);

CREATE TABLE IF NOT EXISTS `project-40bc06fc-fb4b-46b6-a10.agendaframe.homepage_observations` (
  observation_id STRING NOT NULL,
  article_id STRING NOT NULL,
  source_id STRING NOT NULL,
  observed_at TIMESTAMP NOT NULL,
  placement_zone STRING NOT NULL,
  placement_rank INT64,
  selector_version STRING NOT NULL
)
PARTITION BY DATE(observed_at)
CLUSTER BY source_id, article_id
OPTIONS(require_partition_filter=TRUE);

CREATE TABLE IF NOT EXISTS `project-40bc06fc-fb4b-46b6-a10.agendaframe.frame_analyses` (
  analysis_key STRING NOT NULL,
  article_id STRING NOT NULL,
  decision STRING NOT NULL,
  profile_json JSON NOT NULL,
  model_id STRING NOT NULL,
  prompt_version STRING NOT NULL,
  schema_version INT64 NOT NULL,
  input_tokens INT64,
  output_tokens INT64,
  review_status STRING NOT NULL,
  publication_status STRING NOT NULL,
  published_at TIMESTAMP,
  analyzed_at TIMESTAMP NOT NULL
)
PARTITION BY DATE(analyzed_at)
CLUSTER BY article_id, prompt_version
OPTIONS(require_partition_filter=TRUE);

CREATE TABLE IF NOT EXISTS `project-40bc06fc-fb4b-46b6-a10.agendaframe.daily_usage` (
  usage_date DATE NOT NULL,
  service STRING NOT NULL,
  operation STRING NOT NULL,
  article_count INT64 NOT NULL,
  input_tokens INT64,
  output_tokens INT64,
  estimated_cost_usd FLOAT64 NOT NULL,
  recorded_at TIMESTAMP NOT NULL
)
PARTITION BY usage_date
CLUSTER BY service, operation
OPTIONS(require_partition_filter=TRUE);
