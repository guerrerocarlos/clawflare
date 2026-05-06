import type { QueueEnvelope } from "./envelope";

export async function consumeWebhookEvents(envelope: QueueEnvelope): Promise<void> {
  void envelope;
}
