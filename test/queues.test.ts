import { describe, expect, it } from "vitest";
import type { ClawflareEnv } from "../src/env";
import {
  MemoryQueueAuditSink,
  MemoryQueueIdempotencyStore,
  PermanentQueueError,
  processQueueEnvelope,
  type QueueEnvelope,
} from "../src/queues";
import { isQueueEnvelope } from "../src/queues/envelope";

function envelope(overrides?: Partial<QueueEnvelope>): QueueEnvelope {
  return {
    version: 1,
    type: "channel.delivery.send",
    id: "msg-1",
    accountId: "acct",
    agentId: "agent",
    sessionKey: "session",
    idempotencyKey: "idem-1",
    attempt: 0,
    createdAt: "2026-05-06T00:00:00.000Z",
    payload: {},
    ...overrides,
  };
}

describe("queue envelopes", () => {
  it("validates queue envelope shape", () => {
    expect(isQueueEnvelope(envelope())).toBe(true);
    expect(isQueueEnvelope({ version: 1, type: "" })).toBe(false);
  });
});

describe("queue processing", () => {
  it("processes a message once by idempotency key", async () => {
    const idempotency = new MemoryQueueIdempotencyStore();
    let processed = 0;
    const options = {
      idempotency,
      consumers: {
        "channel.delivery.send": async () => {
          processed += 1;
        },
      },
    };

    await expect(processQueueEnvelope(envelope(), {} as ClawflareEnv, options)).resolves.toMatchObject({
      status: "processed",
    });
    await expect(processQueueEnvelope(envelope(), {} as ClawflareEnv, options)).resolves.toMatchObject({
      status: "skipped",
    });
    expect(processed).toBe(1);
  });

  it("records permanent failures and marks them processed", async () => {
    const idempotency = new MemoryQueueIdempotencyStore();
    const audit = new MemoryQueueAuditSink();
    const options = {
      idempotency,
      audit,
      consumers: {
        "plugin.scan": async () => {
          throw new PermanentQueueError("policy denied");
        },
      },
    };

    await expect(
      processQueueEnvelope(envelope({ type: "plugin.scan", idempotencyKey: "scan-1" }), {} as ClawflareEnv, options),
    ).resolves.toMatchObject({
      status: "failed_permanent",
    });
    expect(audit.failures).toHaveLength(1);
    await expect(
      processQueueEnvelope(envelope({ type: "plugin.scan", idempotencyKey: "scan-1" }), {} as ClawflareEnv, options),
    ).resolves.toMatchObject({
      status: "skipped",
    });
  });

  it("rethrows transient failures before the final attempt", async () => {
    await expect(
      processQueueEnvelope(
        envelope({ type: "webhook.ingested", attempt: 0 }),
        {} as ClawflareEnv,
        {
          idempotency: new MemoryQueueIdempotencyStore(),
          audit: new MemoryQueueAuditSink(),
          consumers: {
            "webhook.ingested": async () => {
              throw new Error("temporary");
            },
          },
        },
      ),
    ).rejects.toThrow("temporary");
  });

  it("audits transient failures on final attempt", async () => {
    const audit = new MemoryQueueAuditSink();

    await expect(
      processQueueEnvelope(
        envelope({ type: "webhook.ingested", attempt: 2, idempotencyKey: "final-1" }),
        {} as ClawflareEnv,
        {
          idempotency: new MemoryQueueIdempotencyStore(),
          audit,
          consumers: {
            "webhook.ingested": async () => {
              throw new Error("still failing");
            },
          },
        },
      ),
    ).resolves.toMatchObject({
      status: "failed_permanent",
    });
    expect(audit.failures[0]?.error).toBeInstanceOf(Error);
  });
});
