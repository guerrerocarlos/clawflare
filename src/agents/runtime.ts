export type AgentMessageRole = "system" | "user" | "assistant" | "tool";

export interface AgentMessage {
  role: AgentMessageRole;
  content: string;
}

export interface AgentRunInput {
  accountId?: string;
  agentId?: string;
  sessionKey?: string;
  session?: {
    channel: string;
    peerId: string;
    threadId?: string;
  };
  messages: AgentMessage[];
  model?: string;
  idempotencyKey?: string;
  metadata?: Record<string, unknown>;
}

export interface AgentRunAccepted {
  type: "agent.accepted";
  runId: string;
  sessionKey: string;
  sessionId: string;
  status: "accepted";
  acceptedAt: string;
}

export interface AgentWaitInput {
  runId: string;
  timeoutMs?: number;
}

export interface AgentWaitResult {
  type: "agent.wait";
  runId: string;
  status: "completed" | "failed" | "interrupted" | "timeout";
  summary?: AgentRunSummary;
  error?: unknown;
}

export interface AgentRunSummary {
  outputText: string;
  transcriptR2Key?: string;
  usage?: Record<string, unknown>;
  toolTrace?: Array<{
    tool: string;
    input: unknown;
    result?: unknown;
    error?: unknown;
  }>;
}

export interface ListSessionsInput {
  accountId?: string;
  agentId?: string;
}

export interface ListSessionsResult {
  sessions: Array<{
    sessionKey: string;
    sessionId: string;
    title?: string | null;
    status: string;
    lastRunId?: string | null;
    updatedAt: string;
  }>;
}

export interface AbortRunInput {
  runId: string;
}

export interface AbortRunResult {
  runId: string;
  aborted: boolean;
}

export interface AgentStreamEvent {
  runId: string;
  sessionKey: string;
  seq: number;
  phase: "accepted" | "started" | "tool" | "assistant" | "completed" | "failed";
  payload: unknown;
  createdAt: string;
}

export type AgentEventSink = (event: AgentStreamEvent) => void | Promise<void>;

export interface AgentRunOptions {
  sink?: AgentEventSink;
}

export interface AgentRuntime {
  startRun(input: AgentRunInput, options?: AgentRunOptions): Promise<AgentRunAccepted>;
  waitForRun(input: AgentWaitInput): Promise<AgentWaitResult>;
  listSessions(input: ListSessionsInput): Promise<ListSessionsResult>;
  abortRun(input: AbortRunInput): Promise<AbortRunResult>;
}
