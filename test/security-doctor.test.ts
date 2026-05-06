import { describe, expect, it } from "vitest";
import type { ClawflareEnv } from "../src/env";
import { authenticateBearer, AuthError, requireScopes } from "../src/security/auth";
import { channelAllowlistAudit, configWriteAudit, pluginAudit, redact, type AuditEvent, type AuditSink } from "../src/security/audit";
import { runDoctor } from "../src/cli/doctor";
import { routeRequest } from "../src/router";

const ctx = {
  waitUntil() {},
  passThroughOnException() {},
  props: {},
} satisfies ExecutionContext;

class MemoryAuditSink implements AuditSink {
  readonly events: AuditEvent[] = [];

  async record(event: AuditEvent): Promise<void> {
    this.events.push(event);
  }
}

function healthyEnv(): ClawflareEnv {
  return {
    CLAWFLARE_GATEWAY_TOKEN: "token",
    TELEGRAM_BOT_TOKEN: "telegram",
    TELEGRAM_WEBHOOK_SECRET: "secret",
    TELEGRAM_ALLOWED_USER_IDS: "1",
    AGENT_OBJECT: {} as DurableObjectNamespace,
    DB: {} as D1Database,
    CATALOG_CACHE: {} as KVNamespace,
  } as ClawflareEnv;
}

describe("auth helpers", () => {
  it("authenticates bearer tokens and checks scopes", () => {
    const principal = authenticateBearer(new Request("https://example.test", { headers: { authorization: "Bearer token" } }), healthyEnv());

    expect(principal.scopes).toContain("admin");
    expect(() => requireScopes(principal, ["read", "write"])).not.toThrow();
    expect(() => authenticateBearer(new Request("https://example.test"), healthyEnv())).toThrow(AuthError);
  });
});

describe("audit helpers", () => {
  it("redacts sensitive payload values", () => {
    expect(redact({ token: "secret", nested: { apiKey: "key", safe: "value" } })).toEqual({
      token: "[REDACTED]",
      nested: {
        apiKey: "[REDACTED]",
        safe: "value",
      },
    });
  });

  it("builds plugin, channel, and config audit events", async () => {
    const sink = new MemoryAuditSink();
    await sink.record(pluginAudit("plugin.install", { accountId: "acct", agentId: "agent", pluginId: "plug" }));
    await sink.record(channelAllowlistAudit({ accountId: "acct", senderId: "telegram:1", allowed: true }));
    await sink.record(configWriteAudit({ accountId: "acct", key: "OPENAI_API_KEY", value: "secret" }));

    expect(sink.events.map((event) => event.action)).toEqual([
      "plugin.install",
      "channel.allowlist.change",
      "config.write",
    ]);
    expect(sink.events[2]?.payload).toMatchObject({
      value: "[REDACTED]",
    });
  });
});

describe("doctor", () => {
  it("reports healthy required configuration", async () => {
    await expect(runDoctor(healthyEnv())).resolves.toMatchObject({
      ok: true,
    });
  });

  it("flags unsafe Telegram webhook configuration", async () => {
    const env = healthyEnv();
    delete (env as { TELEGRAM_WEBHOOK_SECRET?: string }).TELEGRAM_WEBHOOK_SECRET;
    const report = await runDoctor(env);

    expect(report.ok).toBe(false);
    expect(report.checks.some((check) => check.name === "telegram.unsafe_webhook" && !check.ok)).toBe(true);
  });

  it("serves authenticated doctor route", async () => {
    const response = await routeRequest(
      new Request("https://example.test/doctor", { headers: { authorization: "Bearer token" } }),
      healthyEnv(),
      ctx,
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({ ok: true });
  });
});
