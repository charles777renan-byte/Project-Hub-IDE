CREATE TABLE `account_secrets` (
	`account_id` text PRIMARY KEY NOT NULL,
	`ciphertext` blob NOT NULL,
	`last4` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "account_secrets_last4_check" CHECK(length("account_secrets"."last4") = 4)
);
--> statement-breakpoint
CREATE TABLE `vault_meta` (
	`id` integer PRIMARY KEY NOT NULL,
	`salt` blob NOT NULL,
	`verifier` blob NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT "vault_meta_single_check" CHECK("vault_meta"."id" = 1)
);
--> statement-breakpoint
ALTER TABLE `accounts` ADD `kind` text DEFAULT 'subscription' NOT NULL CONSTRAINT "accounts_kind_check" CHECK("kind" IN ('subscription', 'api'));