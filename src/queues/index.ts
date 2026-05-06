import type { ClawflareEnv, QueuePayload } from "../env";
import { D1Storage } from "../storage/d1";
import { consumeAuditEvents } from "./audit-events";
import { consumeChannelDelivery } from "./channel-delivery";
import { parseQueueEnvelope, PermanentQueueError, type QueueEnvelope } from "./envelope";
import { consumePluginScans } from "./plugin-scans";
import { consumeTranscriptIndexing } from "./transcript-indexing";
import { consumeWebhookEvents } from "./webhook-events";

export { QueueEnvelopeSchema, isQueueEnvelope, parseQueueEnvelope, PermanentQueueError, type QueueEnvelope } from "./envelope";

export const maxQueueAttempts = 3;

export interface QueueIdempotencyStore {
  has(envelope: QueueEnvelope): Promise<boolean>;
  markProcessed(envelope: QueueEnvelope, result: unknown): Promise<void>;
}

export interface QueueAuditSink {
  recordFinalFailure(envelope: QueueEnvelope, error: unknown): Promise<void>;
}

export interface QueueProcessOptions {
  idempotency?: QueueIdempotencyStore;
  audit?: QueueAuditSink;
  consumers?: Partial<Record<string, (envelope: QueueEnvelope) => Promise<void>>>;
}

export type QueueProcessStatus = "processed" | "skipped" | "failed_permanent";

export interface QueueProcessResult {
  status: QueueProcessStatus;
  envelope: QueueEnvelope;
}

export class MemoryQueueIdempotencyStore implements QueueIdempotencyStore {
  readonly processed = new Map<string, unknown>();

  async has(envelope: QueueEnvelope): Promise<boolean> {
    return this.processed.has(this.key(envelope));
  }

  async markProcessed(envelope: QueueEnvelope, result: unknown): Promise<void> {
    this.processed.set(this.key(envelope), result);
  }

  private key(envelope: QueueEnvelope): string {
    return `${envelope.accountId}:${envelope.type}:${envelope.idempotencyKey}`;
  }
}

export class MemoryQueueAuditSink implements QueueAuditSink {
  readonly failures: Array<{ envelope: QueueEnvelope; error: unknown }> = [];

  async recordFinalFailure(envelope: QueueEnvelope, error: unknown): Promise<void> {
    this.failures.push({ envelope, error });
  }
}

export class D1QueueIdempotencyStore implements QueueIdempotencyStore {
  constructor(private readonly storage: D1Storage) {}

  async has(envelope: QueueEnvelope): Promise<boolean> {
    const existing = await this.storage.getIdempotencyKey(envelope.accountId, `queue:${envelope.type}`, envelope.idempotencyKey);
    return existing !== null;
  }

  async markProcessed(envelope: QueueEnvelope, result: unknown): Promise<void> {
    await this.storage.putIdempotencyKey({
      account_id: envelope.accountId,
      scope: `queue:${envelope.type}`,
      key: envelope.idempotencyKey,
      result_json: JSON.stringify(result),
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      created_at: new Date().toISOString(),
    });
  }
}

export class D1QueueAuditSink implements QueueAuditSink {
  constructor(private readonly storage: D1Storage) {}

  async recordFinalFailure(envelope: QueueEnvelope, error: unknown): Promise<void> {
    await this.storage.insertAuditEvent({
      id: crypto.randomUUID(),
      account_id: envelope.accountId,
      agent_id: envelope.agentId ?? null,
      actor_id: "queue",
      action: "queue.final_failure",
      target: envelope.type,
      payload_json: JSON.stringify({
        envelopeId: envelope.id,
        idempotencyKey: envelope.idempotencyKey,
        error: error instanceof Error ? { name: error.name, message: error.message } : error,
      }),
      created_at: new Date().toISOString(),
    });
  }
}

const defaultConsumers: Record<string, (envelope: QueueEnvelope) => Promise<void>> = {
  "channel.delivery.send": consumeChannelDelivery,
  "channel.delivery.retry": consumeChannelDelivery,
  "webhook.ingested": consumeWebhookEvents,
  "webhook.fanout": consumeWebhookEvents,
  "transcript.index": consumeTranscriptIndexing,
  "memory.embed": consumeTranscriptIndexing,
  "plugin.scan": consumePluginScans,
  "plugin.compatibility": consumePluginScans,
  "plugin.archive.fetch": consumePluginScans,
  "audit.persist": consumeAuditEvents,
  "audit.export": consumeAuditEvents,
};

function consumerFor(type: string, options?: QueueProcessOptions): (envelope: QueueEnvelope) => Promise<void> {
  const consumer = options?.consumers?.[type] ?? defaultConsumers[type];

  if (!consumer) {
    throw new PermanentQueueError(`No queue consumer registered for ${type}.`, { type });
  }

  return consumer;
}

function isFinalFailure(envelope: QueueEnvelope, error: unknown): boolean {
  return error instanceof PermanentQueueError || envelope.attempt >= maxQueueAttempts - 1;
}

export async function processQueueEnvelope(
  value: unknown,
  env: ClawflareEnv,
  options?: QueueProcessOptions,
): Promise<QueueProcessResult> {
  const envelope = parseQueueEnvelope(value);
  const storage = env.DB === undefined ? undefined : new D1Storage(env.DB);
  const idempotency = options?.idempotency ?? (storage === undefined ? new MemoryQueueIdempotencyStore() : new D1QueueIdempotencyStore(storage));
  const audit = options?.audit ?? (storage === undefined ? new MemoryQueueAuditSink() : new D1QueueAuditSink(storage));

  if (await idempotency.has(envelope)) {
    return { status: "skipped", envelope };
  }

  try {
    await consumerFor(envelope.type, options)(envelope);
    await idempotency.markProcessed(envelope, { status: "processed" });
    return { status: "processed", envelope };
  } catch (error) {
    if (!isFinalFailure(envelope, error)) {
      throw error;
    }

    await audit.recordFinalFailure(envelope, error);
    await idempotency.markProcessed(envelope, { status: "failed_permanent" });
    return { status: "failed_permanent", envelope };
  }
}

export async function dispatchQueueBatch(
  batch: MessageBatch<QueuePayload>,
  env: ClawflareEnv,
  _ctx: ExecutionContext,
  options?: QueueProcessOptions,
): Promise<void> {
  for (const message of batch.messages) {
    try {
      await processQueueEnvelope(message.body, env, options);
      message.ack();
    } catch {
      message.retry();
    }
  }
}
