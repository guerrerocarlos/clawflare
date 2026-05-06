import type { QueueEnvelope } from "./envelope";

export async function consumeChannelDelivery(envelope: QueueEnvelope): Promise<void> {
  void envelope;
}
