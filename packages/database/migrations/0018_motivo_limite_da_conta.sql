PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_executions` (
	`id` text PRIMARY KEY NOT NULL,
	`mission_id` text NOT NULL,
	`attempt` integer NOT NULL,
	`step_id` text,
	`status` text NOT NULL,
	`agent_session_id` text,
	`agent_cursor` text,
	`exit_reason` text,
	`usage` text,
	`context` text,
	`started_at` text,
	`finished_at` text,
	FOREIGN KEY (`mission_id`) REFERENCES `missions`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "executions_status_check" CHECK("__new_executions"."status" IN ('queued', 'running', 'paused', 'succeeded', 'failed', 'cancelled')),
	CONSTRAINT "executions_exit_reason_check" CHECK("__new_executions"."exit_reason" IS NULL OR "__new_executions"."exit_reason" IN ('completed', 'agent_failed', 'approval_rejected', 'cancelled_by_user', 'interrupted_by_restart', 'account_limit'))
);
--> statement-breakpoint
INSERT INTO `__new_executions`("id", "mission_id", "attempt", "step_id", "status", "agent_session_id", "agent_cursor", "exit_reason", "usage", "context", "started_at", "finished_at") SELECT "id", "mission_id", "attempt", "step_id", "status", "agent_session_id", "agent_cursor", "exit_reason", "usage", "context", "started_at", "finished_at" FROM `executions`;--> statement-breakpoint
DROP TABLE `executions`;--> statement-breakpoint
ALTER TABLE `__new_executions` RENAME TO `executions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `executions_attempt_unique` ON `executions` (`mission_id`,`attempt`);