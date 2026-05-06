import { describe, expect, it } from "vitest";
import type { ClawflareEnv } from "../src/env";
import { routeRequest } from "../src/router";

const ctx = {
  waitUntil() {},
  passThroughOnException() {},
  props: {},
} satisfies ExecutionContext;

function json(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    headers: { "content-type": "application/json" },
  });
}

function createEnv(): ClawflareEnv {
  const stub = {
    fetch: async () =>
      json({
        result: {
          status: "completed",
          summary: {
            outputText: "webchat output",
          },
        },
      }),
  };

  return {
    CLAWFLARE_GATEWAY_TOKEN: "token",
    AGENT_OBJECT: {
      idFromName: () => ({}) as DurableObjectId,
      get: () => stub as unknown as DurableObjectStub,
    } as unknown as DurableObjectNamespace,
  } as ClawflareEnv;
}

describe("debug WebChat", () => {
  it("serves a debug/control-only page", async () => {
    const response = await routeRequest(new Request("https://example.test/"), {} as ClawflareEnv, ctx);
    const html = await response.text();

    expect(response.headers.get("content-type")).toContain("text/html");
    expect(html).toContain("Clawflare Debug WebChat");
    expect(html).toContain("Debug/control-only");
  });

  it("requires auth for WebChat sends", async () => {
    const response = await routeRequest(
      new Request("https://example.test/webchat/message", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "hello" }),
      }),
      createEnv(),
      ctx,
    );

    expect(response.status).toBe(401);
  });

  it("sends WebChat messages through the AgentObject run path", async () => {
    const response = await routeRequest(
      new Request("https://example.test/webchat/message", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer token" },
        body: JSON.stringify({ message: "hello" }),
      }),
      createEnv(),
      ctx,
    );
    const payload = await response.json();

    expect(payload).toEqual({
      ok: true,
      channel: "webchat",
      debugOnly: true,
      output: "webchat output",
    });
  });
});
