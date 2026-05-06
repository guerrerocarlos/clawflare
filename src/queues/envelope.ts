import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

export const queueEnvelopeVersion = 1;

export const QueueEnvelopeSchema = Type.Object({
  version: Type.Literal(queueEnvelopeVersion),
  type: Type.String({ minLength: 1 }),
  id: Type.String({ minLength: 1 }),
  accountId: Type.String({ minLength: 1 }),
  agentId: Type.Optional(Type.String({ minLength: 1 })),
  sessionKey: Type.Optional(Type.String({ minLength: 1 })),
  idempotencyKey: Type.String({ minLength: 1 }),
  attempt: Type.Number({ minimum: 0 }),
  createdAt: Type.String({ minLength: 1 }),
  payload: Type.Unknown(),
});

export type QueueEnvelope<T = unknown> = Static<typeof QueueEnvelopeSchema> & {
  payload: T;
};

export function isQueueEnvelope(value: unknown): value is QueueEnvelope {
  return Value.Check(QueueEnvelopeSchema, value);
}

export function parseQueueEnvelope(value: unknown): QueueEnvelope {
  if (!isQueueEnvelope(value)) {
    throw new PermanentQueueError("Invalid queue envelope.", { reason: "schema" });
  }

  return value;
}

export class PermanentQueueError extends Error {
  constructor(
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "PermanentQueueError";
  }
}
