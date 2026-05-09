import { describe, expect, it } from "vitest";
import type { ClawflareEnv } from "../src/env";
import { buildPrompt } from "../src/agents/prompt";
import { ClawHubClient } from "../src/plugins/clawhub-client";
import { createPluginInstallPlan } from "../src/plugins/install-plan";
import { parsePluginManifest } from "../src/plugins/manifest";
import { DurablePluginStore, MemoryPluginStore } from "../src/plugins/registry";
import { resolvePluginRef } from "../src/plugins/resolver";
import { ClawflarePluginRuntime } from "../src/plugins/runtime";
import { scanPluginSource } from "../src/plugins/scanner";
import type { ClawHubPackage } from "../src/plugins/types";
import type { PluginInstallRecord } from "../src/storage/d1";
import type { PluginRuntimeStateRecord } from "../src/storage/do-sqlite";

class FakeCache {
  readonly values = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async put(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }
}

class FakePluginR2 {
  readonly manifests = new Map<string, string>();
  readonly archives = new Map<string, ArrayBuffer | ReadableStream>();

  async putPluginManifest(key: string, body: string): Promise<unknown> {
    this.manifests.set(key, body);
    return undefined;
  }

  async putPluginArchive(key: string, body: ArrayBuffer | ReadableStream): Promise<unknown> {
    this.archives.set(key, body);
    return undefined;
  }
}

class FakePluginInstallStorage {
  readonly records = new Map<string, PluginInstallRecord>();

  async upsertPluginInstall(record: PluginInstallRecord): Promise<void> {
    this.records.set(`${record.account_id}:${record.agent_id}:${record.plugin_id}`, record);
  }

  async getPluginInstall(accountId: string, agentId: string, pluginId: string): Promise<PluginInstallRecord | null> {
    return this.records.get(`${accountId}:${agentId}:${pluginId}`) ?? null;
  }

  async listPluginInstalls(accountId: string, agentId: string): Promise<PluginInstallRecord[]> {
    return [...this.records.values()].filter((record) => record.account_id === accountId && record.agent_id === agentId);
  }
}

class FakePluginRuntimeStateStorage {
  readonly records = new Map<string, PluginRuntimeStateRecord>();

  async setPluginRuntimeState(record: PluginRuntimeStateRecord): Promise<void> {
    this.records.set(record.plugin_id, record);
  }

  async getPluginRuntimeState(pluginId: string): Promise<PluginRuntimeStateRecord | null> {
    return this.records.get(pluginId) ?? null;
  }

  async listPluginRuntimeStates(): Promise<PluginRuntimeStateRecord[]> {
    return [...this.records.values()];
  }
}

const skillPackage: ClawHubPackage = {
  name: "example",
  version: "1.0.0",
  source: "export default {}",
  manifest: {
    id: "example",
    version: "1.0.0",
    description: "Example skill plugin",
    skills: [{ name: "style", description: "Style guide", content: "Always be concise." }],
  },
};

const nativePackage: ClawHubPackage = {
  name: "native",
  version: "1.0.0",
  manifest: {
    id: "native",
    version: "1.0.0",
    runtime: "node",
    skills: [{ name: "native-skill", content: "Native advice." }],
  },
};

function response(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    headers: { "content-type": "application/json" },
  });
}

describe("plugin resolver and client", () => {
  it("resolves ClawHub refs", () => {
    expect(resolvePluginRef("clawhub:example@1.2.3")).toEqual({
      source: "clawhub",
      name: "example",
      version: "1.2.3",
    });
    expect(resolvePluginRef("example")).toEqual({
      source: "clawhub",
      name: "example",
    });
  });

  it("searches ClawHub with KV cache", async () => {
    const cache = new FakeCache();
    let calls = 0;
    const client = new ClawHubClient({
      baseUrl: "https://clawhub.test",
      cache,
      fetcher: async () => {
        calls += 1;
        return response({ packages: [skillPackage] });
      },
    });

    await expect(client.search("example")).resolves.toEqual([skillPackage]);
    await expect(client.search("example")).resolves.toEqual([skillPackage]);
    expect(calls).toBe(1);
  });
});

