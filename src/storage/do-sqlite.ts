export const durableObjectSqliteMigrations = [
  `CREATE TABLE IF NOT EXISTS sessions (
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
  )`,
  `CREATE TABLE IF NOT EXISTS runs (
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
  )`,
  `CREATE TABLE IF NOT EXISTS run_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    stream TEXT NOT NULL,
    event_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (run_id, seq)
  )`,
  `CREATE TABLE IF NOT EXISTS workspace_index (
    path TEXT PRIMARY KEY,
    r2_key TEXT NOT NULL,
    content_type TEXT,
    size INTEGER,
    etag TEXT,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS plugin_runtime_state (
    plugin_id TEXT PRIMARY KEY,
    enabled INTEGER NOT NULL,
    runtime_state_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_agent_status ON sessions (account_id, agent_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_runs_session ON runs (session_key, accepted_at)`,
  `CREATE INDEX IF NOT EXISTS idx_run_events_run ON run_events (run_id, seq)`,
] as const;

export interface SessionRecord {
  session_key: string;
  session_id: string;
  account_id: string;
  agent_id: string;
  title: string | null;
  status: string;
  last_run_id: string | null;
  transcript_r2_key: string | null;
  session_started_at: string;
  last_interaction_at: string;
  updated_at: string;
}

export interface RunRecord {
  run_id: string;
  session_key: string;
  session_id: string;
  status: string;
  idempotency_key: string | null;
  input_json: string;
  summary_json: string | null;
  error_json: string | null;
  accepted_at: string;
  started_at: string | null;
  ended_at: string | null;
}

export interface RunEventRecord {
  id?: number;
  run_id: string;
  seq: number;
  stream: string;
  event_json: string;
  created_at: string;
}

export interface WorkspaceIndexRecord {
  path: string;
  r2_key: string;
  content_type: string | null;
  size: number | null;
  etag: string | null;
  updated_at: string;
}

export interface PluginRuntimeStateRecord {
  plugin_id: string;
  enabled: number;
  runtime_state_json: string;
  updated_at: string;
}

interface SqlExecutor {
  exec<T = Record<string, unknown>>(query: string, ...bindings: unknown[]): Iterable<T>;
}

export interface DurableSqlStorage {
  sql: SqlExecutor;
}

function first<T>(rows: Iterable<T>): T | null {
  for (const row of rows) {
    return row;
  }

  return null;
}

function all<T>(rows: Iterable<T>): T[] {
  return [...rows];
}

export class DurableObjectSqliteStorage {
  constructor(private readonly storage: DurableSqlStorage) {}

  migrate(): void {
    for (const statement of durableObjectSqliteMigrations) {
      this.storage.sql.exec(statement);
    }
  }

  upsertSession(record: SessionRecord): void {
    this.storage.sql.exec(
      `INSERT INTO sessions (
         session_key, session_id, account_id, agent_id, title, status, last_run_id,
         transcript_r2_key, session_started_at, last_interaction_at, updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(session_key) DO UPDATE SET
         title = excluded.title,
         status = excluded.status,
         last_run_id = excluded.last_run_id,
         transcript_r2_key = excluded.transcript_r2_key,
         last_interaction_at = excluded.last_interaction_at,
         updated_at = excluded.updated_at`,
      record.session_key,
      record.session_id,
      record.account_id,
      record.agent_id,
      record.title,
      record.status,
      record.last_run_id,
      record.transcript_r2_key,
      record.session_started_at,
      record.last_interaction_at,
      record.updated_at,
    );
  }

  getSession(sessionKey: string): SessionRecord | null {
    return first(this.storage.sql.exec<SessionRecord>("SELECT * FROM sessions WHERE session_key = ?", sessionKey));
  }

  insertRun(record: RunRecord): void {
    this.storage.sql.exec(
      `INSERT INTO runs (
         run_id, session_key, session_id, status, idempotency_key, input_json,
         summary_json, error_json, accepted_at, started_at, ended_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      record.run_id,
      record.session_key,
      record.session_id,
      record.status,
      record.idempotency_key,
      record.input_json,
      record.summary_json,
      record.error_json,
      record.accepted_at,
      record.started_at,
      record.ended_at,
    );
  }

  getRun(runId: string): RunRecord | null {
    return first(this.storage.sql.exec<RunRecord>("SELECT * FROM runs WHERE run_id = ?", runId));
  }

  appendRunEvent(record: RunEventRecord): void {
    this.storage.sql.exec(
      `INSERT INTO run_events (run_id, seq, stream, event_json, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      record.run_id,
      record.seq,
      record.stream,
      record.event_json,
      record.created_at,
    );
  }

  listRunEvents(runId: string): RunEventRecord[] {
    return all(
      this.storage.sql.exec<RunEventRecord>("SELECT * FROM run_events WHERE run_id = ? ORDER BY seq ASC", runId),
    );
  }

  upsertWorkspaceIndex(record: WorkspaceIndexRecord): void {
    this.storage.sql.exec(
      `INSERT INTO workspace_index (path, r2_key, content_type, size, etag, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(path) DO UPDATE SET
         r2_key = excluded.r2_key,
         content_type = excluded.content_type,
         size = excluded.size,
         etag = excluded.etag,
         updated_at = excluded.updated_at`,
      record.path,
      record.r2_key,
      record.content_type,
      record.size,
      record.etag,
      record.updated_at,
    );
  }

  getWorkspaceIndex(path: string): WorkspaceIndexRecord | null {
    return first(this.storage.sql.exec<WorkspaceIndexRecord>("SELECT * FROM workspace_index WHERE path = ?", path));
  }

  setPluginRuntimeState(record: PluginRuntimeStateRecord): void {
    this.storage.sql.exec(
      `INSERT INTO plugin_runtime_state (plugin_id, enabled, runtime_state_json, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(plugin_id) DO UPDATE SET
         enabled = excluded.enabled,
         runtime_state_json = excluded.runtime_state_json,
         updated_at = excluded.updated_at`,
      record.plugin_id,
      record.enabled,
      record.runtime_state_json,
      record.updated_at,
    );
  }

  getPluginRuntimeState(pluginId: string): PluginRuntimeStateRecord | null {
    return first(
      this.storage.sql.exec<PluginRuntimeStateRecord>(
        "SELECT * FROM plugin_runtime_state WHERE plugin_id = ?",
        pluginId,
      ),
    );
  }
}
