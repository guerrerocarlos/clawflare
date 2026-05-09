import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const accounts = sqliteTable("accounts", {
  id: text("id").primaryKey(),
  display_name: text("display_name"),
  created_at: text("created_at").notNull(),
  updated_at: text("updated_at").notNull(),
});

export const agents = sqliteTable(
  "agents",
  {
    account_id: text("account_id").notNull(),
    id: text("id").notNull(),
    display_name: text("display_name").notNull(),
    default_model: text("default_model"),
    config_json: text("config_json").notNull(),
    created_at: text("created_at").notNull(),
    updated_at: text("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.account_id, table.id] }),
    index("idx_agents_account_id").on(table.account_id),
  ],
);

export const plugin_installs = sqliteTable(
  "plugin_installs",
  {
    account_id: text("account_id").notNull(),
    agent_id: text("agent_id").notNull(),
    plugin_id: text("plugin_id").notNull(),
    source: text("source").notNull(),
    version: text("version"),
    integrity: text("integrity").notNull(),
    state: text("state").notNull(),
    compatibility_tier: integer("compatibility_tier").notNull(),
    manifest_json: text("manifest_json").notNull(),
    install_plan_json: text("install_plan_json"),
    archive_r2_key: text("archive_r2_key"),
    created_at: text("created_at").notNull(),
    updated_at: text("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.account_id, table.agent_id, table.plugin_id] }),
    index("idx_plugin_installs_agent").on(table.account_id, table.agent_id),
  ],
);

export const audit_events = sqliteTable(
  "audit_events",
  {
    id: text("id").primaryKey(),
    account_id: text("account_id").notNull(),
    agent_id: text("agent_id"),
    actor_id: text("actor_id"),
    action: text("action").notNull(),
    target: text("target"),
    payload_json: text("payload_json").notNull(),
    created_at: text("created_at").notNull(),
  },
  (table) => [index("idx_audit_events_account_created").on(table.account_id, table.created_at)],
);

export const idempotency_keys = sqliteTable(
  "idempotency_keys",
  {
    account_id: text("account_id").notNull(),
    scope: text("scope").notNull(),
    key: text("key").notNull(),
    result_json: text("result_json").notNull(),
    expires_at: text("expires_at").notNull(),
    created_at: text("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.account_id, table.scope, table.key] }),
    index("idx_idempotency_keys_expires_at").on(table.expires_at),
  ],
);
