import type { ClawflareEnv, QueuePayload } from "./env";
import { getRuntimeDefaults } from "./env";

const jsonHeaders = {
  "content-type": "application/json; charset=utf-8",
} as const;

export function jsonResponse(payload: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(payload), {
    ...init,
    headers: {
      ...jsonHeaders,
      ...init?.headers,
    },
  });
}

export function getAgentObjectStub(env: ClawflareEnv): DurableObjectStub {
  const defaults = getRuntimeDefaults(env);
  const id = env.AGENT_OBJECT.idFromName(`${defaults.accountId}:${defaults.agentId}`);
  return env.AGENT_OBJECT.get(id);
}

export async function handleFetch(
  request: Request,
  env: ClawflareEnv,
  _ctx?: ExecutionContext,
): Promise<Response> {
  const url = new URL(request.url);

  if (request.method === "GET" && url.pathname === "/healthz") {
    return jsonResponse({
      ok: true,
      service: "clawflare",
      runtime: "cloudflare-workers",
      version: "0.0.0",
      defaults: getRuntimeDefaults(env),
    });
  }

  if (request.method === "GET" && url.pathname === "/") {
    return new Response("Clawflare debug surface placeholder\n", {
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  if (url.pathname === "/ws") {
    return getAgentObjectStub(env).fetch(request);
  }

  return jsonResponse(
    {
      ok: false,
      error: {
        code: "NOT_IMPLEMENTED",
        message: "Route is reserved for the OpenClaw-compatible MVP surface but is not implemented yet.",
        route: `${request.method} ${url.pathname}`,
      },
    },
    { status: 501 },
  );
}

export class AgentObject {
  constructor(
    private readonly state: DurableObjectState,
    private readonly env: ClawflareEnv,
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    return jsonResponse(
      {
        ok: true,
        service: "clawflare-agent-object",
        durableObject: true,
        path: url.pathname,
        storage: {
          sqlite: typeof this.state.storage.sql === "object",
        },
        defaults: getRuntimeDefaults(this.env),
      },
      { status: 200 },
    );
  }
}

export default {
  fetch: handleFetch,
  async queue(batch: MessageBatch<QueuePayload>, _env: ClawflareEnv, _ctx: ExecutionContext): Promise<void> {
    for (const message of batch.messages) {
      message.ack();
    }
  },
} satisfies ExportedHandler<ClawflareEnv, QueuePayload>;
