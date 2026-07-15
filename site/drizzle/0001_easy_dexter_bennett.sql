CREATE TABLE `ai_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`issue_id` text NOT NULL,
	`summary` text NOT NULL,
	`missing_perspective` text NOT NULL,
	`caution` text NOT NULL,
	`provider` text NOT NULL,
	`model_version` text NOT NULL,
	`generated_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_reports_issue_uq` ON `ai_reports` (`issue_id`);--> statement-breakpoint
CREATE TABLE `analysis_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`target_date` text NOT NULL,
	`provider` text NOT NULL,
	`model_version` text NOT NULL,
	`status` text NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`article_count` integer DEFAULT 0 NOT NULL,
	`issue_count` integer DEFAULT 0 NOT NULL,
	`error_message` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `analysis_runs_target_date_idx` ON `analysis_runs` (`target_date`,`finished_at`);--> statement-breakpoint
CREATE INDEX `analysis_runs_status_idx` ON `analysis_runs` (`status`);--> statement-breakpoint
CREATE TABLE `frame_analyses` (
	`id` text PRIMARY KEY NOT NULL,
	`issue_id` text NOT NULL,
	`frame` text NOT NULL,
	`score` real NOT NULL,
	`confidence` integer NOT NULL,
	`evidence_text` text,
	`article_id` text,
	`source_id` text,
	`provider` text NOT NULL,
	`model_version` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`article_id`) REFERENCES `articles`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`source_id`) REFERENCES `media_sources`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `frame_analyses_issue_frame_uq` ON `frame_analyses` (`issue_id`,`frame`);--> statement-breakpoint
CREATE INDEX `frame_analyses_article_idx` ON `frame_analyses` (`article_id`);--> statement-breakpoint
CREATE TABLE `issue_articles` (
	`id` text PRIMARY KEY NOT NULL,
	`issue_id` text NOT NULL,
	`article_id` text NOT NULL,
	`similarity` real NOT NULL,
	`representative` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`article_id`) REFERENCES `articles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `issue_articles_issue_article_uq` ON `issue_articles` (`issue_id`,`article_id`);--> statement-breakpoint
CREATE INDEX `issue_articles_article_idx` ON `issue_articles` (`article_id`);--> statement-breakpoint
CREATE TABLE `issues` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`issue_date` text NOT NULL,
	`title` text NOT NULL,
	`summary` text NOT NULL,
	`category` text NOT NULL,
	`article_count` integer NOT NULL,
	`source_count` integer NOT NULL,
	`agenda_score` real NOT NULL,
	`diversity_score` real NOT NULL,
	`placement_score` real NOT NULL,
	`volume_score` real NOT NULL,
	`repetition_score` real NOT NULL,
	`confidence` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `analysis_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `issues_run_score_idx` ON `issues` (`run_id`,`agenda_score`);--> statement-breakpoint
CREATE INDEX `issues_date_category_idx` ON `issues` (`issue_date`,`category`);