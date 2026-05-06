import { describe, expect, it } from "vitest";
import type { ClawflareEnv } from "../src/env";
import { PolicyError } from "../src/security/policy";
import { createDefaultToolRegistry } from "../src/tools/registry";
import { ToolError, type ToolInvokeContext } from "../src/tools/runtime";
import { MemoryWorkspaceIndex, R2WorkspaceBackend } from "../src/tools/workspace";

class FakeWorkspaceR2 {
  readonly objects = new Map<string, string>();

  async putWorkspaceObject(key: string, body: string | ArrayBuffer | ReadableStream): Promise<R2Object> {
    this.objects.set(key, typeof body === "string" ? body : "[binary]");

    return {
      key,
      version: "fake",
      size: this.objects.get(key)?.length ?? 0,
      etag: "etag",
      httpEtag: '"etag"',
      uploaded: new Date("2026-05-06T00:00:00.000Z"),
      checksums: {},
    } as R2Object;
  }

  async getWorkspaceObjectText(key: string): Promise<string | null> {
    return this.objects.get(key) ?? null;
  }
}

function createContext(overrides?: Partial<ToolInvokeContext>): ToolInvokeContext {
  return {
    env: {} as ClawflareEnv,
    accountId: "acct",
    agentId: "agent",
    policy: {
      allowRead: true,
      allowWrite: true,
      allowNetwork: true,
      allowChannelSend: true,
      allowMemory: true,
    },
    ...overrides,
  };
}

describe("tool registry", () => {
  it("returns a catalog of built-in tools", () => {
    const catalog = createDefaultToolRegistry().catalog();

    expect(catalog.map((tool) => tool.name)).toEqual([
      "workspace_list",
      "workspace_read",
      "workspace_write",
      "workspace_patch",
      "web_fetch",
      "message_send",
      "memory_search",
    ]);
  });

  it("validates tool schemas before invocation", async () => {
    await expect(createDefaultToolRegistry().invoke("workspace_write", { path: "a.txt" }, createContext())).rejects.toBeInstanceOf(
      ToolError,
    );
  });

  it("enforces tool policy", async () => {
    await expect(
      createDefaultToolRegistry().invoke(
        "workspace_write",
        { path: "a.txt", content: "hello" },
        createContext({ policy: { allowRead: true, allowWrite: false } }),
      ),
    ).rejects.toBeInstanceOf(PolicyError);
  });
});

describe("workspace tools", () => {
  it("write, list, read, and patch files through an R2-backed workspace", async () => {
    const registry = createDefaultToolRegistry();
    const workspace = new R2WorkspaceBackend({
      accountId: "acct",
      agentId: "agent",
      r2: new FakeWorkspaceR2(),
      index: new MemoryWorkspaceIndex(),
      now: () => new Date("2026-05-06T00:00:00.000Z"),
    });
    const context = createContext({ workspace });

    await expect(
      registry.invoke("workspace_write", { path: "notes/todo.md", content: "hello world" }, context),
    ).resolves.toMatchObject({
      path: "notes/todo.md",
      contentType: "text/plain; charset=utf-8",
    });
    await expect(registry.invoke("workspace_list", {}, context)).resolves.toMatchObject({
      files: [{ path: "notes/todo.md" }],
    });
    await expect(registry.invoke("workspace_read", { path: "notes/todo.md" }, context)).resolves.toMatchObject({
      content: "hello world",
    });
    await expect(
      registry.invoke("workspace_patch", { path: "notes/todo.md", find: "world", replace: "clawflare" }, context),
    ).resolves.toMatchObject({
      content: "hello clawflare",
    });
  });
});

describe("network and channel tools", () => {
  it("denies private web fetch targets", async () => {
    await expect(createDefaultToolRegistry().invoke("web_fetch", { url: "http://127.0.0.1/" }, createContext())).rejects.toMatchObject({
      code: "WEB_FETCH_DENIED",
    });
  });

  it("fetches allowlisted public URLs with response caps", async () => {
    const response = await createDefaultToolRegistry().invoke(
      "web_fetch",
      { url: "https://example.com/page" },
      createContext({
        policy: {
          allowNetwork: true,
          webFetchAllowlist: ["example.com"],
        },
        fetcher: async () => new Response("hello", { status: 200, headers: { "content-type": "text/plain" } }),
      }),
    );

    expect(response).toMatchObject({
      status: 200,
      contentType: "text/plain",
      text: "hello",
      truncated: false,
    });
  });

  it("sends messages through the channel runtime", async () => {
    const sent: unknown[] = [];

    await expect(
      createDefaultToolRegistry().invoke(
        "message_send",
        { channel: "telegram", peerId: "42", text: "hello" },
        createContext({
          channelRuntime: {
            async sendMessage(input) {
              sent.push(input);
              return { ok: true };
            },
          },
        }),
      ),
    ).resolves.toEqual({ ok: true });
    expect(sent).toEqual([{ channel: "telegram", peerId: "42", text: "hello" }]);
  });

  it("returns memory search stub results", async () => {
    await expect(createDefaultToolRegistry().invoke("memory_search", { query: "hello" }, createContext())).resolves.toEqual({
      query: "hello",
      matches: [],
      backing: "stub",
    });
  });
});
