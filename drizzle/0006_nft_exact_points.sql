ALTER TABLE `agents` ADD `points_exact` text;--> statement-breakpoint
ALTER TABLE `agents` ADD `earned_exact` text;--> statement-breakpoint
ALTER TABLE `commands` ADD `earned_exact` text;--> statement-breakpoint
ALTER TABLE `ledger` ADD `delta_exact` text;
--> statement-breakpoint
INSERT INTO game_settings(key,value) SELECT 'season_phase_v2',value FROM game_settings WHERE key='season_phase' ON CONFLICT(key) DO NOTHING;
