ALTER TABLE `missions` ADD `account_id` text REFERENCES accounts(id);--> statement-breakpoint
ALTER TABLE `terminal_sessions` ADD `account_id` text REFERENCES accounts(id);