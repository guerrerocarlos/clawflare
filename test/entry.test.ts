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

  it("returns structured placeholders for reserved routes", async () => {
    const response = await handleFetch(new Request("https://example.test/v1/models"), {} as ClawflareEnv);
    const payload = await response.json();

    expect(response.status).toBe(501);
    expect(payload).toMatchObject({
      ok: false,
      error: {
        code: "NOT_IMPLEMENTED",
        details: {
          route: "GET /v1/models",
        },
      },
    });
  });
});
