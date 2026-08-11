ALTER TABLE `community_comments` ADD COLUMN `reader_type` text;
--> statement-breakpoint
ALTER TABLE `community_comments` ADD COLUMN `screen` text;
--> statement-breakpoint
CREATE TABLE `community_reactions` (
  `comment_id` text NOT NULL,
  `actor_hash` text NOT NULL,
  `created_at` integer NOT NULL,
  PRIMARY KEY(`comment_id`, `actor_hash`),
  FOREIGN KEY (`comment_id`) REFERENCES `community_comments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `community_reactions_comment_idx` ON `community_reactions` (`comment_id`);
--> statement-breakpoint
CREATE TABLE `self_check_results` (
  `actor_hash` text PRIMARY KEY NOT NULL,
  `answers_json` text NOT NULL,
  `type_code` text NOT NULL,
  `scores_json` text NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `self_check_results_updated_idx` ON `self_check_results` (`updated_at`);
