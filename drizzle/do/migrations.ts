const journal = {
  version: "7",
  dialect: "sqlite",
  entries: [
    {
      idx: 0,
      version: "6",
      when: 1778341831862,
      tag: "0000_agent_runtime_schema",
      breakpoints: true,
    },
  ],
} as const;

const m0000 = `CREATE TABLE \`plugin_runtime_state\` (
\t\`plugin_id\` text PRIMARY KEY NOT NULL,
\t\`enabled\` integer NOT NULL,
\t\`runtime_state_json\` text NOT NULL,
\t\`updated_at\` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE \`run_events\` (
\t\`id\` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
\t\`run_id\` text NOT NULL,
\t\`seq\` integer NOT NULL,
\t\`stream\` text NOT NULL,
\t\`event_json\` text NOT NULL,
\t\`created_at\` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX \`run_events_run_id_seq_unique\` ON \`run_events\` (\`run_id\`,\`seq\`);--> statement-breakpoint
CREATE INDEX \`idx_run_events_run\` ON \`run_events\` (\`run_id\`,\`seq\`);--> statement-breakpoint
CREATE TABLE \`runs\` (
\t\`run_id\` text PRIMARY KEY NOT NULL,
\t\`session_key\` text NOT NULL,
\t\`session_id\` text NOT NULL,
\t\`status\` text NOT NULL,
\t\`idempotency_key\` text,
\t\`input_json\` text NOT NULL,
\t\`summary_json\` text,
\t\`error_json\` text,
\t\`accepted_at\` text NOT NULL,
\t\`started_at\` text,
\t\`ended_at\` text
);
--> statement-breakpoint
CREATE INDEX \`idx_runs_session\` ON \`runs\` (\`session_key\`,\`accepted_at\`);--> statement-breakpoint
CREATE TABLE \`sessions\` (
\t\`session_key\` text PRIMARY KEY NOT NULL,
\t\`session_id\` text NOT NULL,
\t\`account_id\` text NOT NULL,
\t\`agent_id\` text NOT NULL,
\t\`title\` text,
\t\`status\` text NOT NULL,
\t\`last_run_id\` text,
\t\`transcript_r2_key\` text,
\t\`session_started_at\` text NOT NULL,
\t\`last_interaction_at\` text NOT NULL,
\t\`updated_at\` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX \`idx_sessions_agent_status\` ON \`sessions\` (\`account_id\`,\`agent_id\`,\`status\`);--> statement-breakpoint
CREATE TABLE \`workspace_index\` (
\t\`path\` text PRIMARY KEY NOT NULL,
\t\`r2_key\` text NOT NULL,
\t\`content_type\` text,
\t\`size\` integer,
\t\`etag\` text,
\t\`updated_at\` text NOT NULL
);`;

export default {
  journal,
  migrations: {
    m0000,
  },
} as const;
