import type { ClawflareEnv } from "../env";
import type { R2Storage } from "../storage/r2";
import { pluginArchiveKey, pluginManifestKey } from "../storage/keys";
import { ClawHubClient } from "./clawhub-client";
import { createPluginInstallPlan, type PluginInstallPlan } from "./install-plan";
import { parsePluginManifest } from "./manifest";
import { resolvePluginRef } from "./resolver";
import { scanPluginSource } from "./scanner";
import type { ClawHubPackage, ClawHubSkill, InstalledPlugin, ParsedPluginManifest } from "./types";
import { manifestIntegrity, type PluginStore } from "./registry";
import type { AuditSink } from "../security/audit";
import { pluginAudit } from "../security/audit";

export interface PluginRuntimeOptions {
  env: ClawflareEnv;
  accountId: string;
  agentId: string;
  client?: ClawHubClient;
  store: PluginStore;
  r2?: Pick<R2Storage, "putPluginManifest" | "putPluginArchive">;
  audit?: AuditSink;
}

export class ClawflarePluginRuntime {
  private readonly client: ClawHubClient;

  constructor(private readonly options: PluginRuntimeOptions) {
    this.client =
      options.client ??
      new ClawHubClient({
        ...(options.env.CLAWHUB_API_BASE_URL === undefined ? {} : { baseUrl: options.env.CLAWHUB_API_BASE_URL }),
        cache: options.env.CATALOG_CACHE,
      });
  }

  async search(query: string): Promise<ClawHubPackage[]> {
    return await this.client.search(query);
  }

  async inspect(ref: string): Promise<ParsedPluginManifest> {
    const pkg = await this.client.inspect(resolvePluginRef(ref));
    return parsePluginManifest(pkg);
  }

  async planInstall(ref: string): Promise<PluginInstallPlan> {
    const pkg = await this.client.inspect(resolvePluginRef(ref));
    const manifest = parsePluginManifest(pkg);
    const scan = scanPluginSource(pkg.source === undefined ? {} : { source: pkg.source });
    return createPluginInstallPlan(manifest, scan);
  }

  async install(ref: string): Promise<InstalledPlugin> {
    const pkg = await this.client.inspect(resolvePluginRef(ref));
    const manifest = parsePluginManifest(pkg);
    const plan = createPluginInstallPlan(manifest, scanPluginSource(pkg.source === undefined ? {} : { source: pkg.source }));

    if (plan.status !== "ready") {
      throw new Error("Plugin install is blocked by the install plan.");
    }

    const manifestR2Key = pluginManifestKey({
      accountId: this.options.accountId,
      agentId: this.options.agentId,
      pluginId: manifest.pluginId,
      version: manifest.version,
    });
    const archiveR2Key = pluginArchiveKey({
      accountId: this.options.accountId,
      agentId: this.options.agentId,
      pluginId: manifest.pluginId,
      version: manifest.version,
    });

    await this.options.r2?.putPluginManifest(manifestR2Key, JSON.stringify(manifest.raw));

    if (pkg.archiveUrl !== undefined && this.options.r2 !== undefined) {
      const response = await fetch(pkg.archiveUrl);

      if (!response.ok) {
        throw new Error(`Plugin archive fetch failed with ${response.status}.`);
      }

      await this.options.r2.putPluginArchive(archiveR2Key, await response.arrayBuffer());
    } else if (pkg.source !== undefined && this.options.r2 !== undefined) {
      await this.options.r2.putPluginArchive(archiveR2Key, new TextEncoder().encode(pkg.source).buffer);
    }

    const installed = await this.options.store.install({
      manifest,
      source: "clawhub",
      integrity: await manifestIntegrity(manifest),
      compatibilityTier: plan.compatibilityTier,
      installPlanJson: JSON.stringify(plan),
      archiveR2Key: this.options.r2 === undefined ? null : archiveR2Key,
    });
    await this.options.audit?.record(
      pluginAudit("plugin.install", {
        accountId: this.options.accountId,
        agentId: this.options.agentId,
        pluginId: manifest.pluginId,
        payload: { version: manifest.version },
      }),
    );

    return installed;
  }

  async enable(pluginId: string): Promise<InstalledPlugin> {
    const enabled = await this.options.store.enable(pluginId);
    await this.options.audit?.record(
      pluginAudit("plugin.enable", {
        accountId: this.options.accountId,
        agentId: this.options.agentId,
        pluginId,
      }),
    );

    return enabled;
  }

  async enabledSkills(): Promise<ClawHubSkill[]> {
    return await this.options.store.enabledSkills();
  }
}
