CREATE TABLE `bounty_reports` (
	`submission_id` text PRIMARY KEY NOT NULL,
	`bounty_id` text NOT NULL,
	`hunter` text NOT NULL,
	`report_hash` text NOT NULL,
	`iv` text NOT NULL,
	`ciphertext` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `bounty_report_hunter` ON `bounty_reports` (`hunter`,`created_at`);--> statement-breakpoint
CREATE INDEX `bounty_report_bounty` ON `bounty_reports` (`bounty_id`);--> statement-breakpoint
CREATE TABLE `bounty_scopes` (
	`bounty_id` text PRIMARY KEY NOT NULL,
	`creator` text NOT NULL,
	`scope_hash` text NOT NULL,
	`text` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `bounty_scope_creator` ON `bounty_scopes` (`creator`,`created_at`);