describe("plugin planning", () => {
  it("parses skill and native manifests", () => {
    expect(parsePluginManifest(skillPackage)).toMatchObject({
      pluginId: "example",
      version: "1.0.0",
      native: false,
      skills: [{ name: "style", content: "Always be concise." }],
    });
    expect(parsePluginManifest(nativePackage)).toMatchObject({
      pluginId: "native",
      native: true,
    });
  });

  it("blocks forbidden APIs and native plugin execution", () => {
    expect(scanPluginSource({ source: "import child_process from 'node:child_process'" })).toMatchObject({
      ok: false,
      findings: [{ code: "FORBIDDEN_API" }],
    });
    expect(createPluginInstallPlan(parsePluginManifest(nativePackage), { ok: true, findings: [] })).toMatchObject({
      status: "blocked",
      compatibilityTier: 0,
      warnings: ["Native plugin execution is fail-closed in the MVP."],
    });
  });

  it("plans ready skill installs", () => {
    expect(createPluginInstallPlan(parsePluginManifest(skillPackage), { ok: true, findings: [] })).toMatchObject({
      status: "ready",
      compatibilityTier: 1,
      skills: ["style"],
      actions: ["download", "quarantine", "install-skills"],
    });
  });
});

describe("plugin runtime", () => {
  it("installs and enables ClawHub skills only", async () => {
    const store = new MemoryPluginStore();
    const r2 = new FakePluginR2();
    const runtime = new ClawflarePluginRuntime({
      env: { CATALOG_CACHE: new FakeCache() as unknown as KVNamespace } as ClawflareEnv,
      accountId: "acct",
      agentId: "agent",
      store,
      r2: r2 as any,
      client: new ClawHubClient({
        baseUrl: "https://clawhub.test",
        fetcher: async () => response(skillPackage),
      }),
    });

    await expect(runtime.planInstall("example")).resolves.toMatchObject({ status: "ready" });
    await expect(runtime.install("example")).resolves.toMatchObject({ pluginId: "example", enabled: false });
    await expect(runtime.enable("example")).resolves.toMatchObject({ pluginId: "example", enabled: true });
    await expect(runtime.enabledSkills()).resolves.toEqual([
      { name: "style", description: "Style guide", content: "Always be concise." },
    ]);
    expect([...r2.manifests.keys()][0]).toContain("accounts/acct/agents/agent/plugins/example/1.0.0/manifest.json");
    expect([...r2.archives.keys()][0]).toContain("accounts/acct/agents/agent/plugins/example/1.0.0/archive.tgz");
  });

  it("fails closed for native plugins", async () => {
    const runtime = new ClawflarePluginRuntime({
      env: { CATALOG_CACHE: new FakeCache() as unknown as KVNamespace } as ClawflareEnv,
      accountId: "acct",
      agentId: "agent",
      store: new MemoryPluginStore(),
      client: new ClawHubClient({
        baseUrl: "https://clawhub.test",
        fetcher: async () => response(nativePackage),
      }),
    });

    await expect(runtime.install("native")).rejects.toThrow("blocked");
  });

  it("persists plugin install and enable state across store instances", async () => {
    const installs = new FakePluginInstallStorage();
    const runtimeState = new FakePluginRuntimeStateStorage();
    const manifest = parsePluginManifest(skillPackage);
    const storeA = new DurablePluginStore({
      accountId: "acct",
      agentId: "agent",
      d1: installs as any,
      runtimeState: runtimeState as any,
      now: () => new Date("2026-05-09T16:00:00.000Z"),
    });

    await expect(
      storeA.install({
        manifest,
        source: "clawhub",
        integrity: "sha256:test",
        compatibilityTier: 1,
        installPlanJson: '{"status":"ready"}',
        archiveR2Key: "accounts/acct/agents/agent/plugins/example/1.0.0/archive.tgz",
      }),
    ).resolves.toMatchObject({
      pluginId: "example",
      enabled: false,
    });
    await expect(storeA.enable("example")).resolves.toMatchObject({
      pluginId: "example",
      enabled: true,
    });

    const storeB = new DurablePluginStore({
      accountId: "acct",
      agentId: "agent",
      d1: installs as any,
      runtimeState: runtimeState as any,
      now: () => new Date("2026-05-09T16:05:00.000Z"),
    });

    await expect(storeB.get("example")).resolves.toMatchObject({
      pluginId: "example",
      enabled: true,
    });
    await expect(storeB.enabledSkills()).resolves.toEqual([
      { name: "style", description: "Style guide", content: "Always be concise." },
    ]);
  });

  it("includes enabled ClawHub skills in prompt assembly", () => {
    const prompt = buildPrompt(
      { messages: [{ role: "user", content: "hello" }] },
      { accountId: "acct", agentId: "agent", sessionKey: "session" },
      { skills: [{ name: "style", content: "Always be concise." }] },
    );

    expect(prompt).toContain("<clawflare-skills>");
    expect(prompt).toContain("Always be concise.");
  });
});
