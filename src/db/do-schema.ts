import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const sessions = sqliteTable(
  "sessions",
  {
    session_key: text("session_key").primaryKey(),
    session_id: text("session_id").notNull(),
    account_id: text("account_id").notNull(),
    agent_id: text("agent_id").notNull(),
    title: text("title"),
    status: text("status").notNull(),
    last_run_id: text("last_run_id"),
    transcript_r2_key: text("transcript_r2_key"),
    session_started_at: text("session_started_at").notNull(),
    last_interaction_at: text("last_interaction_at").notNull(),
    updated_at: text("updated_at").notNull(),
  },
  (table) => [index("idx_sessions_agent_status").on(table.account_id, table.agent_id, table.status)],
);

export const runs = sqliteTable(
  "runs",
  {
    run_id: text("run_id").primaryKey(),
    session_key: text("session_key").notNull(),
    session_id: text("session_id").notNull(),
    status: text("status").notNull(),
    idempotency_key: text("idempotency_key"),
    input_json: text("input_json").notNull(),
    summary_json: text("summary_json"),
    error_json: text("error_json"),
    accepted_at: text("accepted_at").notNull(),
    started_at: text("started_at"),
    ended_at: text("ended_at"),
  },
  (table) => [index("idx_runs_session").on(table.session_key, table.accepted_at)],
);

export const run_events = sqliteTable(
  "run_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    run_id: text("run_id").notNull(),
    seq: integer("seq").notNull(),
    stream: text("stream").notNull(),
    event_json: text("event_json").notNull(),
    created_at: text("created_at").notNull(),
  },
  (table) => [uniqueIndex("run_events_run_id_seq_unique").on(table.run_id, table.seq), index("idx_run_events_run").on(table.run_id, table.seq)],
);

export const workspace_index = sqliteTable("workspace_index", {
  path: text("path").primaryKey(),
  r2_key: text("r2_key").notNull(),
  content_type: text("content_type"),
  size: integer("size"),
  etag: text("etag"),
  updated_at: text("updated_at").notNull(),
});

export const plugin_runtime_state = sqliteTable("plugin_runtime_state", {
  plugin_id: text("plugin_id").primaryKey(),
  enabled: integer("enabled").notNull(),
  runtime_state_json: text("runtime_state_json").notNull(),
  updated_at: text("updated_at").notNull(),
});
