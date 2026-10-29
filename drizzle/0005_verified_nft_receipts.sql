DROP INDEX `nft_transaction_unique`;--> statement-breakpoint
CREATE UNIQUE INDEX `nft_transaction_unique` ON `nft_intents` (`transaction_hash`) WHERE "nft_intents"."status" = 'confirmed';