import type { AgentRunInput } from "../agents/runtime";

export interface NormalizedSessionRef {
  accountId: string;
  agentId: string;
  sessionKey: string;
  sessionId: string;
}

function cleanSegment(value: string): string {
  return value.trim().replaceAll(/\s+/g, "-").replaceAll(/[^a-zA-Z0-9._:@-]/g, "_");
}

export function normalizeSessionRef(input: AgentRunInput, defaults: { accountId: string; agentId: string }): NormalizedSessionRef {
  const accountId = input.accountId ?? defaults.accountId;
  const agentId = input.agentId ?? defaults.agentId;

  if (input.sessionKey) {
    const sessionKey = cleanSegment(input.sessionKey);
    return {
      accountId,
      agentId,
      sessionKey,
      sessionId: sessionKey,
    };
  }

  const channel = cleanSegment(input.session?.channel ?? "gateway");
  const peerId = cleanSegment(input.session?.peerId ?? "default");
  const threadId = input.session?.threadId === undefined ? undefined : cleanSegment(input.session.threadId);
  const sessionId = threadId === undefined ? `${channel}:${peerId}` : `${channel}:${peerId}:${threadId}`;

  return {
    accountId,
    agentId,
    sessionKey: `${cleanSegment(accountId)}:${cleanSegment(agentId)}:${sessionId}`,
    sessionId,
  };
}
