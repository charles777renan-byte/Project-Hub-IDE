CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`name` text NOT NULL,
	`created_at` text NOT NULL,
	`removed_at` text,
	CONSTRAINT "accounts_provider_check" CHECK("accounts"."provider" IN ('claude', 'codex', 'github'))
);
--> statement-breakpoint
CREATE INDEX `accounts_provider_idx` ON `accounts` (`provider`);