CREATE TABLE `article_collection_attempts` (
  `article_id` text PRIMARY KEY NOT NULL,
  `source_id` text NOT NULL,
  `attempt_count` integer NOT NULL DEFAULT 0,
  `next_attempt_at` integer NOT NULL,
  `last_failure_code` text NOT NULL,
  `last_http_status` integer,
  `status` text NOT NULL CHECK (`status` IN ('retry_wait', 'terminal')),
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`article_id`) REFERENCES `articles`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`source_id`) REFERENCES `media_sources`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `article_collection_attempts_due_idx`
  ON `article_collection_attempts` (`status`, `next_attempt_at`, `source_id`);
