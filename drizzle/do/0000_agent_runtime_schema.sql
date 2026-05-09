CREATE TABLE `plugin_runtime_state` (
	`plugin_id` text PRIMARY KEY NOT NULL,
	`enabled` integer NOT NULL,
	`runtime_state_json` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `run_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` text NOT NULL,
	`seq` integer NOT NULL,
	`stream` text NOT NULL,
	`event_json` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `run_events_run_id_seq_unique` ON `run_events` (`run_id`,`seq`);--> statement-breakpoint
CREATE INDEX `idx_run_events_run` ON `run_events` (`run_id`,`seq`);--> statement-breakpoint
CREATE TABLE `runs` (
	`run_id` text PRIMARY KEY NOT NULL,
	`session_key` text NOT NULL,
	`session_id` text NOT NULL,
	`status` text NOT NULL,
	`idempotency_key` text,
	`input_json` text NOT NULL,
	`summary_json` text,
	`error_json` text,
	`accepted_at` text NOT NULL,
	`started_at` text,
	`ended_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_runs_session` ON `runs` (`session_key`,`accepted_at`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`session_key` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`account_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`title` text,
	`status` text NOT NULL,
	`last_run_id` text,
	`transcript_r2_key` text,
	`session_started_at` text NOT NULL,
	`last_interaction_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_sessions_agent_status` ON `sessions` (`account_id`,`agent_id`,`status`);--> statement-breakpoint
CREATE TABLE `workspace_index` (
	`path` text PRIMARY KEY NOT NULL,
	`r2_key` text NOT NULL,
	`content_type` text,
	`size` integer,
	`etag` text,
	`updated_at` text NOT NULL
);
