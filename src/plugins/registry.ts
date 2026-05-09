import { sha256Hex } from "../storage/keys";
import type { D1Storage } from "../storage/d1";
import type { DurableObjectSqliteStorage } from "../storage/do-sqlite";
import { parsePluginManifest } from "./manifest";
import type { ClawHubSkill, InstalledPlugin, ParsedPluginManifest } from "./types";

export interface PluginStoreInstallInput {
  manifest: ParsedPluginManifest;
  source: string;
  integrity: string;
  compatibilityTier: number;
  installPlanJson?: string | null;
  archiveR2Key?: string | null;
}

export interface PluginStore {
  install(input: PluginStoreInstallInput): Promise<InstalledPlugin>;
  enable(pluginId: string): Promise<InstalledPlugin>;
  get(pluginId: string): Promise<InstalledPlugin | null>;
  enabledSkills(): Promise<ClawHubSkill[]>;
}

export class MemoryPluginStore implements PluginStore {
  private readonly plugins = new Map<string, InstalledPlugin>();

  async install(input: PluginStoreInstallInput): Promise<InstalledPlugin> {
    const manifest = input.manifest;
    const installed: InstalledPlugin = {
      pluginId: manifest.pluginId,
      version: manifest.version,
      manifest,
      enabled: false,
    };
    this.plugins.set(manifest.pluginId, installed);
    return installed;
  }

  async enable(pluginId: string): Promise<InstalledPlugin> {
    const existing = this.plugins.get(pluginId);

    if (!existing) {
      throw new Error(`Plugin ${pluginId} is not installed.`);
    }

    const enabled = { ...existing, enabled: true };
    this.plugins.set(pluginId, enabled);
    return enabled;
  }

  async get(pluginId: string): Promise<InstalledPlugin | null> {
    return this.plugins.get(pluginId) ?? null;
  }

  async enabledSkills(): Promise<ClawHubSkill[]> {
    return [...this.plugins.values()]
      .filter((plugin) => plugin.enabled)
      .flatMap((plugin) => plugin.manifest.skills);
  }
}

function parseStoredManifest(pluginId: string, version: string, manifestJson: string): ParsedPluginManifest {
  return parsePluginManifest({
    name: pluginId,
    version,
    manifest: JSON.parse(manifestJson),
  });
}

function toInstalledPlugin(input: {
  pluginId: string;
  version: string;
  manifestJson: string;
  enabled: boolean;
}): InstalledPlugin {
  return {
    pluginId: input.pluginId,
    version: input.version,
    manifest: parseStoredManifest(input.pluginId, input.version, input.manifestJson),
    enabled: input.enabled,
  };
}

export class DurablePluginStore implements PluginStore {
  constructor(
    private readonly options: {
      accountId: string;
      agentId: string;
      d1: Pick<D1Storage, "upsertPluginInstall" | "getPluginInstall" | "listPluginInstalls">;
      runtimeState: Pick<DurableObjectSqliteStorage, "setPluginRuntimeState" | "getPluginRuntimeState" | "listPluginRuntimeStates">;
      now?: () => Date;
    },
  ) {}

  async install(input: PluginStoreInstallInput): Promise<InstalledPlugin> {
    const now = (this.options.now ?? (() => new Date()))().toISOString();
    const existing = await this.options.d1.getPluginInstall(this.options.accountId, this.options.agentId, input.manifest.pluginId);

    await this.options.d1.upsertPluginInstall({
      account_id: this.options.accountId,
      agent_id: this.options.agentId,
      plugin_id: input.manifest.pluginId,
      source: input.source,
      version: input.manifest.version,
      integrity: input.integrity,
      state: existing?.state === "enabled" ? "enabled" : "installed",
      compatibility_tier: input.compatibilityTier,
      manifest_json: JSON.stringify(input.manifest.raw),
      install_plan_json: input.installPlanJson ?? null,
      archive_r2_key: input.archiveR2Key ?? null,
      created_at: existing?.created_at ?? now,
      updated_at: now,
    });

    const runtimeState = await this.options.runtimeState.getPluginRuntimeState(input.manifest.pluginId);

    if (!runtimeState) {
      await this.options.runtimeState.setPluginRuntimeState({
        plugin_id: input.manifest.pluginId,
        enabled: existing?.state === "enabled" ? 1 : 0,
        runtime_state_json: "{}",
        updated_at: now,
      });
    }

    return {
      pluginId: input.manifest.pluginId,
      version: input.manifest.version,
      manifest: input.manifest,
      enabled: runtimeState?.enabled === 1 || existing?.state === "enabled",
    };
  }

  async enable(pluginId: string): Promise<InstalledPlugin> {
    const installed = await this.options.d1.getPluginInstall(this.options.accountId, this.options.agentId, pluginId);

    if (!installed) {
      throw new Error(`Plugin ${pluginId} is not installed.`);
    }

    const now = (this.options.now ?? (() => new Date()))().toISOString();
    const runtimeState = await this.options.runtimeState.getPluginRuntimeState(pluginId);

    await this.options.runtimeState.setPluginRuntimeState({
      plugin_id: pluginId,
      enabled: 1,
      runtime_state_json: runtimeState?.runtime_state_json ?? "{}",
      updated_at: now,
    });
    await this.options.d1.upsertPluginInstall({
      ...installed,
      state: "enabled",
      updated_at: now,
    });

    return toInstalledPlugin({
      pluginId: installed.plugin_id,
      version: installed.version ?? "0.0.0",
      manifestJson: installed.manifest_json,
      enabled: true,
    });
  }

  async get(pluginId: string): Promise<InstalledPlugin | null> {
    const installed = await this.options.d1.getPluginInstall(this.options.accountId, this.options.agentId, pluginId);

    if (!installed) {
      return null;
    }

    const runtimeState = await this.options.runtimeState.getPluginRuntimeState(pluginId);

    return toInstalledPlugin({
      pluginId: installed.plugin_id,
      version: installed.version ?? "0.0.0",
      manifestJson: installed.manifest_json,
      enabled: runtimeState?.enabled === 1 || installed.state === "enabled",
    });
  }

  async enabledSkills(): Promise<ClawHubSkill[]> {
    const installs = await this.options.d1.listPluginInstalls(this.options.accountId, this.options.agentId);
    const states = await this.options.runtimeState.listPluginRuntimeStates();
    const enabledPluginIds = new Set(
      states.filter((state) => state.enabled === 1).map((state) => state.plugin_id),
    );

    for (const install of installs) {
      if (install.state === "enabled") {
        enabledPluginIds.add(install.plugin_id);
      }
    }

    return installs
      .filter((install) => enabledPluginIds.has(install.plugin_id))
      .flatMap((install) => parseStoredManifest(install.plugin_id, install.version ?? "0.0.0", install.manifest_json).skills);
  }
}

export async function manifestIntegrity(manifest: ParsedPluginManifest): Promise<string> {
  return await sha256Hex(JSON.stringify(manifest.raw));
}
