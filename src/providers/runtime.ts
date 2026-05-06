import type { ClawflareEnv } from "../env";
import type { AgentMessage } from "../agents/runtime";

export type ProviderFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface ProviderContext {
  env: ClawflareEnv;
  fetcher: ProviderFetch;
}

export interface ModelInfo {
  id: string;
  provider: string;
  name?: string;
  created?: number;
  metadata?: Record<string, unknown>;
}

export interface AuthStatus {
  provider: string;
  configured: boolean;
  requiredSecrets: Array<{
    name: string;
    configured: boolean;
  }>;
  details?: Record<string, unknown>;
}

export interface ProviderCompleteInput {
  model: string;
  prompt: string;
  messages: AgentMessage[];
  maxTokens?: number;
  temperature?: number;
}

export interface ProviderCompleteOutput {
  text: string;
  usage?: Record<string, unknown>;
  raw?: unknown;
}

export interface ProviderRuntime {
  id: string;
  listModels(ctx: ProviderContext): Promise<ModelInfo[]>;
  authStatus(ctx: ProviderContext): Promise<AuthStatus>;
  complete(input: ProviderCompleteInput, ctx: ProviderContext): Promise<ProviderCompleteOutput>;
}
