import type { ClawflareEnv } from "../env";

export interface AccountRecord {
  id: string;
  display_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface AgentRecord {
  account_id: string;
  id: string;
  display_name: string;
  default_model: string | null;
  config_json: string;
  created_at: string;
  updated_at: string;
}

export interface PluginInstallRecord {
  account_id: string;
  agent_id: string;
  plugin_id: string;
  source: string;
  version: string | null;
  integrity: string;
  state: string;
  compatibility_tier: number;
  manifest_json: string;
  install_plan_json: string | null;
  archive_r2_key: string | null;
  created_at: string;
  updated_at: string;
}

export interface AuditEventRecord {
  id: string;
  account_id: string;
  agent_id: string | null;
  actor_id: string | null;
  action: string;
  target: string | null;
  payload_json: string;
  created_at: string;
}

export interface IdempotencyKeyRecord {
  account_id: string;
  scope: string;
  key: string;
  result_json: string;
  expires_at: string;
  created_at: string;
}

export class D1Storage {
  constructor(private readonly db: D1Database) {}

  async upsertAccount(record: AccountRecord): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO accounts (id, display_name, created_at, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           display_name = excluded.display_name,
           updated_at = excluded.updated_at`,
      )
      .bind(record.id, record.display_name, record.created_at, record.updated_at)
      .run();
  }

  async getAccount(id: string): Promise<AccountRecord | null> {
    return await this.db.prepare("SELECT * FROM accounts WHERE id = ?").bind(id).first<AccountRecord>();
  }

  async upsertAgent(record: AgentRecord): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO agents (account_id, id, display_name, default_model, config_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(account_id, id) DO UPDATE SET
           display_name = excluded.display_name,
           default_model = excluded.default_model,
           config_json = excluded.config_json,
           updated_at = excluded.updated_at`,
      )
      .bind(
        record.account_id,
        record.id,
        record.display_name,
        record.default_model,
        record.config_json,
        record.created_at,
        record.updated_at,
      )
      .run();
  }

  async getAgent(accountId: string, agentId: string): Promise<AgentRecord | null> {
    return await this.db
      .prepare("SELECT * FROM agents WHERE account_id = ? AND id = ?")
      .bind(accountId, agentId)
      .first<AgentRecord>();
  }

  async upsertPluginInstall(record: PluginInstallRecord): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO plugin_installs (
           account_id, agent_id, plugin_id, source, version, integrity, state, compatibility_tier,
           manifest_json, install_plan_json, archive_r2_key, created_at, updated_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(account_id, agent_id, plugin_id) DO UPDATE SET
           source = excluded.source,
           version = excluded.version,
           integrity = excluded.integrity,
           state = excluded.state,
           compatibility_tier = excluded.compatibility_tier,
           manifest_json = excluded.manifest_json,
           install_plan_json = excluded.install_plan_json,
           archive_r2_key = excluded.archive_r2_key,
           updated_at = excluded.updated_at`,
      )
      .bind(
        record.account_id,
        record.agent_id,
        record.plugin_id,
        record.source,
        record.version,
        record.integrity,
        record.state,
        record.compatibility_tier,
        record.manifest_json,
        record.install_plan_json,
        record.archive_r2_key,
        record.created_at,
        record.updated_at,
      )
      .run();
  }

  async getPluginInstall(accountId: string, agentId: string, pluginId: string): Promise<PluginInstallRecord | null> {
    return await this.db
      .prepare("SELECT * FROM plugin_installs WHERE account_id = ? AND agent_id = ? AND plugin_id = ?")
      .bind(accountId, agentId, pluginId)
      .first<PluginInstallRecord>();
  }

  async insertAuditEvent(record: AuditEventRecord): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO audit_events (id, account_id, agent_id, actor_id, action, target, payload_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        record.id,
        record.account_id,
        record.agent_id,
        record.actor_id,
        record.action,
        record.target,
        record.payload_json,
        record.created_at,
      )
      .run();
  }

  async putIdempotencyKey(record: IdempotencyKeyRecord): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO idempotency_keys (account_id, scope, key, result_json, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(account_id, scope, key) DO UPDATE SET
           result_json = excluded.result_json,
           expires_at = excluded.expires_at`,
      )
      .bind(record.account_id, record.scope, record.key, record.result_json, record.expires_at, record.created_at)
      .run();
  }

  async getIdempotencyKey(accountId: string, scope: string, key: string): Promise<IdempotencyKeyRecord | null> {
    return await this.db
      .prepare("SELECT * FROM idempotency_keys WHERE account_id = ? AND scope = ? AND key = ?")
      .bind(accountId, scope, key)
      .first<IdempotencyKeyRecord>();
  }
}

export function createD1Storage(env: Pick<ClawflareEnv, "DB">): D1Storage {
  return new D1Storage(env.DB);
}
