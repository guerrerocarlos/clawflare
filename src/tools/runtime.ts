import type { TSchema } from "@sinclair/typebox";
import type { ClawflareEnv } from "../env";
import type { ToolPolicy, ToolPolicyContext } from "../security/policy";

export interface ToolInvokeContext {
  env: ClawflareEnv;
  accountId: string;
  agentId: string;
  policy: ToolPolicyContext;
  fetcher?: typeof fetch;
  workspace?: WorkspaceToolBackend;
  channelRuntime?: ChannelToolRuntime;
}

export interface WorkspaceToolBackend {
  list(): Promise<WorkspaceEntry[]>;
  read(path: string): Promise<WorkspaceFile | null>;
  write(path: string, content: string, contentType?: string): Promise<WorkspaceEntry>;
  patch(path: string, find: string, replace: string): Promise<WorkspaceFile>;
}

export interface WorkspaceEntry {
  path: string;
  r2Key: string;
  contentType?: string | null;
  size?: number | null;
  etag?: string | null;
  updatedAt: string;
}

export interface WorkspaceFile extends WorkspaceEntry {
  content: string;
}

export interface ChannelToolRuntime {
  sendMessage(input: { channel: string; peerId: string; text: string; replyToMessageId?: string }): Promise<unknown>;
}

export interface ToolRuntime {
  name: string;
  description: string;
  inputSchema: TSchema;
  policy: ToolPolicy;
  invoke(input: unknown, context: ToolInvokeContext): Promise<unknown>;
}

export class ToolError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ToolError";
  }
}
