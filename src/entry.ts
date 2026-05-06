import type { ClawflareEnv, QueuePayload } from "./env";
import { routeRequest } from "./router";
import { dispatchQueueBatch } from "./queues";
export { AgentObject } from "./agents/agent-object";

export const handleFetch = routeRequest;

export default {
  fetch: handleFetch,
  async queue(batch: MessageBatch<QueuePayload>, env: ClawflareEnv, ctx: ExecutionContext): Promise<void> {
    await dispatchQueueBatch(batch, env, ctx);
  },
} satisfies ExportedHandler<ClawflareEnv, QueuePayload>;
