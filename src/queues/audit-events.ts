import type { QueueEnvelope } from "./envelope";

export async function consumeAuditEvents(envelope: QueueEnvelope): Promise<void> {
  void envelope;
}
