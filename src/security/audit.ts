import type { ClawflareEnv, QueuePayload } from "../env";

export interface AuditEvent {
  id: string;
  accountId: string;
  agentId?: string;
  actorId?: string;
  action: string;
  target?: string;
  payload: unknown;
  createdAt: string;
}

export interface AuditSink {
  record(event: AuditEvent): Promise<void>;
}

const sensitiveKeyPattern = /token|secret|password|api[_-]?key|authorization/i;

export function redact(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redact(item));
  }

  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, sensitiveKeyPattern.test(key) ? "[REDACTED]" : redact(nested)]),
    );
  }

  return value;
}

export function createAuditEvent(input: Omit<AuditEvent, "id" | "createdAt"> & { id?: string; createdAt?: string }): AuditEvent {
  return {
    id: input.id ?? crypto.randomUUID(),
    accountId: input.accountId,
    ...(input.agentId === undefined ? {} : { agentId: input.agentId }),
    ...(input.actorId === undefined ? {} : { actorId: input.actorId }),
    action: input.action,
    ...(input.target === undefined ? {} : { target: input.target }),
    payload: redact(input.payload),
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
}

export class QueueAuditSink implements AuditSink {
  constructor(private readonly env: ClawflareEnv) {}

  async record(event: AuditEvent): Promise<void> {
    const message: QueuePayload = {
      version: 1,
      type: "audit.persist",
      id: event.id,
      accountId: event.accountId,
      agentId: event.agentId,
      idempotencyKey: `audit:${event.id}`,
      attempt: 0,
      createdAt: event.createdAt,
      payload: event,
    };

    await this.env.AUDIT_EVENTS_QUEUE.send(message);
  }
}

export function pluginAudit(action: "plugin.install" | "plugin.enable" | "plugin.update", input: {
  accountId: string;
  agentId: string;
  pluginId: string;
  payload?: unknown;
}): AuditEvent {
  return createAuditEvent({
    accountId: input.accountId,
    agentId: input.agentId,
    actorId: "operator",
    action,
    target: input.pluginId,
    payload: input.payload ?? {},
  });
}

export function channelAllowlistAudit(input: { accountId: string; agentId?: string; senderId: string; allowed: boolean }): AuditEvent {
  return createAuditEvent({
    accountId: input.accountId,
    ...(input.agentId === undefined ? {} : { agentId: input.agentId }),
    actorId: "operator",
    action: "channel.allowlist.change",
    target: input.senderId,
    payload: { allowed: input.allowed },
  });
}

export function configWriteAudit(input: { accountId: string; agentId?: string; key: string; value: unknown }): AuditEvent {
  return createAuditEvent({
    accountId: input.accountId,
    ...(input.agentId === undefined ? {} : { agentId: input.agentId }),
    actorId: "operator",
    action: "config.write",
    target: input.key,
    payload: { key: input.key, value: sensitiveKeyPattern.test(input.key) ? "[REDACTED]" : input.value },
  });
}
