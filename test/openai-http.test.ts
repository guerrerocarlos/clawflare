import { describe, expect, it } from "vitest";
import type { ClawflareEnv } from "../src/env";
import { routeRequest } from "../src/router";

const ctx = {
  waitUntil() {},
  passThroughOnException() {},
  props: {},
} satisfies ExecutionContext;

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function createEnv(runResponse?: unknown): ClawflareEnv {
  const stub = {
    fetch: async () =>
      json(
        runResponse ?? {
          accepted: { runId: "run-1" },
          result: {
            type: "agent.wait",
            runId: "run-1",
            status: "completed",
            summary: {
              outputText: "assistant output",
              usage: { total_tokens: 7 },
            },
          },
        },
      ),
  };

  return {
    CLAWFLARE_GATEWAY_TOKEN: "token",
    AGENT_OBJECT: {
      idFromName: () => ({}) as DurableObjectId,
      get: () => stub as unknown as DurableObjectStub,
    } as unknown as DurableObjectNamespace,
  } as ClawflareEnv;
}

function authedRequest(path: string, init?: RequestInit): Request {
  return new Request(`https://example.test${path}`, {
    ...init,
    headers: {
      authorization: "Bearer token",
      "content-type": "application/json",
      ...init?.headers,
    },
  });
}

describe("OpenAI-compatible HTTP routes", () => {
  it("lists models", async () => {
    const response = await routeRequest(authedRequest("/v1/models"), createEnv(), ctx);
    const payload = (await response.json()) as any;

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      object: "list",
    });
    expect(payload.data.some((model: { id: string }) => model.id === "fake/deterministic")).toBe(true);
  });

  it("gets a model by id", async () => {
    const response = await routeRequest(authedRequest("/v1/models/fake/deterministic"), createEnv(), ctx);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      id: "fake/deterministic",
      object: "model",
      owned_by: "fake",
    });
  });

  it("maps non-streaming chat completions into the AgentObject run path", async () => {
    const response = await routeRequest(
      authedRequest("/v1/chat/completions", {
        method: "POST",
        body: JSON.stringify({
          model: "fake/deterministic",
          messages: [{ role: "user", content: "hello" }],
        }),
      }),
      createEnv(),
      ctx,
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      id: "chatcmpl-run-1",
      object: "chat.completion",
      model: "fake/deterministic",
      choices: [
        {
          message: {
            role: "assistant",
            content: "assistant output",
          },
          finish_reason: "stop",
        },
      ],
    });
  });

  it("maps non-streaming responses into the AgentObject run path", async () => {
    const response = await routeRequest(
      authedRequest("/v1/responses", {
        method: "POST",
        body: JSON.stringify({
          model: "fake/deterministic",
          input: "hello",
        }),
      }),
      createEnv(),
      ctx,
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      id: "resp_run-1",
      object: "response",
      status: "completed",
      output: [
        {
          type: "message",
          role: "assistant",
          content: [
            {
              type: "output_text",
              text: "assistant output",
            },
          ],
        },
      ],
    });
  });

  it("returns OpenAI-compatible auth failures", async () => {
    const response = await routeRequest(new Request("https://example.test/v1/models"), createEnv(), ctx);
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload).toMatchObject({
      error: {
        type: "authentication_error",
        code: "UNAUTHORIZED",
      },
    });
  });

  it("returns OpenAI-compatible provider failures", async () => {
    const response = await routeRequest(
      authedRequest("/v1/chat/completions", {
        method: "POST",
        body: JSON.stringify({
          model: "fake/deterministic",
          messages: [{ role: "user", content: "hello" }],
        }),
      }),
      createEnv({
        accepted: { runId: "run-1" },
        result: {
          type: "agent.wait",
          runId: "run-1",
          status: "failed",
          error: { code: "PROVIDER_INTERNAL" },
        },
      }),
      ctx,
    );
    const payload = await response.json();

    expect(response.status).toBe(502);
    expect(payload).toMatchObject({
      error: {
        type: "server_error",
        code: "PROVIDER_FAILURE",
      },
    });
  });
});
