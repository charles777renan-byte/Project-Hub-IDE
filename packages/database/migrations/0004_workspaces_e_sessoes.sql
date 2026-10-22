CREATE TABLE `terminal_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`provider` text NOT NULL,
	`title` text NOT NULL,
	`created_at` text NOT NULL,
	`closed_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`layout` text NOT NULL,
	`is_open` integer DEFAULT 0 NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`last_active_at` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspaces_project_id_unique` ON `workspaces` (`project_id`);