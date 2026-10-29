CREATE TABLE `nft_intents` (
	`id` text PRIMARY KEY NOT NULL,
	`wallet` text NOT NULL,
	`kind` text NOT NULL,
	`payload` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`transaction` text NOT NULL,
	`summary` text NOT NULL,
	`preview` text,
	`preview_request_id` text,
	`preview_expires_at` integer,
	`transaction_hash` text,
	`order_id` text,
	`error` text,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`approved_at` integer,
	`finished_at` integer
);
--> statement-breakpoint
CREATE INDEX `nft_intent_wallet` ON `nft_intents` (`wallet`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `nft_transaction_unique` ON `nft_intents` (`transaction_hash`);