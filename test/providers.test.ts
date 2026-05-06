import { describe, expect, it } from "vitest";
import type { ClawflareEnv } from "../src/env";
import { AnthropicCompatibleProvider } from "../src/providers/anthropic-compatible";
import { CloudflareAiGatewayProvider } from "../src/providers/cloudflare-ai-gateway";
import { normalizeProviderError } from "../src/providers/errors";
import { OpenAiCompatibleProvider } from "../src/providers/openai-compatible";
import { createDefaultProviderRegistry, parseModelRef } from "../src/providers/registry";
import type { ProviderFetch } from "../src/providers/runtime";
import { secretStatus } from "../src/providers/secrets";
import { WorkersAiProvider } from "../src/providers/workers-ai";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function mockFetch(response: Response): { fetcher: ProviderFetch; calls: Array<{ input: RequestInfo | URL; init: RequestInit | undefined }> } {
  const calls: Array<{ input: RequestInfo | URL; init: RequestInit | undefined }> = [];

  return {
    calls,
    fetcher: async (input, init) => {
      calls.push({ input, init });
      return response;
    },
  };
}

describe("provider registry", () => {
  it("parses provider/model refs without losing slash-heavy model names", () => {
    expect(parseModelRef("workers-ai/@cf/meta/llama-3.1-8b-instruct")).toEqual({
      providerId: "workers-ai",
      model: "@cf/meta/llama-3.1-8b-instruct",
    });
    expect(() => parseModelRef("missing-provider")).toThrow("provider/model");
  });

  it("resolves default providers", () => {
    const registry = createDefaultProviderRegistry();

    expect(registry.resolve("fake/deterministic")).toMatchObject({
      provider: {
        id: "fake",
      },
      model: "deterministic",
    });
  });
});

describe("provider secrets", () => {
  it("reports configured state without returning secret values", () => {
    const status = secretStatus({ OPENAI_API_KEY: "super-secret" } as ClawflareEnv, "OPENAI_API_KEY");

    expect(status).toEqual({ name: "OPENAI_API_KEY", configured: true });
    expect(JSON.stringify(status)).not.toContain("super-secret");
  });
});

describe("openai-compatible provider", () => {
  it("lists models and completes chat requests with bearer auth", async () => {
    const list = mockFetch(jsonResponse({ data: [{ id: "gpt-test", created: 1, object: "model" }] }));
    const provider = new OpenAiCompatibleProvider("https://openai.test/v1");
    const env = { OPENAI_API_KEY: "openai-secret" } as ClawflareEnv;

    await expect(provider.listModels({ env, fetcher: list.fetcher })).resolves.toEqual([
      {
        id: "openai-compatible/gpt-test",
        provider: "openai-compatible",
        created: 1,
        metadata: {
          object: "model",
        },
      },
    ]);
    expect(list.calls[0]?.input.toString()).toBe("https://openai.test/v1/models");
    expect((list.calls[0]!.init!.headers as Record<string, string>).authorization).toBe("Bearer openai-secret");

    const completion = mockFetch(jsonResponse({ choices: [{ message: { content: "hello" } }], usage: { total_tokens: 3 } }));
    await expect(
      provider.complete(
        {
          model: "gpt-test",
          prompt: "prompt",
          messages: [{ role: "user", content: "hi" }],
        },
        { env, fetcher: completion.fetcher },
      ),
    ).resolves.toMatchObject({
      text: "hello",
      usage: {
        total_tokens: 3,
      },
    });
    expect(completion.calls[0]?.input.toString()).toBe("https://openai.test/v1/chat/completions");
    expect(JSON.parse(completion.calls[0]?.init?.body as string)).toMatchObject({
      model: "gpt-test",
      stream: false,
    });
  });

  it("normalizes provider HTTP errors", async () => {
    const provider = new OpenAiCompatibleProvider("https://openai.test/v1");
    const { fetcher } = mockFetch(jsonResponse({ error: "nope" }, 401));

    try {
      await provider.complete(
        { model: "gpt-test", prompt: "prompt", messages: [{ role: "user", content: "hi" }] },
        { env: { OPENAI_API_KEY: "secret" } as ClawflareEnv, fetcher },
      );
    } catch (error) {
      expect(normalizeProviderError(error)).toEqual({
        code: "PROVIDER_AUTH",
        message: "openai-compatible rejected authentication.",
        status: 401,
        retryable: false,
      });
    }
  });
});

describe("anthropic-compatible provider", () => {
  it("completes messages with anthropic headers", async () => {
    const provider = new AnthropicCompatibleProvider("https://anthropic.test/v1");
    const { fetcher, calls } = mockFetch(jsonResponse({ content: [{ type: "text", text: "anthropic hello" }] }));

    await expect(
      provider.complete(
        {
          model: "claude-test",
          prompt: "prompt",
          messages: [
            { role: "system", content: "system" },
            { role: "user", content: "hi" },
          ],
        },
        { env: { ANTHROPIC_API_KEY: "anthropic-secret" } as ClawflareEnv, fetcher },
      ),
    ).resolves.toMatchObject({ text: "anthropic hello" });
    expect(calls[0]?.input.toString()).toBe("https://anthropic.test/v1/messages");
    expect((calls[0]!.init!.headers as Record<string, string>)["x-api-key"]).toBe("anthropic-secret");
    expect(JSON.parse(calls[0]?.init?.body as string)).toMatchObject({
      model: "claude-test",
      system: "system",
    });
  });
});

describe("workers-ai provider", () => {
  it("wraps the Workers AI binding", async () => {
    const provider = new WorkersAiProvider();
    const env = {
      AI: {
        run: async () => ({ response: "workers hello" }),
      },
    } as unknown as ClawflareEnv;

    await expect(
      provider.complete(
        { model: "@cf/test/model", prompt: "prompt", messages: [{ role: "user", content: "hi" }] },
        { env, fetcher: fetch },
      ),
    ).resolves.toMatchObject({ text: "workers hello" });
  });
});

describe("cloudflare-ai-gateway provider", () => {
  it("uses gateway URL parts and omits secret values from auth status", async () => {
    const provider = new CloudflareAiGatewayProvider();
    const env = {
      CLOUDFLARE_ACCOUNT_ID: "acct",
      CLOUDFLARE_AI_GATEWAY_NAME: "gateway",
      CLOUDFLARE_AI_GATEWAY_API_KEY: "gateway-secret",
    } as ClawflareEnv;
    const auth = await provider.authStatus({ env, fetcher: fetch });
    const { fetcher, calls } = mockFetch(jsonResponse({ choices: [{ message: { content: "gateway hello" } }] }));

    expect(auth.configured).toBe(true);
    expect(JSON.stringify(auth)).not.toContain("gateway-secret");

    await expect(
      provider.complete(
        { model: "gpt-test", prompt: "prompt", messages: [{ role: "user", content: "hi" }] },
        { env, fetcher },
      ),
    ).resolves.toMatchObject({ text: "gateway hello" });
    expect(calls[0]?.input.toString()).toBe(
      "https://gateway.ai.cloudflare.com/v1/acct/gateway/openai/chat/completions",
    );
    expect((calls[0]!.init!.headers as Record<string, string>).authorization).toBe("Bearer gateway-secret");
  });
});
