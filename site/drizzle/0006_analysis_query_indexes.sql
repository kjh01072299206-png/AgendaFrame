CREATE INDEX IF NOT EXISTS `articles_published_at_id_idx`
ON `articles` (`published_at`, `id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `article_body_signals_analysis_lookup_idx`
ON `article_body_signals` (`taxonomy_version`, `status`, `article_id`, `analyzed_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `article_frame_profiles_analysis_lookup_idx`
ON `article_frame_profiles` (`model_version`, `schema_version`, `status`, `article_id`, `analyzed_at`);
