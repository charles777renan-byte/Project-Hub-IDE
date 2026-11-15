CREATE TABLE `project_previews` (
	`project_id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`package_manager` text,
	`script` text,
	`script_body` text,
	`fixed_url` text,
	`last_url` text,
	`terminal_id` text,
	`static_port` integer,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
