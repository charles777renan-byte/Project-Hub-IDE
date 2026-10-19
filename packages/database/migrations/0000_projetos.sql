CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`path` text NOT NULL,
	`normalized_path` text NOT NULL,
	`description` text,
	`repository_kind` text NOT NULL,
	`default_branch` text,
	`is_favorite` integer DEFAULT 0 NOT NULL,
	`trusted` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`last_opened_at` text,
	`removed_at` text,
	CONSTRAINT "projects_repository_kind_check" CHECK("projects"."repository_kind" IN ('git', 'none'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_normalized_path_unique` ON `projects` (`normalized_path`);