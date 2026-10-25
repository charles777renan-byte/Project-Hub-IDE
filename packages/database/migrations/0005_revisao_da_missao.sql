PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_missions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`title` text NOT NULL,
	`objective` text NOT NULL,
	`context` text,
	`status` text NOT NULL,
	`priority` text NOT NULL,
	`agent_profile_id` text NOT NULL,
	`execution_profile_id` text NOT NULL,
	`alters_code` integer DEFAULT 0 NOT NULL,
	`worktree_id` text,
	`worktree_path` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`started_at` text,
	`finished_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "missions_status_check" CHECK("__new_missions"."status" IN ('draft', 'planned', 'queued', 'running', 'waiting_approval', 'waiting_input', 'paused', 'review', 'succeeded', 'failed', 'cancelled')),
	CONSTRAINT "missions_priority_check" CHECK("__new_missions"."priority" IN ('low', 'normal', 'high'))
);
--> statement-breakpoint
INSERT INTO `__new_missions`("id", "project_id", "title", "objective", "context", "status", "priority", "agent_profile_id", "execution_profile_id", "alters_code", "worktree_id", "worktree_path", "created_at", "updated_at", "started_at", "finished_at") SELECT "id", "project_id", "title", "objective", "context", "status", "priority", "agent_profile_id", "execution_profile_id", "alters_code", "worktree_id", "worktree_path", "created_at", "updated_at", "started_at", "finished_at" FROM `missions`;--> statement-breakpoint
DROP TABLE `missions`;--> statement-breakpoint
ALTER TABLE `__new_missions` RENAME TO `missions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `missions_project_status_updated_idx` ON `missions` (`project_id`,`status`,`updated_at`);