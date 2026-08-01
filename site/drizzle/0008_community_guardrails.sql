CREATE TABLE `community_comments` (
  `id` text PRIMARY KEY NOT NULL,
  `issue_id` text NOT NULL,
  `parent_id` text,
  `actor_hash` text NOT NULL,
  `display_name` text NOT NULL,
  `body` text NOT NULL,
  `status` text DEFAULT 'published' NOT NULL CHECK (`status` IN ('published', 'pending', 'hidden')),
  `report_count` integer DEFAULT 0 NOT NULL CHECK (`report_count` >= 0),
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`parent_id`) REFERENCES `community_comments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `community_comments_issue_status_created_idx` ON `community_comments` (`issue_id`, `status`, `created_at`);
--> statement-breakpoint
CREATE TABLE `community_reports` (
  `id` text PRIMARY KEY NOT NULL,
  `comment_id` text NOT NULL,
  `reporter_hash` text NOT NULL,
  `reason` text NOT NULL CHECK (length(`reason`) <= 200),
  `status` text DEFAULT 'open' NOT NULL CHECK (`status` IN ('open', 'reviewed', 'dismissed')),
  `created_at` integer NOT NULL,
  FOREIGN KEY (`comment_id`) REFERENCES `community_comments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `community_reports_comment_reporter_uq` ON `community_reports` (`comment_id`, `reporter_hash`);
--> statement-breakpoint
CREATE INDEX `community_reports_status_created_idx` ON `community_reports` (`status`, `created_at`);
--> statement-breakpoint
CREATE TABLE `community_rate_limits` (
  `actor_hash` text NOT NULL,
  `window_start` integer NOT NULL,
  `comment_count` integer DEFAULT 0 NOT NULL,
  `report_count` integer DEFAULT 0 NOT NULL,
  `updated_at` integer NOT NULL,
  PRIMARY KEY (`actor_hash`, `window_start`)
);
--> statement-breakpoint
CREATE INDEX `community_rate_limits_updated_idx` ON `community_rate_limits` (`updated_at`);
