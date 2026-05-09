import { describe, expect, it } from "vitest";
import { routeRequest } from "../src/router";
import type { ClawflareEnv } from "../src/env";

const ctx = {
  waitUntil() {},
  passThroughOnException() {},
  props: {},
} satisfies ExecutionContext;

describe("router", () => {
  it("serves health with protocol metadata", async () => {
    const response = await routeRequest(new Request("https://example.test/healthz"), {} as ClawflareEnv, ctx);
    const payload = (await response.json()) as any;

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      ok: true,
      service: "clawflare",
      protocol: {
        version: 3,
      },
    });
    expect(payload.protocol.methods).toContain("connect");
  });

  it("requires bearer auth for /tools/invoke", async () => {
    const response = await routeRequest(new Request("https://example.test/tools/invoke", { method: "POST" }), {} as ClawflareEnv, ctx);
    const payload = (await response.json()) as any;

    expect(response.status).toBe(401);
    expect(payload).toMatchObject({
      ok: false,
      error: {
        code: "UNAUTHORIZED",
      },
    });
  });

  it("forwards /tools/invoke to the agent object", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const env = {
      CLAWFLARE_GATEWAY_TOKEN: "secret",
      CLAWFLARE_DEFAULT_ACCOUNT_ID: "acct",
      CLAWFLARE_DEFAULT_AGENT_ID: "agent",
      AGENT_OBJECT: {
        idFromName(name: string) {
          return name as unknown as DurableObjectId;
        },
        get() {
          return {
            fetch: async (request: Request) => {
              calls.push({ url: request.url, body: await request.json() });
              return new Response(JSON.stringify({ ok: true, tool: "web_fetch", result: { text: "router-tool-ok" } }), {
                headers: { "content-type": "application/json" },
              });
            },
          } as DurableObjectStub;
        },
      } as unknown as DurableObjectNamespace,
    } as ClawflareEnv;

    const response = await routeRequest(
      new Request("https://example.test/tools/invoke", {
        method: "POST",
        headers: {
          authorization: "Bearer secret",
          "content-type": "application/json",
        },
        body: JSON.stringify({ tool: "web_fetch", input: { url: "https://example.com" } }),
      }),
      env,
      ctx,
    );
    const payload = (await response.json()) as any;

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      ok: true,
      tool: "web_fetch",
      result: {
        text: "router-tool-ok",
      },
    });
    expect(calls).toEqual([
      {
        url: "https://example.test/__clawflare/agent/tools/invoke",
        body: { tool: "web_fetch", input: { url: "https://example.com" } },
      },
    ]);
  });

  it("returns method errors for known paths with unsupported methods", async () => {
    const response = await routeRequest(new Request("https://example.test/v1/models", { method: "POST" }), {} as ClawflareEnv, ctx);
    const payload = (await response.json()) as any;

    expect(response.status).toBe(405);
    expect(payload.error.code).toBe("METHOD_NOT_ALLOWED");
  });

  it("guards /ws until a WebSocket upgrade is provided", async () => {
    const response = await routeRequest(new Request("https://example.test/ws"), {} as ClawflareEnv, ctx);
    const payload = (await response.json()) as any;

    expect(response.status).toBe(400);
    expect(payload.error.code).toBe("BAD_REQUEST");
  });
});
