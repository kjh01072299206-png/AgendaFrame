-- Table-scoped BigQuery grants for AgendaFrame service accounts.
--
-- Why this file exists separately from schema.sql:
--   * A GRANT fails if the grantee principal does not exist yet, so these
--     statements must run after the service accounts are created. schema.sql
--     runs before that step in scripts/gcp/provision.ps1.
--   * Keeping the grants out of schema.sql leaves that file purely structural.
--
-- Why table scope instead of a project-wide role:
--   The publisher only has to flip frame_analyses.publication_status to
--   "published" after a successful site import. It already holds project-level
--   roles/bigquery.dataViewer for the read side (pending_publication_rows joins
--   articles), so a project-wide dataEditor would grant write and delete on
--   every table in the project for the sake of one UPDATE on one table.
--
-- Without this grant, GcpAnalysisStore.mark_published() fails with a permission
-- error *after* the site import has already succeeded, leaving the site
-- populated while BigQuery still reports publication_status = "pending".
--
-- Resource types supported by BigQuery DCL: SCHEMA, TABLE, VIEW,
-- EXTERNAL TABLE, PROJECT.

GRANT `roles/bigquery.dataEditor`
ON TABLE `project-40bc06fc-fb4b-46b6-a10.agendaframe.frame_analyses`
TO "serviceAccount:publisher@project-40bc06fc-fb4b-46b6-a10.iam.gserviceaccount.com";
