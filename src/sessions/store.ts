import {
  DurableObjectSqliteStorage,
  type RunEventRecord,
  type RunRecord,
  type SessionRecord,
} from "../storage/do-sqlite";

export interface AgentRuntimeStore {
  upsertSession(record: SessionRecord): Promise<void>;
  listSessions(accountId: string, agentId: string): Promise<SessionRecord[]>;
  insertRun(record: RunRecord): Promise<void>;
  updateRunStatus(
    runId: string,
    fields: {
      status: string;
      summary_json?: string | null;
      error_json?: string | null;
      started_at?: string | null;
      ended_at?: string | null;
    },
  ): Promise<void>;
  getRun(runId: string): Promise<RunRecord | null>;
  appendRunEvent(record: RunEventRecord): Promise<void>;
  listRunEvents(runId: string): Promise<RunEventRecord[]>;
}

export class SqliteAgentRuntimeStore implements AgentRuntimeStore {
  constructor(private readonly storage: DurableObjectSqliteStorage) {}

  async upsertSession(record: SessionRecord): Promise<void> {
    this.storage.upsertSession(record);
  }

  async listSessions(accountId: string, agentId: string): Promise<SessionRecord[]> {
    return this.storage.listSessions(accountId, agentId);
  }

  async insertRun(record: RunRecord): Promise<void> {
    this.storage.insertRun(record);
  }

  async updateRunStatus(
    runId: string,
    fields: {
      status: string;
      summary_json?: string | null;
      error_json?: string | null;
      started_at?: string | null;
      ended_at?: string | null;
    },
  ): Promise<void> {
    this.storage.updateRunStatus(runId, fields);
  }

  async getRun(runId: string): Promise<RunRecord | null> {
    return this.storage.getRun(runId);
  }

  async appendRunEvent(record: RunEventRecord): Promise<void> {
    this.storage.appendRunEvent(record);
  }

  async listRunEvents(runId: string): Promise<RunEventRecord[]> {
    return this.storage.listRunEvents(runId);
  }
}

export class MemoryAgentRuntimeStore implements AgentRuntimeStore {
  readonly sessions = new Map<string, SessionRecord>();
  readonly runs = new Map<string, RunRecord>();
  readonly events = new Map<string, RunEventRecord[]>();

  async upsertSession(record: SessionRecord): Promise<void> {
    this.sessions.set(record.session_key, record);
  }

  async listSessions(accountId: string, agentId: string): Promise<SessionRecord[]> {
    return [...this.sessions.values()].filter((session) => session.account_id === accountId && session.agent_id === agentId);
  }

  async insertRun(record: RunRecord): Promise<void> {
    this.runs.set(record.run_id, record);
  }

  async updateRunStatus(
    runId: string,
    fields: {
      status: string;
      summary_json?: string | null;
      error_json?: string | null;
      started_at?: string | null;
      ended_at?: string | null;
    },
  ): Promise<void> {
    const existing = this.runs.get(runId);

    if (!existing) {
      return;
    }

    this.runs.set(runId, {
      ...existing,
      status: fields.status,
      summary_json: fields.summary_json ?? existing.summary_json,
      error_json: fields.error_json ?? existing.error_json,
      started_at: fields.started_at ?? existing.started_at,
      ended_at: fields.ended_at ?? existing.ended_at,
    });
  }

  async getRun(runId: string): Promise<RunRecord | null> {
    return this.runs.get(runId) ?? null;
  }

  async appendRunEvent(record: RunEventRecord): Promise<void> {
    const events = this.events.get(record.run_id) ?? [];
    events.push({ ...record, id: events.length + 1 });
    this.events.set(record.run_id, events);
  }

  async listRunEvents(runId: string): Promise<RunEventRecord[]> {
    return this.events.get(runId) ?? [];
  }
}
