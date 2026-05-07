import { afterEach, describe, expect, it, vi } from "vitest";
import type { ClawflareEnv, QueuePayload } from "../src/env";
import { routeRequest } from "../src/router";
import { splitTelegramText } from "../src/channels/telegram-delivery";

const ctx = {
  waitUntil() {},
  passThroughOnException() {},
  props: {},
} satisfies ExecutionContext;

class FakeKv {
  readonly values = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async put(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }
}

class FakeQueue {
  readonly messages: QueuePayload[] = [];

  async send(message: QueuePayload): Promise<unknown> {
    this.messages.push(message);
    return undefined;
  }
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function createTelegramEnv(options?: { allowed?: string; botResponse?: string; queue?: FakeQueue; kv?: FakeKv }): ClawflareEnv {
  const queue = options?.queue ?? new FakeQueue();
  const kv = options?.kv ?? new FakeKv();
  const stub = {
    fetch: async () =>
      json({
        accepted: { runId: "run-1" },
        result: {
          status: "completed",
          summary: {
            outputText: options?.botResponse ?? "agent says hi",
          },
        },
      }),
  };

  return {
    CLAWFLARE_GATEWAY_TOKEN: "token",
    CLAWFLARE_PUBLIC_BASE_URL: "https://clawflare.omattic.com",
    CLAWFLARE_DEFAULT_ACCOUNT_ID: "acct",
    CLAWFLARE_DEFAULT_AGENT_ID: "agent",
    TELEGRAM_BOT_TOKEN: "telegram-token",
    TELEGRAM_WEBHOOK_SECRET: "telegram-secret",
    TELEGRAM_BOT_USERNAME: "clawflare_bot",
    TELEGRAM_ALLOWED_USER_IDS: options?.allowed,
    CATALOG_CACHE: kv as unknown as KVNamespace,
    CHANNEL_DELIVERY_QUEUE: queue as unknown as Queue<QueuePayload>,
    AGENT_OBJECT: {
      idFromName: () => ({}) as DurableObjectId,
      get: () => stub as unknown as DurableObjectStub,
    } as unknown as DurableObjectNamespace,
  } as ClawflareEnv;
}

function webhookRequest(update: unknown, secret = "telegram-secret"): Request {
  return new Request("https://example.test/webhook/telegram", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-telegram-bot-api-secret-token": secret,
    },
    body: JSON.stringify(update),
  });
}

function privateMessageUpdate(text: string, fromId = 1, updateId = 100) {
  return {
    update_id: updateId,
    message: {
      message_id: 10,
      text,
      chat: { id: 99, type: "private" },
      from: { id: fromId, username: "user" },
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("telegram webhook", () => {
  it("rejects invalid Telegram webhook secrets", async () => {
    const response = await routeRequest(webhookRequest(privateMessageUpdate("hello"), "wrong"), createTelegramEnv({ allowed: "1" }), ctx);

    expect(response.status).toBe(401);
  });

  it("dedupes by Telegram update_id", async () => {
    const fetchCalls: Array<{ input: RequestInfo | URL; init: RequestInit | undefined }> = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push({ input, init });
      return json({ ok: true });
    });
    const kv = new FakeKv();
    const env = createTelegramEnv({ allowed: "1", kv });

    await routeRequest(webhookRequest(privateMessageUpdate("hello", 1, 101)), env, ctx);
    const second = await routeRequest(webhookRequest(privateMessageUpdate("hello", 1, 101)), env, ctx);
    const payload = await second.json();

    expect(payload).toMatchObject({ ok: true, deduped: true });
    expect(fetchCalls).toHaveLength(1);
  });

  it("normalizes allowed direct messages, invokes the agent, and replies", async () => {
    const fetchCalls: Array<{ input: RequestInfo | URL; init: RequestInit | undefined }> = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push({ input, init });
      return json({ ok: true });
    });

    const response = await routeRequest(webhookRequest(privateMessageUpdate("hello")), createTelegramEnv({ allowed: "1" }), ctx);
    const payload = await response.json();

    expect(payload).toEqual({ ok: true });
    expect(fetchCalls[0]?.input.toString()).toBe("https://api.telegram.org/bottelegram-token/sendMessage");
    expect(JSON.parse(fetchCalls[0]?.init?.body as string)).toMatchObject({
      chat_id: "99",
      text: "agent says hi",
      reply_to_message_id: 10,
    });
  });

  it("requires mention or command in groups", async () => {
    const fetchCalls: unknown[] = [];
    vi.stubGlobal("fetch", async (...args: unknown[]) => {
      fetchCalls.push(args);
      return json({ ok: true });
    });
    const response = await routeRequest(
      webhookRequest({
        update_id: 102,
        message: {
          message_id: 10,
          text: "hello",
          chat: { id: -100, type: "supergroup" },
          from: { id: 1, username: "user" },
        },
      }),
      createTelegramEnv({ allowed: "1" }),
      ctx,
    );
    const payload = await response.json();

    expect(payload).toEqual({ ok: true, ignored: true });
    expect(fetchCalls).toHaveLength(0);
  });

  it("responds with pending approval for unknown senders", async () => {
    const fetchCalls: Array<{ input: RequestInfo | URL; init: RequestInit | undefined }> = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push({ input, init });
      return json({ ok: true });
    });
    const response = await routeRequest(webhookRequest(privateMessageUpdate("hello", 123)), createTelegramEnv(), ctx);
    const payload = await response.json();

    expect(payload).toEqual({ ok: true, pendingApproval: true });
    expect(JSON.parse(fetchCalls[0]?.init?.body as string).text).toContain("not paired");
  });

  it("enqueues retryable Telegram delivery failures", async () => {
    vi.stubGlobal("fetch", async () => json({ ok: false }, 429));
    const queue = new FakeQueue();

    await routeRequest(webhookRequest(privateMessageUpdate("/status")), createTelegramEnv({ allowed: "1", queue }), ctx);

    expect(queue.messages).toHaveLength(1);
    expect(queue.messages[0]).toMatchObject({
      type: "channel.delivery.retry",
      payload: {
        channel: "telegram",
        chatId: "99",
      },
    });
  });

  it("does not retry permanent Telegram authorization failures", async () => {
    vi.stubGlobal("fetch", async () => json({ ok: false }, 403));
    const queue = new FakeQueue();

    await routeRequest(webhookRequest(privateMessageUpdate("/status")), createTelegramEnv({ allowed: "1", queue }), ctx);

    expect(queue.messages).toHaveLength(0);
  });

  it("supports plugin install command text", async () => {
    const fetchCalls: Array<{ input: RequestInfo | URL; init: RequestInit | undefined }> = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push({ input, init });
      return json({ ok: true });
    });

    await routeRequest(webhookRequest(privateMessageUpdate("/plugin install clawhub:example")), createTelegramEnv({ allowed: "1" }), ctx);

    expect(JSON.parse(fetchCalls[0]?.init?.body as string).text).toContain("Plugin install plan requested");
  });
});

