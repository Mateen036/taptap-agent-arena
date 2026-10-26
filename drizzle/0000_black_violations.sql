CREATE TABLE `agents` (
	`wallet` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`points` integer DEFAULT 0 NOT NULL,
	`earned` integer DEFAULT 0 NOT NULL,
	`taps` integer DEFAULT 0 NOT NULL,
	`runs` integer DEFAULT 0 NOT NULL,
	`energy` integer DEFAULT 1000 NOT NULL,
	`power_level` integer DEFAULT 1 NOT NULL,
	`tank_level` integer DEFAULT 1 NOT NULL,
	`speed_level` integer DEFAULT 1 NOT NULL,
	`updated_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`last_event` text,
	`connected` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_user_unique` ON `agents` (`user_id`);--> statement-breakpoint
CREATE TABLE `challenges` (
	`id` text PRIMARY KEY NOT NULL,
	`pairing_hash` text NOT NULL,
	`wallet` text NOT NULL,
	`session_key` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `challenge_pair` ON `challenges` (`pairing_hash`);--> statement-breakpoint
CREATE TABLE `mission_claims` (
	`id` text PRIMARY KEY NOT NULL,
	`wallet` text NOT NULL,
	`mission` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mission_wallet_unique` ON `mission_claims` (`wallet`,`mission`);--> statement-breakpoint
CREATE TABLE `commands` (
	`id` text PRIMARY KEY NOT NULL,
	`wallet` text NOT NULL,
	`prompt` text NOT NULL,
	`target` integer NOT NULL,
	`done` integer DEFAULT 0 NOT NULL,
	`earned` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`created_at` integer NOT NULL,
	`started_at` integer,
	`last_tick` integer,
	`finished_at` integer
);
--> statement-breakpoint
CREATE INDEX `command_wallet` ON `commands` (`wallet`,`created_at`);--> statement-breakpoint
CREATE TABLE `reward_epochs` (
	`id` integer PRIMARY KEY NOT NULL,
	`root` text NOT NULL,
	`contract` text NOT NULL,
	`token` text NOT NULL,
	`chain_id` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ledger` (
	`id` text PRIMARY KEY NOT NULL,
	`wallet` text NOT NULL,
	`kind` text NOT NULL,
	`delta` integer NOT NULL,
	`detail` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ledger_wallet` ON `ledger` (`wallet`,`created_at`);--> statement-breakpoint
CREATE TABLE `pairings` (
	`code_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `pairing_user` ON `pairings` (`user_id`);--> statement-breakpoint
CREATE TABLE `reward_proofs` (
	`id` text PRIMARY KEY NOT NULL,
	`wallet` text NOT NULL,
	`epoch` integer NOT NULL,
	`amount` text NOT NULL,
	`proof` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `proof_wallet` ON `reward_proofs` (`wallet`,`epoch`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`wallet` text NOT NULL,
	`session_key` text NOT NULL,
	`expires_at` integer NOT NULL,
	`nonce` integer DEFAULT 0 NOT NULL,
	`revoked` integer DEFAULT 0 NOT NULL,
	`verified_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `session_wallet` ON `sessions` (`wallet`);