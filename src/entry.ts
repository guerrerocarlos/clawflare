import type { ClawflareEnv, QueuePayload } from "./env";
import { routeRequest } from "./router";
export { AgentObject } from "./agents/agent-object";

export const handleFetch = routeRequest;

export default {
  fetch: handleFetch,
  async queue(batch: MessageBatch<QueuePayload>, _env: ClawflareEnv, _ctx: ExecutionContext): Promise<void> {
    for (const message of batch.messages) {
      message.ack();
    }
  },
} satisfies ExportedHandler<ClawflareEnv, QueuePayload>;
