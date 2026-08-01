CREATE TABLE `durable_jobs` (
  `id` text PRIMARY KEY NOT NULL,
  `queue` text NOT NULL,
  `job_type` text NOT NULL,
  `unique_key` text NOT NULL,
  `payload_json` text NOT NULL,
  `status` text NOT NULL CHECK (`status` IN ('queued', 'running', 'retry_wait', 'succeeded', 'dead_lettered', 'cancelled')),
  `priority` integer DEFAULT 0 NOT NULL,
  `available_at` integer NOT NULL,
  `attempt_count` integer DEFAULT 0 NOT NULL CHECK (`attempt_count` >= 0),
  `max_attempts` integer NOT NULL CHECK (`max_attempts` > 0),
  `lease_owner` text,
  `lease_token` text,
  `lease_expires_at` integer,
  `checkpoint_json` text,
  `checkpoint_version` integer DEFAULT 0 NOT NULL CHECK (`checkpoint_version` >= 0),
  `failure_code` text,
  `dead_letter_id` text,
  `started_at` integer,
  `completed_at` integer,
  `created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
  `updated_at` integer NOT NULL,
  CONSTRAINT `durable_jobs_lease_state_ck` CHECK (
    (`status` = 'running' AND `lease_owner` IS NOT NULL AND `lease_token` IS NOT NULL AND `lease_expires_at` IS NOT NULL)
    OR (`status` <> 'running' AND `lease_owner` IS NULL AND `lease_token` IS NULL AND `lease_expires_at` IS NULL)
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX `durable_jobs_queue_type_key_uq` ON `durable_jobs` (`queue`, `job_type`, `unique_key`);
--> statement-breakpoint
CREATE INDEX `durable_jobs_due_idx` ON `durable_jobs` (`queue`, `status`, `available_at`, `priority` DESC);
--> statement-breakpoint
CREATE INDEX `durable_jobs_expired_lease_idx` ON `durable_jobs` (`status`, `lease_expires_at`) WHERE `status` = 'running';
--> statement-breakpoint
CREATE TABLE `durable_job_dead_letters` (
  `id` text PRIMARY KEY NOT NULL,
  `job_id` text NOT NULL,
  `queue` text NOT NULL,
  `job_type` text NOT NULL,
  `reason_code` text NOT NULL,
  `attempt_count` integer NOT NULL,
  `checkpoint_version` integer NOT NULL,
  `dead_lettered_at` integer NOT NULL,
  `redriven_at` integer,
  `redriven_by` text,
  FOREIGN KEY (`job_id`) REFERENCES `durable_jobs`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `durable_job_dead_letters_job_idx` ON `durable_job_dead_letters` (`job_id`, `dead_lettered_at` DESC);
--> statement-breakpoint
CREATE INDEX `durable_job_dead_letters_open_idx` ON `durable_job_dead_letters` (`dead_lettered_at`) WHERE `redriven_at` IS NULL;
--> statement-breakpoint
CREATE TABLE `publication_outbox_events` (
  `id` text PRIMARY KEY NOT NULL,
  `destination` text NOT NULL,
  `aggregate_type` text NOT NULL,
  `aggregate_id` text NOT NULL,
  `aggregate_version` integer NOT NULL CHECK (`aggregate_version` >= 1),
  `event_type` text NOT NULL,
  `payload` text NOT NULL,
  `payload_hash` text NOT NULL CHECK (length(`payload_hash`) = 64 AND `payload_hash` NOT GLOB '*[^0-9a-f]*'),
  `idempotency_key` text NOT NULL,
  `status` text DEFAULT 'pending' NOT NULL CHECK (`status` IN ('pending', 'claimed', 'delivered', 'terminal')),
  `attempt_count` integer DEFAULT 0 NOT NULL CHECK (`attempt_count` >= 0),
  `available_at` integer NOT NULL,
  `claim_token` text,
  `claimed_by` text,
  `lease_expires_at` integer,
  `last_error_code` text,
  `last_error_at` integer,
  `delivered_at` integer,
  `created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
  `updated_at` integer NOT NULL,
  CONSTRAINT `publication_outbox_claim_state_ck` CHECK (
    (`status` = 'claimed' AND `claim_token` IS NOT NULL AND `claimed_by` IS NOT NULL AND `lease_expires_at` IS NOT NULL)
    OR (`status` <> 'claimed' AND `claim_token` IS NULL AND `claimed_by` IS NULL AND `lease_expires_at` IS NULL)
  ),
  CONSTRAINT `publication_outbox_delivery_state_ck` CHECK (
    (`status` = 'delivered' AND `delivered_at` IS NOT NULL)
    OR (`status` <> 'delivered' AND `delivered_at` IS NULL)
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX `publication_outbox_destination_idempotency_uq` ON `publication_outbox_events` (`destination`, `idempotency_key`);
--> statement-breakpoint
CREATE UNIQUE INDEX `publication_outbox_aggregate_version_uq` ON `publication_outbox_events` (`destination`, `aggregate_type`, `aggregate_id`, `aggregate_version`);
--> statement-breakpoint
CREATE INDEX `publication_outbox_due_idx` ON `publication_outbox_events` (`destination`, `status`, `available_at`, `created_at`, `id`);
--> statement-breakpoint
CREATE INDEX `publication_outbox_lease_idx` ON `publication_outbox_events` (`status`, `lease_expires_at`);
--> statement-breakpoint
CREATE TABLE `publication_delivery_receipts` (
  `id` text PRIMARY KEY NOT NULL,
  `event_id` text NOT NULL,
  `destination` text NOT NULL,
  `idempotency_key` text NOT NULL,
  `payload_hash` text NOT NULL CHECK (length(`payload_hash`) = 64 AND `payload_hash` NOT GLOB '*[^0-9a-f]*'),
  `claim_token` text,
  `claimed_by` text,
  `destination_receipt_id` text,
  `delivered_at` integer NOT NULL,
  `created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
  `source` text NOT NULL CHECK (`source` IN ('delivery', 'reconciled')),
  CONSTRAINT `publication_receipts_delivery_claim_ck` CHECK (
    `source` = 'reconciled' OR (`claim_token` IS NOT NULL AND `claimed_by` IS NOT NULL)
  ),
  FOREIGN KEY (`event_id`) REFERENCES `publication_outbox_events`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `publication_receipts_destination_idempotency_uq` ON `publication_delivery_receipts` (`destination`, `idempotency_key`);
--> statement-breakpoint
CREATE UNIQUE INDEX `publication_receipts_event_uq` ON `publication_delivery_receipts` (`event_id`);
--> statement-breakpoint
CREATE INDEX `publication_receipts_event_idx` ON `publication_delivery_receipts` (`event_id`);