CREATE TABLE IF NOT EXISTS sessions (
  session_key TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  title TEXT,
  status TEXT NOT NULL,
  last_run_id TEXT,
  transcript_r2_key TEXT,
  session_started_at TEXT NOT NULL,
  last_interaction_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS runs (
  run_id TEXT PRIMARY KEY,
  session_key TEXT NOT NULL,
  session_id TEXT NOT NULL,
  status TEXT NOT NULL,
  idempotency_key TEXT,
  input_json TEXT NOT NULL,
  summary_json TEXT,
  error_json TEXT,
  accepted_at TEXT NOT NULL,
  started_at TEXT,
  ended_at TEXT
);

CREATE TABLE IF NOT EXISTS run_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  stream TEXT NOT NULL,
  event_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (run_id, seq)
);

CREATE TABLE IF NOT EXISTS workspace_index (
  path TEXT PRIMARY KEY,
  r2_key TEXT NOT NULL,
  content_type TEXT,
  size INTEGER,
  etag TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS plugin_runtime_state (
  plugin_id TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL,
  runtime_state_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_agent_status ON sessions (account_id, agent_id, status);
CREATE INDEX IF NOT EXISTS idx_runs_session ON runs (session_key, accepted_at);
CREATE INDEX IF NOT EXISTS idx_run_events_run ON run_events (run_id, seq);
