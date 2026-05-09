import { describe, expect, it } from "vitest";
import { handleFetch } from "../src/entry";
import type { ClawflareEnv } from "../src/env";

describe("entry worker", () => {
  it("returns process health", async () => {
    const response = await handleFetch(new Request("https://example.test/healthz"), {} as ClawflareEnv);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      ok: true,
      service: "clawflare",
      runtime: "cloudflare-workers",
      defaults: {
        accountId: "local",
        agentId: "main",
        environment: "dev",
      },
    });
  });

  it("requires auth for /tools/invoke", async () => {
    const response = await handleFetch(new Request("https://example.test/tools/invoke", { method: "POST" }), {} as ClawflareEnv);
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload).toMatchObject({
      ok: false,
      error: {
        code: "UNAUTHORIZED",
      },
    });
  });
});
