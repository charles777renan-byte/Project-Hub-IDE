CREATE TABLE `browser_tabs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`url` text NOT NULL,
	`title` text NOT NULL,
	`position` integer NOT NULL,
	`is_active` integer NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `browser_tabs_project_idx` ON `browser_tabs` (`project_id`);