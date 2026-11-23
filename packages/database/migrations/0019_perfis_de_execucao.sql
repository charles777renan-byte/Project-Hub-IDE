CREATE TABLE `execution_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`model` text,
	`effort` text,
	`permission_mode` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "execution_profiles_model_check" CHECK("execution_profiles"."model" IS NULL OR "execution_profiles"."model" IN ('fable', 'opus', 'sonnet', 'haiku')),
	CONSTRAINT "execution_profiles_effort_check" CHECK("execution_profiles"."effort" IS NULL OR "execution_profiles"."effort" IN ('low', 'medium', 'high', 'xhigh', 'max')),
	CONSTRAINT "execution_profiles_permission_mode_check" CHECK("execution_profiles"."permission_mode" IS NULL OR "execution_profiles"."permission_mode" IN ('manual', 'acceptEdits', 'auto'))
);
