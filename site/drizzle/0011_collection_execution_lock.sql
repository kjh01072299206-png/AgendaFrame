CREATE TABLE `collection_execution_locks` (
  `name` text PRIMARY KEY NOT NULL,
  `owner` text NOT NULL,
  `lease_token` text NOT NULL,
  `lease_expires_at` integer NOT NULL,
  `acquired_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  CHECK (`name` = 'collection')
);
