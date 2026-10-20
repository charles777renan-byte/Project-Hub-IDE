CREATE TABLE `approval_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`mission_id` text NOT NULL,
	`execution_id` text NOT NULL,
	`action_type` text NOT NULL,
	`title` text NOT NULL,
	`rationale` text NOT NULL,
	`command_preview` text,
	`affected_resources` text NOT NULL,
	`status` text NOT NULL,
	`requested_at` text NOT NULL,
	`decided_at` text,
	`decision_note` text,
	FOREIGN KEY (`mission_id`) REFERENCES `missions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`execution_id`) REFERENCES `executions`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "approval_requests_status_check" CHECK("approval_requests"."status" IN ('pending', 'approved', 'rejected', 'expired')),
	CONSTRAINT "approval_requests_action_type_check" CHECK("approval_requests"."action_type" IN ('write_outside_worktree', 'sensitive_directory_access', 'global_install', 'privilege_elevation', 'unplanned_network_access', 'new_credential_use', 'recursive_delete', 'global_git_config_change', 'push_or_publish', 'run_downloaded_binary', 'read_secret_file'))
);
--> statement-breakpoint
CREATE INDEX `approval_requests_status_requested_idx` ON `approval_requests` (`status`,`requested_at`);--> statement-breakpoint
CREATE INDEX `approval_requests_execution_status_idx` ON `approval_requests` (`execution_id`,`status`);--> statement-breakpoint
CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`aggregate_type` text NOT NULL,
	`aggregate_id` text NOT NULL,
	`event_type` text NOT NULL,
	`severity` text NOT NULL,
	`actor` text NOT NULL,
	`payload` text NOT NULL,
	`sequence` integer NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT "audit_events_aggregate_type_check" CHECK("audit_events"."aggregate_type" IN ('project', 'mission', 'execution', 'worktree', 'settings')),
	CONSTRAINT "audit_events_severity_check" CHECK("audit_events"."severity" IN ('debug', 'info', 'warning', 'error')),
	CONSTRAINT "audit_events_actor_check" CHECK("audit_events"."actor" IN ('user', 'agent', 'system'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `audit_events_aggregate_sequence_unique` ON `audit_events` (`aggregate_id`,`sequence`);--> statement-breakpoint
CREATE TABLE `executions` (
	`id` text PRIMARY KEY NOT NULL,
	`mission_id` text NOT NULL,
	`attempt` integer NOT NULL,
	`status` text NOT NULL,
	`agent_session_id` text,
	`exit_reason` text,
	`usage` text,
	`started_at` text,
	`finished_at` text,
	FOREIGN KEY (`mission_id`) REFERENCES `missions`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "executions_status_check" CHECK("executions"."status" IN ('queued', 'running', 'paused', 'succeeded', 'failed', 'cancelled')),
	CONSTRAINT "executions_exit_reason_check" CHECK("executions"."exit_reason" IS NULL OR "executions"."exit_reason" IN ('completed', 'agent_failed', 'approval_rejected', 'cancelled_by_user', 'interrupted_by_restart'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `executions_attempt_unique` ON `executions` (`mission_id`,`attempt`);--> statement-breakpoint
CREATE TABLE `mission_acceptance_criteria` (
	`id` text PRIMARY KEY NOT NULL,
	`mission_id` text NOT NULL,
	`position` integer NOT NULL,
	`text` text NOT NULL,
	FOREIGN KEY (`mission_id`) REFERENCES `missions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mission_acceptance_criteria_position_unique` ON `mission_acceptance_criteria` (`mission_id`,`position`);--> statement-breakpoint
CREATE TABLE `mission_steps` (
	`id` text PRIMARY KEY NOT NULL,
	`mission_id` text NOT NULL,
	`position` integer NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`depends_on` text NOT NULL,
	`started_at` text,
	`finished_at` text,
	FOREIGN KEY (`mission_id`) REFERENCES `missions`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "mission_steps_kind_check" CHECK("mission_steps"."kind" IN ('analysis', 'code', 'command', 'test', 'review', 'custom')),
	CONSTRAINT "mission_steps_status_check" CHECK("mission_steps"."status" IN ('pending', 'running', 'blocked', 'succeeded', 'failed', 'skipped'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mission_steps_position_unique` ON `mission_steps` (`mission_id`,`position`);--> statement-breakpoint
CREATE TABLE `missions` (
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
	CONSTRAINT "missions_status_check" CHECK("missions"."status" IN ('draft', 'planned', 'queued', 'running', 'waiting_approval', 'waiting_input', 'paused', 'succeeded', 'failed', 'cancelled')),
	CONSTRAINT "missions_priority_check" CHECK("missions"."priority" IN ('low', 'normal', 'high'))
);
--> statement-breakpoint
CREATE INDEX `missions_project_status_updated_idx` ON `missions` (`project_id`,`status`,`updated_at`);