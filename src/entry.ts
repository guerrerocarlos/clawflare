import type { ClawflareEnv, QueuePayload } from "./env";
import { getRuntimeDefaults } from "./env";
import { routeRequest } from "./router";
import { jsonResponse } from "./shared/http";

export const handleFetch = routeRequest;

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
