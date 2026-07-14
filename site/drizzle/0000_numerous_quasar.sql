CREATE TABLE `articles` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`external_id` text NOT NULL,
	`source_id` text NOT NULL,
	`title` text NOT NULL,
	`canonical_url` text NOT NULL,
	`section` text,
	`published_at` integer,
	`collected_at` integer NOT NULL,
	`homepage_placement` text,
	`homepage_rank` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `media_sources`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `articles_provider_external_id_uq` ON `articles` (`provider`,`external_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `articles_canonical_url_uq` ON `articles` (`canonical_url`);--> statement-breakpoint
CREATE INDEX `articles_source_published_at_idx` ON `articles` (`source_id`,`published_at`);--> statement-breakpoint
CREATE INDEX `articles_collected_at_idx` ON `articles` (`collected_at`);--> statement-breakpoint
CREATE TABLE `collection_errors` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`source_id` text,
	`code` text NOT NULL,
	`message` text NOT NULL,
	`occurred_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `collection_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `media_sources`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `collection_errors_run_idx` ON `collection_errors` (`run_id`);--> statement-breakpoint
CREATE TABLE `collection_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`trigger` text NOT NULL,
	`status` text NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`article_count` integer DEFAULT 0 NOT NULL,
	`duplicate_count` integer DEFAULT 0 NOT NULL,
	`error_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `collection_runs_started_at_idx` ON `collection_runs` (`started_at`);--> statement-breakpoint
CREATE TABLE `collection_source_results` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`source_id` text NOT NULL,
	`status` text NOT NULL,
	`article_count` integer DEFAULT 0 NOT NULL,
	`duplicate_count` integer DEFAULT 0 NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `collection_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `media_sources`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `collection_source_results_run_source_uq` ON `collection_source_results` (`run_id`,`source_id`);--> statement-breakpoint
CREATE INDEX `collection_source_results_source_idx` ON `collection_source_results` (`source_id`);--> statement-breakpoint
CREATE TABLE `media_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`provider` text NOT NULL,
	`provider_outlet_name` text NOT NULL,
	`sample_position` text NOT NULL,
	`sample_order` integer NOT NULL,
	`source_type` text NOT NULL,
	`active` integer DEFAULT false NOT NULL,
	`activation_state` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `media_sources_name_uq` ON `media_sources` (`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `media_sources_provider_name_uq` ON `media_sources` (`provider`,`provider_outlet_name`);--> statement-breakpoint
CREATE INDEX `media_sources_sample_order_idx` ON `media_sources` (`sample_order`);--> statement-breakpoint
INSERT OR IGNORE INTO `media_sources`
	(`id`, `name`, `provider`, `provider_outlet_name`, `sample_position`, `sample_order`, `source_type`, `active`, `activation_state`)
VALUES
	('hani', '한겨레', 'manual_csv', '한겨레', 'progressive', -2, 'national_daily', 1, 'ready_for_admin_import'),
	('khan', '경향신문', 'manual_csv', '경향신문', 'progressive', -1, 'national_daily', 1, 'ready_for_admin_import'),
	('hankookilbo', '한국일보', 'manual_csv', '한국일보', 'center', 0, 'national_daily', 1, 'ready_for_admin_import'),
	('joongang', '중앙일보', 'manual_csv', '중앙일보', 'conservative', 1, 'national_daily', 1, 'ready_for_admin_import'),
	('chosun', '조선일보', 'manual_csv', '조선일보', 'conservative', 2, 'national_daily', 1, 'ready_for_admin_import');
