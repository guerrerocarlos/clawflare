CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`display_name` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `agents` (
	`account_id` text NOT NULL,
	`id` text NOT NULL,
	`display_name` text NOT NULL,
	`default_model` text,
	`config_json` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`account_id`, `id`)
);
--> statement-breakpoint
CREATE INDEX `idx_agents_account_id` ON `agents` (`account_id`);--> statement-breakpoint
CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`agent_id` text,
	`actor_id` text,
	`action` text NOT NULL,
	`target` text,
	`payload_json` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_audit_events_account_created` ON `audit_events` (`account_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `idempotency_keys` (
	`account_id` text NOT NULL,
	`scope` text NOT NULL,
	`key` text NOT NULL,
	`result_json` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`account_id`, `scope`, `key`)
);
--> statement-breakpoint
CREATE INDEX `idx_idempotency_keys_expires_at` ON `idempotency_keys` (`expires_at`);--> statement-breakpoint
CREATE TABLE `plugin_installs` (
	`account_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`plugin_id` text NOT NULL,
	`source` text NOT NULL,
	`version` text,
	`integrity` text NOT NULL,
	`state` text NOT NULL,
	`compatibility_tier` integer NOT NULL,
	`manifest_json` text NOT NULL,
	`install_plan_json` text,
	`archive_r2_key` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`account_id`, `agent_id`, `plugin_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_plugin_installs_agent` ON `plugin_installs` (`account_id`,`agent_id`);