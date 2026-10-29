CREATE TABLE `agent_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`wallet` text NOT NULL,
	`kind` text NOT NULL,
	`payload` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`error` text,
	`created_at` integer NOT NULL,
	`finished_at` integer
);
--> statement-breakpoint
CREATE INDEX `job_wallet` ON `agent_jobs` (`wallet`,`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `analytics_events` (
	`id` text PRIMARY KEY NOT NULL,
	`day` text NOT NULL,
	`visitor` text NOT NULL,
	`event` text NOT NULL,
	`count` integer DEFAULT 1 NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `analytics_day` ON `analytics_events` (`day`,`event`);--> statement-breakpoint
CREATE TABLE `arena_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`wallet` text NOT NULL,
	`season_id` text NOT NULL,
	`mode` text NOT NULL,
	`daily_day` text,
	`rule_day` text NOT NULL,
	`strategy` text DEFAULT 'balanced' NOT NULL,
	`score` integer DEFAULT 0 NOT NULL,
	`gross` integer DEFAULT 0 NOT NULL,
	`taps` integer DEFAULT 0 NOT NULL,
	`energy` integer DEFAULT 400 NOT NULL,
	`power_level` integer DEFAULT 1 NOT NULL,
	`speed_level` integer DEFAULT 1 NOT NULL,
	`resting` integer DEFAULT 0 NOT NULL,
	`started_at` integer NOT NULL,
	`ends_at` integer NOT NULL,
	`last_tick` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`last_event` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `arena_entry_unique` ON `arena_entries` (`room_id`,`wallet`);--> statement-breakpoint
CREATE UNIQUE INDEX `arena_daily_unique` ON `arena_entries` (`wallet`,`daily_day`);--> statement-breakpoint
CREATE INDEX `arena_wallet` ON `arena_entries` (`wallet`,`ends_at`);--> statement-breakpoint
CREATE INDEX `arena_season` ON `arena_entries` (`season_id`,`mode`,`ends_at`);--> statement-breakpoint
CREATE TABLE `arena_events` (
	`id` text PRIMARY KEY NOT NULL,
	`entry_id` text NOT NULL,
	`wallet` text NOT NULL,
	`kind` text NOT NULL,
	`delta` integer NOT NULL,
	`detail` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `arena_event_entry` ON `arena_events` (`entry_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `arena_matches` (
	`id` text PRIMARY KEY NOT NULL,
	`season_id` text NOT NULL,
	`creator` text NOT NULL,
	`target` text,
	`rule_day` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`parent_id` text,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`started_at` integer,
	`ends_at` integer,
	`version` integer DEFAULT 0 NOT NULL,
	`last_event` text
);
--> statement-breakpoint
CREATE INDEX `match_creator` ON `arena_matches` (`creator`,`created_at`);--> statement-breakpoint
CREATE INDEX `match_status` ON `arena_matches` (`status`,`expires_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `match_rematch_unique` ON `arena_matches` (`parent_id`,`creator`);--> statement-breakpoint
CREATE TABLE `agent_profiles` (
	`wallet` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`bio` text DEFAULT '' NOT NULL,
	`strategy` text DEFAULT 'balanced' NOT NULL,
	`avatar` text DEFAULT 'nib' NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `season_members` (
	`id` text PRIMARY KEY NOT NULL,
	`season_id` text NOT NULL,
	`wallet` text NOT NULL,
	`joined_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `season_member_unique` ON `season_members` (`season_id`,`wallet`);--> statement-breakpoint
CREATE TABLE `season_scores` (
	`id` text PRIMARY KEY NOT NULL,
	`season_id` text NOT NULL,
	`wallet` text NOT NULL,
	`score` integer DEFAULT 0 NOT NULL,
	`taps` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `season_score_unique` ON `season_scores` (`season_id`,`wallet`);--> statement-breakpoint
CREATE TABLE `seasons` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`starts_at` integer NOT NULL,
	`ends_at` integer NOT NULL,
	`capacity` integer DEFAULT 100 NOT NULL,
	`enrolled` integer DEFAULT 0 NOT NULL,
	`last_enroll` text
);
--> statement-breakpoint
ALTER TABLE `pairings` ADD `stage` text DEFAULT 'waiting' NOT NULL;--> statement-breakpoint
ALTER TABLE `pairings` ADD `error_code` text;--> statement-breakpoint
ALTER TABLE `pairings` ADD `reports` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `sessions` ADD `last_seen_at` integer DEFAULT 0 NOT NULL;