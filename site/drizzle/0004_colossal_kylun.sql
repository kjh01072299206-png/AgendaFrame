CREATE TABLE `article_body_signals` (
	`id` text PRIMARY KEY NOT NULL,
	`article_id` text NOT NULL,
	`body_hash` text,
	`body_characters` integer,
	`detected_frames` text DEFAULT '[]' NOT NULL,
	`status` text NOT NULL,
	`failure_code` text,
	`extractor_version` text NOT NULL,
	`taxonomy_version` text NOT NULL,
	`analyzed_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`article_id`) REFERENCES `articles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `article_body_signals_article_versions_uq` ON `article_body_signals` (`article_id`,`extractor_version`,`taxonomy_version`);--> statement-breakpoint
CREATE INDEX `article_body_signals_status_idx` ON `article_body_signals` (`status`,`analyzed_at`);