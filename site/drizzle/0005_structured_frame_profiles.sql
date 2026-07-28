CREATE TABLE `article_frame_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`article_id` text NOT NULL,
	`body_hash` text,
	`body_characters` integer,
	`profile_json` text DEFAULT '{}' NOT NULL,
	`status` text NOT NULL,
	`failure_code` text,
	`extractor_version` text NOT NULL,
	`provider` text NOT NULL,
	`model_version` text NOT NULL,
	`prompt_version` text NOT NULL,
	`schema_version` text NOT NULL,
	`review_status` text DEFAULT 'automatic_draft' NOT NULL,
	`analyzed_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`article_id`) REFERENCES `articles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `article_frame_profiles_article_versions_uq` ON `article_frame_profiles` (`article_id`,`extractor_version`,`model_version`,`schema_version`);
--> statement-breakpoint
CREATE INDEX `article_frame_profiles_status_idx` ON `article_frame_profiles` (`status`,`analyzed_at`);
--> statement-breakpoint
CREATE INDEX `article_frame_profiles_article_idx` ON `article_frame_profiles` (`article_id`,`analyzed_at`);
--> statement-breakpoint
CREATE TABLE `issue_frame_comparisons` (
	`id` text PRIMARY KEY NOT NULL,
	`issue_id` text NOT NULL,
	`comparison_json` text NOT NULL,
	`profile_count` integer DEFAULT 0 NOT NULL,
	`analyzed_article_count` integer DEFAULT 0 NOT NULL,
	`provider` text NOT NULL,
	`model_version` text NOT NULL,
	`schema_version` text NOT NULL,
	`generated_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `issue_frame_comparisons_issue_uq` ON `issue_frame_comparisons` (`issue_id`);
--> statement-breakpoint
CREATE INDEX `issue_frame_comparisons_generated_at_idx` ON `issue_frame_comparisons` (`generated_at`);
