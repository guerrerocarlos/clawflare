import { and, desc, eq } from "drizzle-orm";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import type { ClawflareEnv } from "../env";
import * as schema from "../db/d1-schema";

export type AccountRecord = typeof schema.accounts.$inferSelect;
export type AgentRecord = typeof schema.agents.$inferSelect;
export type PluginInstallRecord = typeof schema.plugin_installs.$inferSelect;
export type AuditEventRecord = typeof schema.audit_events.$inferSelect;
export type IdempotencyKeyRecord = typeof schema.idempotency_keys.$inferSelect;

type D1DatabaseClient = DrizzleD1Database<typeof schema>;

function first<T>(rows: T[]): T | null {
  return rows[0] ?? null;
}

export class D1Storage {
  private readonly db: D1DatabaseClient;

  constructor(db: D1Database) {
    this.db = drizzle(db, { schema });
  }

  async upsertAccount(record: AccountRecord): Promise<void> {
    await this.db
      .insert(schema.accounts)
      .values(record)
      .onConflictDoUpdate({
        target: schema.accounts.id,
        set: {
          display_name: record.display_name,
          updated_at: record.updated_at,
        },
      });
  }

  async getAccount(id: string): Promise<AccountRecord | null> {
    return first(
      await this.db
        .select()
        .from(schema.accounts)
        .where(eq(schema.accounts.id, id))
        .limit(1),
    );
  }

  async upsertAgent(record: AgentRecord): Promise<void> {
    await this.db
      .insert(schema.agents)
      .values(record)
      .onConflictDoUpdate({
        target: [schema.agents.account_id, schema.agents.id],
        set: {
          display_name: record.display_name,
          default_model: record.default_model,
          config_json: record.config_json,
          updated_at: record.updated_at,
        },
      });
  }

  async getAgent(accountId: string, agentId: string): Promise<AgentRecord | null> {
    return first(
      await this.db
        .select()
        .from(schema.agents)
        .where(and(eq(schema.agents.account_id, accountId), eq(schema.agents.id, agentId)))
        .limit(1),
    );
  }

  async upsertPluginInstall(record: PluginInstallRecord): Promise<void> {
    await this.db
      .insert(schema.plugin_installs)
      .values(record)
      .onConflictDoUpdate({
        target: [schema.plugin_installs.account_id, schema.plugin_installs.agent_id, schema.plugin_installs.plugin_id],
        set: {
          source: record.source,
          version: record.version,
          integrity: record.integrity,
          state: record.state,
          compatibility_tier: record.compatibility_tier,
          manifest_json: record.manifest_json,
          install_plan_json: record.install_plan_json,
          archive_r2_key: record.archive_r2_key,
          updated_at: record.updated_at,
        },
      });
  }

  async getPluginInstall(accountId: string, agentId: string, pluginId: string): Promise<PluginInstallRecord | null> {
    return first(
      await this.db
        .select()
        .from(schema.plugin_installs)
        .where(
          and(
            eq(schema.plugin_installs.account_id, accountId),
            eq(schema.plugin_installs.agent_id, agentId),
            eq(schema.plugin_installs.plugin_id, pluginId),
          ),
        )
        .limit(1),
    );
  }

  async insertAuditEvent(record: AuditEventRecord): Promise<void> {
    await this.db.insert(schema.audit_events).values(record);
  }

  async putIdempotencyKey(record: IdempotencyKeyRecord): Promise<void> {
    await this.db
      .insert(schema.idempotency_keys)
      .values(record)
      .onConflictDoUpdate({
        target: [schema.idempotency_keys.account_id, schema.idempotency_keys.scope, schema.idempotency_keys.key],
        set: {
          result_json: record.result_json,
          expires_at: record.expires_at,
        },
      });
  }

  async getIdempotencyKey(accountId: string, scope: string, key: string): Promise<IdempotencyKeyRecord | null> {
    return first(
      await this.db
        .select()
        .from(schema.idempotency_keys)
        .where(
          and(
            eq(schema.idempotency_keys.account_id, accountId),
            eq(schema.idempotency_keys.scope, scope),
            eq(schema.idempotency_keys.key, key),
          ),
        )
        .orderBy(desc(schema.idempotency_keys.created_at))
        .limit(1),
    );
  }
}

export function createD1Storage(env: Pick<ClawflareEnv, "DB">): D1Storage {
  return new D1Storage(env.DB);
}
