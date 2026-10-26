CREATE TABLE `admin_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `game_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