describe("telegram control routes", () => {
  it("returns authenticated Telegram status", async () => {
    const response = await routeRequest(
      new Request("https://example.test/telegram/status", {
        headers: { authorization: "Bearer token" },
      }),
      createTelegramEnv({ allowed: "1" }),
      ctx,
    );
    const payload = await response.json();

    expect(payload).toMatchObject({
      ok: true,
      telegram: {
        botTokenConfigured: true,
        webhookSecretConfigured: true,
        webhookUrl: "https://clawflare.omattic.com/webhook/telegram",
      },
    });
  });

  it("sets the Telegram webhook", async () => {
    const fetchCalls: Array<{ input: RequestInfo | URL; init: RequestInit | undefined }> = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push({ input, init });
      return json({ ok: true, result: true });
    });
    const response = await routeRequest(
      new Request("https://example.test/telegram/set-webhook", {
        method: "POST",
        headers: { authorization: "Bearer token", "content-type": "application/json" },
        body: JSON.stringify({ url: "https://example.test/webhook/telegram" }),
      }),
      createTelegramEnv({ allowed: "1" }),
      ctx,
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({ ok: true });
    expect(fetchCalls[0]?.input.toString()).toBe("https://api.telegram.org/bottelegram-token/setWebhook");
    expect(JSON.parse(fetchCalls[0]?.init?.body as string)).toMatchObject({
      url: "https://example.test/webhook/telegram",
      secret_token: "telegram-secret",
    });
  });

  it("defaults the Telegram webhook to the public base URL", async () => {
    const fetchCalls: Array<{ input: RequestInfo | URL; init: RequestInit | undefined }> = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push({ input, init });
      return json({ ok: true });
    });

    const response = await routeRequest(
      new Request("https://example.test/telegram/set-webhook", {
        method: "POST",
        headers: {
          authorization: "Bearer token",
          "content-type": "application/json",
        },
        body: JSON.stringify({}),
      }),
      createTelegramEnv({ allowed: "1" }),
      ctx,
    );

    expect(response.status).toBe(200);
    expect(JSON.parse(fetchCalls[0]?.init?.body as string)).toMatchObject({
      url: "https://clawflare.omattic.com/webhook/telegram",
      secret_token: "telegram-secret",
    });
  });

  it("splits long Telegram messages safely", () => {
    expect(splitTelegramText("x".repeat(8001))).toHaveLength(3);
  });
});
