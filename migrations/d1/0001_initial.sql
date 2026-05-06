CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  display_name TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agents (
  account_id TEXT NOT NULL,
  id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  default_model TEXT,
  config_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (account_id, id)
);

CREATE TABLE IF NOT EXISTS plugin_installs (
  account_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  plugin_id TEXT NOT NULL,
  source TEXT NOT NULL,
  version TEXT,
  integrity TEXT NOT NULL,
  state TEXT NOT NULL,
  compatibility_tier INTEGER NOT NULL,
  manifest_json TEXT NOT NULL,
  install_plan_json TEXT,
  archive_r2_key TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (account_id, agent_id, plugin_id)
);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  agent_id TEXT,
  actor_id TEXT,
  action TEXT NOT NULL,
  target TEXT,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  account_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  key TEXT NOT NULL,
  result_json TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (account_id, scope, key)
);

CREATE INDEX IF NOT EXISTS idx_agents_account_id ON agents (account_id);
CREATE INDEX IF NOT EXISTS idx_plugin_installs_agent ON plugin_installs (account_id, agent_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_account_created ON audit_events (account_id, created_at);
CREATE INDEX IF NOT EXISTS idx_idempotency_keys_expires_at ON idempotency_keys (expires_at);
