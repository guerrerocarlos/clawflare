import { and, asc, desc, eq } from "drizzle-orm";
import { drizzle, type DrizzleSqliteDODatabase } from "drizzle-orm/durable-sqlite";
import { migrate } from "drizzle-orm/durable-sqlite/migrator";
import * as schema from "../db/do-schema";
import durableObjectMigrations from "../../drizzle/do/migrations";

export type SessionRecord = typeof schema.sessions.$inferSelect;
export type RunRecord = typeof schema.runs.$inferSelect;
export type RunEventRecord = Omit<typeof schema.run_events.$inferSelect, "id"> & { id?: number };
export type WorkspaceIndexRecord = typeof schema.workspace_index.$inferSelect;
export type PluginRuntimeStateRecord = typeof schema.plugin_runtime_state.$inferSelect;

export interface DurableObjectMigrationConfig {
  journal: {
    entries: Array<{
      idx: number;
      when: number;
      tag: string;
      breakpoints: boolean;
    }>;
  };
  migrations: Record<string, string>;
}

const durableObjectSqliteMigrations: DurableObjectMigrationConfig = {
  journal: [...durableObjectMigrations.journal.entries].reduce<DurableObjectMigrationConfig["journal"]>(
    (journal, entry) => {
      journal.entries.push({ ...entry });
      return journal;
    },
    { ...durableObjectMigrations.journal, entries: [] },
  ),
  migrations: { ...durableObjectMigrations.migrations },
};

type DurableObjectDatabaseClient = DrizzleSqliteDODatabase<typeof schema>;

function first<T>(rows: T[]): T | null {
  return rows[0] ?? null;
}

export class DurableObjectSqliteStorage {
  private readonly db: DurableObjectDatabaseClient;

  constructor(private readonly storage: DurableObjectStorage) {
    this.db = drizzle(this.storage, { schema });
  }

  async migrate(): Promise<void> {
    await migrate(this.db, durableObjectSqliteMigrations);
  }

  async upsertSession(record: SessionRecord): Promise<void> {
    await this.db
      .insert(schema.sessions)
      .values(record)
      .onConflictDoUpdate({
        target: schema.sessions.session_key,
        set: {
          title: record.title,
          status: record.status,
          last_run_id: record.last_run_id,
          transcript_r2_key: record.transcript_r2_key,
          last_interaction_at: record.last_interaction_at,
          updated_at: record.updated_at,
        },
      });
  }

  async getSession(sessionKey: string): Promise<SessionRecord | null> {
    return first(
      await this.db
        .select()
        .from(schema.sessions)
        .where(eq(schema.sessions.session_key, sessionKey))
        .limit(1),
    );
  }

  async listSessions(accountId: string, agentId: string): Promise<SessionRecord[]> {
    return await this.db
      .select()
      .from(schema.sessions)
      .where(and(eq(schema.sessions.account_id, accountId), eq(schema.sessions.agent_id, agentId)))
      .orderBy(desc(schema.sessions.updated_at));
  }

  async insertRun(record: RunRecord): Promise<void> {
    await this.db.insert(schema.runs).values(record);
  }

  async getRun(runId: string): Promise<RunRecord | null> {
    return first(
      await this.db
        .select()
        .from(schema.runs)
        .where(eq(schema.runs.run_id, runId))
        .limit(1),
    );
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
    const updates: Partial<RunRecord> = {
      status: fields.status,
    };

    if ("summary_json" in fields) {
      updates.summary_json = fields.summary_json ?? null;
    }

    if ("error_json" in fields) {
      updates.error_json = fields.error_json ?? null;
    }

    if ("started_at" in fields) {
      updates.started_at = fields.started_at ?? null;
    }

    if ("ended_at" in fields) {
      updates.ended_at = fields.ended_at ?? null;
    }

    await this.db.update(schema.runs).set(updates).where(eq(schema.runs.run_id, runId));
  }

  async appendRunEvent(record: RunEventRecord): Promise<void> {
    await this.db.insert(schema.run_events).values(record);
  }

  async listRunEvents(runId: string): Promise<RunEventRecord[]> {
    return await this.db
      .select()
      .from(schema.run_events)
      .where(eq(schema.run_events.run_id, runId))
      .orderBy(asc(schema.run_events.seq));
  }

  async upsertWorkspaceIndex(record: WorkspaceIndexRecord): Promise<void> {
    await this.db
      .insert(schema.workspace_index)
      .values(record)
      .onConflictDoUpdate({
        target: schema.workspace_index.path,
        set: {
          r2_key: record.r2_key,
          content_type: record.content_type,
          size: record.size,
          etag: record.etag,
          updated_at: record.updated_at,
        },
      });
  }

  async getWorkspaceIndex(path: string): Promise<WorkspaceIndexRecord | null> {
    return first(
      await this.db
        .select()
        .from(schema.workspace_index)
        .where(eq(schema.workspace_index.path, path))
        .limit(1),
    );
  }

  async listWorkspaceIndex(): Promise<WorkspaceIndexRecord[]> {
    return await this.db.select().from(schema.workspace_index).orderBy(asc(schema.workspace_index.path));
  }

  async setPluginRuntimeState(record: PluginRuntimeStateRecord): Promise<void> {
    await this.db
      .insert(schema.plugin_runtime_state)
      .values(record)
      .onConflictDoUpdate({
        target: schema.plugin_runtime_state.plugin_id,
        set: {
          enabled: record.enabled,
          runtime_state_json: record.runtime_state_json,
          updated_at: record.updated_at,
        },
      });
  }

  async getPluginRuntimeState(pluginId: string): Promise<PluginRuntimeStateRecord | null> {
    return first(
      await this.db
        .select()
        .from(schema.plugin_runtime_state)
        .where(eq(schema.plugin_runtime_state.plugin_id, pluginId))
        .limit(1),
    );
  }

  async listPluginRuntimeStates(): Promise<PluginRuntimeStateRecord[]> {
    return await this.db.select().from(schema.plugin_runtime_state).orderBy(asc(schema.plugin_runtime_state.plugin_id));
  }
}

export { durableObjectSqliteMigrations };
