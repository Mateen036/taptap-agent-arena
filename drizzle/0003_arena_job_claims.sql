ALTER TABLE `agent_jobs` ADD `started_at` integer;--> statement-breakpoint
ALTER TABLE `arena_matches` ADD `creator_strategy` text DEFAULT 'balanced' NOT NULL;