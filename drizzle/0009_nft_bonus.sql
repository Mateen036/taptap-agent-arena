CREATE TABLE `nft_bonus_claims` (
	`token_id` integer PRIMARY KEY NOT NULL,
	`wallet` text NOT NULL,
	`agent` text NOT NULL,
	`amount` integer NOT NULL,
	`claimed_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `nft_bonus_wallet` ON `nft_bonus_claims` (`wallet`);