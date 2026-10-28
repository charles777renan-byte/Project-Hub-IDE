PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_mission_steps` (
	`id` text PRIMARY KEY NOT NULL,
	`mission_id` text NOT NULL,
	`position` integer NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`depends_on` text NOT NULL,
	`role` text,
	`agent` text DEFAULT 'claude-code' NOT NULL,
	`started_at` text,
	`finished_at` text,
	FOREIGN KEY (`mission_id`) REFERENCES `missions`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "mission_steps_role_check" CHECK("__new_mission_steps"."role" IS NULL OR "__new_mission_steps"."role" IN ('frontend', 'backend', 'database', 'docs', 'qa', 'general')),
	CONSTRAINT "mission_steps_agent_check" CHECK("__new_mission_steps"."agent" IN ('claude-code')),
	CONSTRAINT "mission_steps_kind_check" CHECK("__new_mission_steps"."kind" IN ('analysis', 'code', 'command', 'test', 'review', 'custom')),
	CONSTRAINT "mission_steps_status_check" CHECK("__new_mission_steps"."status" IN ('pending', 'running', 'blocked', 'succeeded', 'failed', 'skipped'))
);
--> statement-breakpoint
INSERT INTO `__new_mission_steps`("id", "mission_id", "position", "title", "description", "kind", "status", "depends_on", "role", "agent", "started_at", "finished_at") SELECT "id", "mission_id", "position", "title", "description", "kind", "status", "depends_on", "role", 'claude-code', "started_at", "finished_at" FROM `mission_steps`;--> statement-breakpoint
DROP TABLE `mission_steps`;--> statement-breakpoint
ALTER TABLE `__new_mission_steps` RENAME TO `mission_steps`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `mission_steps_position_unique` ON `mission_steps` (`mission_id`,`position`);