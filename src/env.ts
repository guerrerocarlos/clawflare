export type QueuePayload = Record<string, unknown>;

export interface ClawflareEnv {
  AGENT_OBJECT: DurableObjectNamespace;
  DB: D1Database;
  TRANSCRIPTS: R2Bucket;
  ARTIFACTS: R2Bucket;
  PLUGIN_ARCHIVES: R2Bucket;
  CATALOG_CACHE: KVNamespace;
  CHANNEL_DELIVERY_QUEUE: Queue<QueuePayload>;
  WEBHOOK_EVENTS_QUEUE: Queue<QueuePayload>;
  TRANSCRIPT_INDEXING_QUEUE: Queue<QueuePayload>;
  PLUGIN_SCANS_QUEUE: Queue<QueuePayload>;
  AUDIT_EVENTS_QUEUE: Queue<QueuePayload>;
  MEMORY_INDEX: VectorizeIndex;
  AI: Ai;
  CLAWFLARE_ENV?: string;
  CLAWFLARE_PUBLIC_BASE_URL?: string;
  CLAWFLARE_DEFAULT_MODEL?: string;
  CLAWFLARE_DEFAULT_ACCOUNT_ID?: string;
  CLAWFLARE_DEFAULT_AGENT_ID?: string;
  CLAWFLARE_GATEWAY_TOKEN?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  TELEGRAM_BOT_USERNAME?: string;
  TELEGRAM_ALLOWED_USER_IDS?: string;
  TELEGRAM_API_BASE_URL?: string;
  OPENAI_API_KEY?: string;
  OPENAI_COMPATIBLE_BASE_URL?: string;
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_COMPATIBLE_BASE_URL?: string;
  CLOUDFLARE_AI_GATEWAY_API_KEY?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_AI_GATEWAY_NAME?: string;
  CLAWHUB_API_BASE_URL?: string;
}

export interface RuntimeDefaults {
  accountId: string;
  agentId: string;
  environment: string;
}

export function getRuntimeDefaults(env: ClawflareEnv): RuntimeDefaults {
  return {
    accountId: env.CLAWFLARE_DEFAULT_ACCOUNT_ID ?? "local",
    agentId: env.CLAWFLARE_DEFAULT_AGENT_ID ?? "main",
    environment: env.CLAWFLARE_ENV ?? "dev",
  };
}
