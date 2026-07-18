CREATE TABLE `article_contents` (
	`id` text PRIMARY KEY NOT NULL,
	`article_id` text NOT NULL,
	`object_key` text NOT NULL,
	`body_hash` text NOT NULL,
	`body_characters` integer NOT NULL,
	`acquired_at` integer NOT NULL,
	`acquisition_method` text NOT NULL,
	`usage_basis` text NOT NULL,
	`usage_expires_at` integer,
	`analysis_allowed` integer DEFAULT false NOT NULL,
	`public_evidence_allowed` integer DEFAULT false NOT NULL,
	`extractor_version` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`article_id`) REFERENCES `articles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `article_contents_article_hash_uq` ON `article_contents` (`article_id`,`body_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `article_contents_object_key_uq` ON `article_contents` (`object_key`);--> statement-breakpoint
CREATE INDEX `article_contents_article_status_idx` ON `article_contents` (`article_id`,`status`,`acquired_at`);--> statement-breakpoint
CREATE TABLE `homepage_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`homepage_url` text NOT NULL,
	`observed_at` integer NOT NULL,
	`viewport_width` integer NOT NULL,
	`viewport_height` integer NOT NULL,
	`collector_version` text NOT NULL,
	`capture_hash` text,
	`screenshot_object_key` text,
	`status` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `media_sources`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `homepage_snapshots_source_observed_viewport_uq` ON `homepage_snapshots` (`source_id`,`observed_at`,`viewport_width`,`viewport_height`);--> statement-breakpoint
CREATE INDEX `homepage_snapshots_observed_at_idx` ON `homepage_snapshots` (`observed_at`);--> statement-breakpoint
CREATE TABLE `placement_observations` (
	`id` text PRIMARY KEY NOT NULL,
	`snapshot_id` text NOT NULL,
	`article_id` text,
	`canonical_url` text NOT NULL,
	`observed_title` text NOT NULL,
	`zone` text NOT NULL,
	`page_rank` integer NOT NULL,
	`x` integer NOT NULL,
	`y` integer NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`above_fold` integer NOT NULL,
	`module_name` text,
	`match_method` text NOT NULL,
	`match_confidence` real NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`snapshot_id`) REFERENCES `homepage_snapshots`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`article_id`) REFERENCES `articles`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `placement_observations_snapshot_url_position_uq` ON `placement_observations` (`snapshot_id`,`canonical_url`,`x`,`y`);--> statement-breakpoint
CREATE INDEX `placement_observations_article_idx` ON `placement_observations` (`article_id`);--> statement-breakpoint
CREATE INDEX `placement_observations_snapshot_rank_idx` ON `placement_observations` (`snapshot_id`,`page_rank`);--> statement-breakpoint
ALTER TABLE `frame_analyses` ADD `evidence_basis` text DEFAULT 'headline' NOT NULL;--> statement-breakpoint
ALTER TABLE `frame_analyses` ADD `evidence_start` integer;--> statement-breakpoint
ALTER TABLE `frame_analyses` ADD `evidence_end` integer;--> statement-breakpoint
ALTER TABLE `frame_analyses` ADD `content_version_id` text REFERENCES article_contents(id);