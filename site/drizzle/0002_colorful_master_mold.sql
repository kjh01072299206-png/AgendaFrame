CREATE TABLE `quality_review_article_flags` (
	`id` text PRIMARY KEY NOT NULL,
	`review_id` text NOT NULL,
	`article_id` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`review_id`) REFERENCES `quality_reviews`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`article_id`) REFERENCES `articles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `quality_review_article_flags_review_article_uq` ON `quality_review_article_flags` (`review_id`,`article_id`);--> statement-breakpoint
CREATE INDEX `quality_review_article_flags_article_idx` ON `quality_review_article_flags` (`article_id`);--> statement-breakpoint
CREATE TABLE `quality_review_missing_articles` (
	`id` text PRIMARY KEY NOT NULL,
	`review_id` text NOT NULL,
	`source_id` text NOT NULL,
	`title` text NOT NULL,
	`canonical_url` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`review_id`) REFERENCES `quality_reviews`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `media_sources`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `quality_review_missing_articles_review_url_uq` ON `quality_review_missing_articles` (`review_id`,`canonical_url`);--> statement-breakpoint
CREATE INDEX `quality_review_missing_articles_source_idx` ON `quality_review_missing_articles` (`source_id`);--> statement-breakpoint
CREATE TABLE `quality_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`issue_id` text NOT NULL,
	`cluster_verdict` text NOT NULL,
	`agenda_verdict` text NOT NULL,
	`frame_verdict` text NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`reviewed_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `quality_reviews_issue_uq` ON `quality_reviews` (`issue_id`);--> statement-breakpoint
CREATE INDEX `quality_reviews_reviewed_at_idx` ON `quality_reviews` (`reviewed_at`);