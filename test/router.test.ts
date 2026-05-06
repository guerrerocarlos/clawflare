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

  it("dispatches reserved compatibility routes to structured NOT_IMPLEMENTED responses", async () => {
    const routes = [
      ["POST", "/tools/invoke"],
    ] as const;

    for (const [method, path] of routes) {
      const response = await routeRequest(new Request(`https://example.test${path}`, { method }), {} as ClawflareEnv, ctx);
      const payload = (await response.json()) as any;

      expect(response.status).toBe(501);
      expect(payload).toMatchObject({
        ok: false,
        error: {
          code: "NOT_IMPLEMENTED",
          details: {
            route: `${method} ${path}`,
          },
        },
      });
    }
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
