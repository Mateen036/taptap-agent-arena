CREATE TABLE `airdrop_conversions` (
	`id` text PRIMARY KEY NOT NULL,
	`wallet` text NOT NULL,
	`season` integer NOT NULL,
	`delta_points` text NOT NULL,
	`cumulative_points` text NOT NULL,
	`base_converted` text NOT NULL,
	`deadline` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`paid_points` text,
	`refund_points` text,
	`signature` text NOT NULL,
	`created_at` integer NOT NULL,
	`settled_at` integer
);
--> statement-breakpoint
CREATE INDEX `airdrop_wallet` ON `airdrop_conversions` (`wallet`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `airdrop_one_pending` ON `airdrop_conversions` (`wallet`,`season`) WHERE "airdrop_conversions"."status" = 'pending';