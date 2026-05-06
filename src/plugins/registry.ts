import type { ClawHubSkill, InstalledPlugin, ParsedPluginManifest } from "./types";

export interface PluginStore {
  install(manifest: ParsedPluginManifest): Promise<InstalledPlugin>;
  enable(pluginId: string): Promise<InstalledPlugin>;
  get(pluginId: string): Promise<InstalledPlugin | null>;
  enabledSkills(): Promise<ClawHubSkill[]>;
}

export class MemoryPluginStore implements PluginStore {
  private readonly plugins = new Map<string, InstalledPlugin>();

  async install(manifest: ParsedPluginManifest): Promise<InstalledPlugin> {
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
