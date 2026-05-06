# Clawflare Implementation Spec

## Status

This document is the approved pre-implementation contract for Clawflare. The next execution checklist lives in `TODO.md`.

Chosen direction:

- Target an OpenClaw-compatible Gateway protocol subset.
- Use Workers and Durable Objects as the default runtime.
- Use Cloudflare Queues for background work, not ordered agent turns.
- Use ClawHub-compatible plugin install flows, with skills first and native plugin execution later through a constrained SDK shim.
- Keep Containers optional and only for Linux-native capabilities.

## Reuse Strategy

We should reuse OpenClaw concepts, contracts, schemas, and selected portable code, but not directly port the long-lived Node Gateway as-is.

Reusable from `../openclaw`:

- Gateway protocol shape: request/response/event frames, `connect`, `hello-ok`, method names, stream event naming, idempotency rules.
- Agent loop semantics: accepted run ack, lifecycle stream, assistant stream, tool stream, `agent.wait`, per-session serialization.
- Plugin concepts: `openclaw.plugin.json`, `package.json.openclaw.extensions`, provider/channel/tool/hook registration ideas.
- Provider examples: especially `extensions/cloudflare-ai-gateway`, OpenAI-compatible provider normalization, model catalog patterns.
- Security defaults: single operator trust boundary, pairing/allowlists, explicit policy, audit/doctor posture.
- Docs and user-facing command names where compatibility helps.

Not reusable without major adaptation:

- Long-lived Node HTTP/WS Gateway startup code.
- Host daemon management.
- Filesystem/session paths under `~/.openclaw`.
- Process, shell, Docker, SSH, OpenShell, and local browser tooling.
- Native Node modules or code that imports `fs`, `child_process`, `net`, `tls`, `http2`, local keychains, launchd/systemd, or package managers.

Reusable from `../NemoClaw`:

- Architecture philosophy: thin integration layer, explicit sandbox context, deny-by-default policy, credential injection at the boundary, status/doctor/recovery UX.
- Runtime context injection pattern similar to `<nemoclaw-runtime>`.
- Blueprint-style separation between deployment shape and runtime logic.

Do not copy large NemoClaw source blocks unless we intentionally preserve Apache-2.0 notices. OpenClaw is MIT, but all reused code still needs attribution and license review.

## Tooling Choices

Runtime and language:

- TypeScript ESM.
- Cloudflare Workers runtime.
- Durable Objects with SQLite storage.
- D1 for account/global relational state.
- R2 for transcripts, artifacts, plugin archives, workspace objects.
- KV only for cacheable non-authoritative data.
- Vectorize for memory search.
- Queues for retryable background work.
- Workflows for durable long-running tasks and approval waits.
- Containers optional and behind feature flags.

Development dependencies:

- `typescript`
- `wrangler`
- `vitest`
- `@cloudflare/vitest-pool-workers`
- `zod` or `@sinclair/typebox`
- `tsx`
- `eslint` or `oxlint`
- `prettier` or `dprint`

Recommendation: use TypeBox for protocol/config schemas because OpenClaw already uses TypeBox for protocol modeling. Use generated JSON Schema from the same source definitions.

Initial package scripts:

```json
{
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "oxlint .",
    "format": "prettier --write .",
    "check": "pnpm typecheck && pnpm lint && pnpm test",
    "db:migrate:local": "wrangler d1 migrations apply clawflare --local",
    "db:migrate": "wrangler d1 migrations apply clawflare",
    "queues:tail": "wrangler tail"
  }
}
```

## Initial Repository Tree

Create the tree in this order. Empty directories should include `.gitkeep` only when needed.

```text
clawflare/
├── src/
│   ├── entry.ts
│   ├── env.ts
│   ├── router/
│   ├── gateway/
│   ├── agents/
│   ├── sessions/
│   ├── providers/
│   ├── tools/
│   ├── channels/                   # Telegram primary channel plus debug/control WebChat
│   ├── plugins/
│   ├── workflows/
│   ├── containers/
│   ├── storage/
│   ├── security/
│   ├── config/
│   ├── protocol/
│   ├── memory/
│   ├── cli/
│   ├── web/
│   └── shared/
├── extensions/
│   ├── cloudflare-ai-gateway/
│   ├── telegram/
│   ├── web-fetch/
│   └── memory-vectorize/
├── schemas/
├── migrations/
│   ├── d1/
│   └── do/
├── scripts/
├── deploy/
├── docs/
├── qa/
├── skills/
├── test/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── wrangler.jsonc
├── PLAN.md
└── IMPLEMENTATION.md
```

Boundary rules:

- `src/router` owns HTTP route dispatch and never imports provider/channel internals directly.
- `src/gateway` owns WebSocket frames, auth handshake, method dispatch, and connection state.
- `src/agents` owns run lifecycle and can only call providers, tools, plugins, sessions, workflows, and storage through interfaces.
- `src/plugins` owns plugin install state, compatibility checks, registry loading, SDK shim, and ClawHub resolution.
- `extensions/*` must import only public Clawflare SDK surfaces, not arbitrary `src/*` internals.
- `src/containers` must be optional. MVP must compile and run without Container bindings.
- `src/shared` must stay boring. Domain behavior belongs in owned modules.

## Cloudflare Bindings

Use `wrangler.jsonc` rather than TOML so schema-like nesting is easier to maintain.

Initial binding names:

```jsonc
{
  "name": "clawflare",
  "main": "src/entry.ts",
  "compatibility_date": "2026-05-06",
  "compatibility_flags": ["nodejs_compat"],
  "durable_objects": {
    "bindings": [
      { "name": "AGENT_OBJECT", "class_name": "AgentObject" }
    ]
  },
  "migrations": [
    {
      "tag": "v1",
      "new_sqlite_classes": ["AgentObject"]
    }
  ],
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "clawflare",
      "database_id": "replace-after-create"
    }
  ],
  "r2_buckets": [
    { "binding": "TRANSCRIPTS", "bucket_name": "clawflare-transcripts" },
    { "binding": "ARTIFACTS", "bucket_name": "clawflare-artifacts" },
    { "binding": "PLUGIN_ARCHIVES", "bucket_name": "clawflare-plugin-archives" }
  ],
  "kv_namespaces": [
    { "binding": "CATALOG_CACHE", "id": "replace-after-create" }
  ],
  "queues": {
    "producers": [
      { "binding": "CHANNEL_DELIVERY_QUEUE", "queue": "channel-delivery" },
      { "binding": "WEBHOOK_EVENTS_QUEUE", "queue": "webhook-events" },
      { "binding": "TRANSCRIPT_INDEXING_QUEUE", "queue": "transcript-indexing" },
      { "binding": "PLUGIN_SCANS_QUEUE", "queue": "plugin-scans" },
      { "binding": "AUDIT_EVENTS_QUEUE", "queue": "audit-events" }
    ],
    "consumers": [
      { "queue": "channel-delivery", "max_batch_size": 10, "max_batch_timeout": 5 },
      { "queue": "webhook-events", "max_batch_size": 10, "max_batch_timeout": 5 },
      { "queue": "transcript-indexing", "max_batch_size": 20, "max_batch_timeout": 10 },
      { "queue": "plugin-scans", "max_batch_size": 5, "max_batch_timeout": 10 },
      { "queue": "audit-events", "max_batch_size": 20, "max_batch_timeout": 10 }
    ]
  },
  "vectorize": [
    { "binding": "MEMORY_INDEX", "index_name": "clawflare-memory" }
  ],
  "ai": {
    "binding": "AI"
  },
  "vars": {
    "CLAWFLARE_ENV": "dev",
    "CLAWFLARE_DEFAULT_ACCOUNT_ID": "local",
    "CLAWFLARE_DEFAULT_AGENT_ID": "main"
  }
}
```

Secrets:

- `CLAWFLARE_GATEWAY_TOKEN`
- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `CLOUDFLARE_AI_GATEWAY_API_KEY`
- `TELEGRAM_BOT_TOKEN`
- Optional provider/channel secrets added later.

`src/env.ts` must define the binding interface. No module should use untyped `env` access directly.

## Runtime Entry Points

`src/entry.ts` must export:

- Default Worker fetch handler.
- `queue(batch, env, ctx)` consumer handler.
- `scheduled(event, env, ctx)` only after cron is needed.
- `AgentObject` Durable Object class.

Initial route ownership:

| Route | Owner | Purpose |
| --- | --- | --- |
| `GET /healthz` | `src/router` | Process health, no auth required unless public deployment requires it. |
| `GET /` | `src/web` | Minimal debug/control UI placeholder. |
| `GET /ws` | `src/router` -> `AgentObject` | OpenClaw-compatible WS gateway subset. |
| `GET /v1/models` | `src/router` -> agent/provider runtime | OpenAI-compatible model listing. |
| `GET /v1/models/:id` | `src/router` -> agent/provider runtime | OpenAI-compatible model metadata. |
| `POST /v1/chat/completions` | `src/router` -> `AgentObject` | OpenAI-compatible chat wrapper. |
| `POST /v1/responses` | `src/router` -> `AgentObject` | OpenAI-compatible responses wrapper. |
| `POST /webhook/:channel` | `src/channels` | Auth/dedupe webhooks, enqueue fanout or direct agent call. |
| `POST /tools/invoke` | `src/router` -> `AgentObject` | Authenticated tool invocation compatibility endpoint. |

MVP should not implement every OpenClaw route. Unsupported routes must return structured `NOT_IMPLEMENTED` errors rather than 404 when they are part of the compatibility surface.

## OpenClaw-Compatible Protocol Subset

Frame shape:

```ts
type GatewayRequest = {
  type: "req";
  id: string;
  method: string;
  params?: unknown;
};

type GatewayResponse =
  | { type: "res"; id: string; ok: true; payload: unknown }
  | { type: "res"; id: string; ok: false; error: GatewayError };

type GatewayEvent = {
  type: "event";
  event: string;
  payload: unknown;
  seq?: number;
  stateVersion?: number;
};
```

Required MVP methods:

| Method | Status | Notes |
| --- | --- | --- |
| `connect` | Implement | First frame after challenge. Token auth in MVP. Device identity parsed but pairing can be minimal. |
| `health` | Implement | Returns gateway/agent state, queue sizes when available, provider status summary. |
| `agent` | Implement | Returns accepted ack immediately, streams events over WS. |
| `agent.wait` | Implement | Waits for lifecycle terminal event by `runId`; timeout is wait-only. |
| `chat.send` | Implement | Telegram/WebChat-compatible send into an agent session. |
| `sessions.list` | Implement minimal | Return known sessions from DO SQLite. |
| `sessions.preview` | Stub or minimal | Return last messages if transcript index exists. |
| `models.list` | Implement | Provider registry model list. |
| `models.authStatus` | Implement minimal | Shows configured provider auth without secret values. |
| `tools.catalog` | Implement | Built-in + enabled plugin tools. |
| `plugins.search` | Implement | ClawHub search/cache. |
| `plugins.inspect` | Implement | Metadata only, no code execution. |
| `plugins.planInstall` | Implement | Produces install plan and required approval. |
| `plugins.install` | Implement for skills | Native plugins download/inspect only in MVP. |
| `plugins.enable` | Implement for skills | Native plugins fail closed unless compatibility tier allows. |

Required MVP events:

| Event | Purpose |
| --- | --- |
| `connect.challenge` | Nonce before `connect`. |
| `presence` | Basic gateway/agent presence snapshot. |
| `tick` | Heartbeat. |
| `agent` | Streaming lifecycle/assistant/tool/usage/error events. |
| `chat` | Telegram/WebChat-normalized chat updates. |
| `health` | Optional health updates. |
| `plugin` | Plugin install/scan/enable status updates. |

Handshake:

1. Client opens `/ws`.
2. `AgentObject` accepts or hibernates WebSocket.
3. Server sends `connect.challenge`.
4. Client sends `req/connect`.
5. Server validates shared token and optional device metadata.
6. Server replies with `hello-ok`.
7. Later frames follow request/response/event contract.

MVP `hello-ok` payload fields:

- `type: "hello-ok"`
- `protocol: 3`
- `server.version`
- `server.connId`
- `features.methods`
- `features.events`
- `snapshot.presence`
- `snapshot.health`
- `auth.role`
- `auth.scopes`
- `policy.maxPayload`
- `policy.maxBufferedBytes`
- `policy.tickIntervalMs`

## Agent Runtime Contract

Core interface:

```ts
export interface AgentRuntime {
  startRun(input: AgentRunInput): Promise<AgentRunAccepted>;
  waitForRun(input: AgentWaitInput): Promise<AgentWaitResult>;
  listSessions(input: ListSessionsInput): Promise<ListSessionsResult>;
  abortRun(input: AbortRunInput): Promise<AbortRunResult>;
}
```

Run lifecycle:

1. Validate method params.
2. Normalize `accountId`, `agentId`, `sessionKey`, `sessionId`, and `idempotencyKey`.
3. Check idempotency cache/table.
4. Insert or update session row.
5. Insert run row with status `accepted`.
6. Return accepted ack to caller.
7. Acquire per-session lane in the Durable Object.
8. Build prompt context.
9. Emit lifecycle start event.
10. Stream provider response.
11. Execute supported tool calls if provider/tooling supports it.
12. Persist transcript and run events.
13. Enqueue transcript indexing and audit queue messages.
14. Emit lifecycle end or error.
15. Release lane.

Per-session serialization:

- Do this inside `AgentObject`, not Cloudflare Queues.
- Use a DO-local in-memory promise chain as a cache.
- Persist lane/run state in DO SQLite so hibernation/restart can recover.
- On startup, mark stale `processing` runs as `interrupted` unless a resumable workflow exists.

Streaming:

- WebSocket runs stream events directly.
- HTTP `/v1/responses` and `/v1/chat/completions` should support non-streaming first, streaming second.
- All stream chunks must also be persistable as compact run events.

## Storage Schemas

### D1 Global Tables

`accounts`

```sql
CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  display_name TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

`agents`

```sql
CREATE TABLE agents (
  account_id TEXT NOT NULL,
  id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  default_model TEXT,
  config_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (account_id, id)
);
```

`plugin_installs`

```sql
CREATE TABLE plugin_installs (
  account_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  plugin_id TEXT NOT NULL,
  source TEXT NOT NULL,
  version TEXT,
  integrity TEXT NOT NULL,
  state TEXT NOT NULL,
  compatibility_tier INTEGER NOT NULL,
  manifest_json TEXT NOT NULL,
  install_plan_json TEXT,
  archive_r2_key TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (account_id, agent_id, plugin_id)
);
```

`audit_events`

```sql
CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  agent_id TEXT,
  actor_id TEXT,
  action TEXT NOT NULL,
  target TEXT,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
```

`idempotency_keys`

```sql
CREATE TABLE idempotency_keys (
  account_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  key TEXT NOT NULL,
  result_json TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (account_id, scope, key)
);
```

### Durable Object SQLite Tables

`sessions`

```sql
CREATE TABLE sessions (
  session_key TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  title TEXT,
  status TEXT NOT NULL,
  last_run_id TEXT,
  transcript_r2_key TEXT,
  session_started_at TEXT NOT NULL,
  last_interaction_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

`runs`

```sql
CREATE TABLE runs (
  run_id TEXT PRIMARY KEY,
  session_key TEXT NOT NULL,
  session_id TEXT NOT NULL,
  status TEXT NOT NULL,
  idempotency_key TEXT,
  input_json TEXT NOT NULL,
  summary_json TEXT,
  error_json TEXT,
  accepted_at TEXT NOT NULL,
  started_at TEXT,
  ended_at TEXT
);
```

`run_events`

```sql
CREATE TABLE run_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  stream TEXT NOT NULL,
  event_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (run_id, seq)
);
```

`workspace_index`

```sql
CREATE TABLE workspace_index (
  path TEXT PRIMARY KEY,
  r2_key TEXT NOT NULL,
  content_type TEXT,
  size INTEGER,
  etag TEXT,
  updated_at TEXT NOT NULL
);
```

`plugin_runtime_state`

```sql
CREATE TABLE plugin_runtime_state (
  plugin_id TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL,
  runtime_state_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

R2 key conventions:

- `accounts/{accountId}/agents/{agentId}/sessions/{sessionId}/transcript.jsonl`
- `accounts/{accountId}/agents/{agentId}/runs/{runId}/events.jsonl`
- `accounts/{accountId}/agents/{agentId}/workspace/{sha256}/{filename}`
- `accounts/{accountId}/agents/{agentId}/plugins/{pluginId}/{version}/archive.tgz`
- `accounts/{accountId}/agents/{agentId}/plugins/{pluginId}/{version}/manifest.json`
- `accounts/{accountId}/agents/{agentId}/artifacts/{artifactId}/{name}`

KV is cache only:

- `clawhub:search:{hash}`
- `clawhub:plugin:{ref}`
- `models:catalog:{provider}`

## Queue Message Contracts

All queue messages:

```ts
type QueueEnvelope<T> = {
  version: 1;
  type: string;
  id: string;
  accountId: string;
  agentId?: string;
  sessionKey?: string;
  idempotencyKey: string;
  attempt: number;
  createdAt: string;
  payload: T;
};
```

Queue-specific payloads:

| Queue | Types |
| --- | --- |
| `channel-delivery` | `channel.delivery.send`, `channel.delivery.retry` |
| `webhook-events` | `webhook.ingested`, `webhook.fanout` |
| `transcript-indexing` | `transcript.index`, `memory.embed` |
| `plugin-scans` | `plugin.scan`, `plugin.compatibility`, `plugin.archive.fetch` |
| `audit-events` | `audit.persist`, `audit.export` |

Consumers must be idempotent. Payloads should point to R2/D1 records when the body is large.

Dead-letter policy:

- Store final failure in D1 `audit_events`.
- Mark related install/delivery/indexing row failed.
- Emit WebSocket event if an active connection exists.
- Do not retry permanent policy failures.

## Provider Runtime

Core interface:

```ts
export interface ProviderRuntime {
  id: string;
  listModels(ctx: ProviderContext): Promise<ModelInfo[]>;
  authStatus(ctx: ProviderContext): Promise<AuthStatus>;
  streamResponse(input: ProviderStreamInput): Promise<ProviderStreamResult>;
}
```

Initial providers:

- `cloudflare-ai-gateway`
- `workers-ai`
- `openai-compatible`
- `anthropic-compatible`

Provider resolution:

1. Agent config selects `primaryModel`.
2. Model ref format is `provider/model`.
3. Provider registry resolves provider by prefix.
4. Secrets are resolved at call time only.
5. Provider receives no plugin/channel secrets unrelated to that provider.

Streaming normalization:

- Normalize provider deltas into `assistant.delta`.
- Normalize tool calls into `tool.call.requested` only if supported.
- Normalize final usage into `usage`.
- Normalize rate limit/auth/model errors into stable error codes.

## Tool Runtime

Core interface:

```ts
export interface ToolRuntime {
  name: string;
  description: string;
  inputSchema: unknown;
  policy: ToolPolicy;
  invoke(input: ToolInvokeInput): Promise<ToolInvokeResult>;
}
```

MVP tools:

| Tool | Backing service | Notes |
| --- | --- | --- |
| `workspace_list` | DO SQLite + R2 | Lists virtual workspace paths. |
| `workspace_read` | R2 | Size-capped reads, text-first. |
| `workspace_write` | R2 + DO SQLite | Atomic key write plus index update. |
| `workspace_patch` | R2 | Text patch only, bounded file size. |
| `web_fetch` | Worker fetch | SSRF checks, allowlists, response caps. |
| `message_send` | Channel runtime | Sends via Telegram primarily; WebChat fallback for debug. |
| `memory_search` | Vectorize | Query embeddings and return snippets. |
| `workflow_start` | Workflows or queue | Starts durable background task. |
| `plugins_search` | ClawHub resolver | Read-scope. |
| `plugins_plan_install` | Plugin install planner | Admin approval required before install. |
| `plugins_install` | Plugin installer | Skills only in MVP. |

No shell tool in MVP.

Policy checks before every tool:

- Actor scope.
- Agent policy.
- Channel/session trust context.
- Tool allow/deny state.
- Network/file/path allowlists.
- Plugin capability grants.
- Rate/budget limits.

Tool results:

- Must be JSON serializable.
- Large outputs go to R2 and return handles.
- Secret-looking content must be redacted in logs and audit events.

## Plugin And ClawHub Implementation

Core modules:

- `src/plugins/resolver.ts`
- `src/plugins/clawhub-client.ts`
- `src/plugins/manifest.ts`
- `src/plugins/install-plan.ts`
- `src/plugins/scanner.ts`
- `src/plugins/registry.ts`
- `src/plugins/sdk-shim.ts`
- `src/plugins/runtime.ts`

Install states:

- `resolved`
- `downloaded`
- `scanned`
- `planned`
- `installed`
- `enabled`
- `disabled`
- `failed`

Supported references in MVP:

- `clawhub:<package>`
- `<package>` as ClawHub-first bare name
- `clawhub:<package>@<version>` if ClawHub exposes versioned artifacts

Explicitly unsupported in hosted MVP:

- Local paths.
- Arbitrary Git URLs.
- Plugins requiring package-manager install scripts.
- Plugins requiring `child_process`, host `fs`, native modules, long-lived Node services, or browser daemons.

Skill install path:

1. Resolve ClawHub skill.
2. Download archive to R2 quarantine.
3. Validate manifest and `SKILL.md`.
4. Write skill files under R2 workspace prefix.
5. Update enabled skill registry.
6. Emit `plugin` event.
7. Next agent turn includes skill in prompt assembly.

Native plugin planning path:

1. Resolve ClawHub plugin.
2. Download archive to R2 quarantine.
3. Parse manifest and package metadata.
4. Identify requested SDK surfaces.
5. Static scan for forbidden APIs.
6. Produce compatibility tier.
7. Persist install plan.
8. Require admin approval for install or enable.

Native plugin execution is not MVP except for first-party extensions ported to Clawflare SDK.

## Telegram MVP Contract

Telegram is the main MVP communication path. WebChat exists only for debugging, local control, and protocol smoke tests.

Telegram routes:

| Route | Purpose |
| --- | --- |
| `POST /webhook/telegram` | Receives Telegram updates. |
| `GET /telegram/status` | Authenticated setup/debug status. |
| `POST /telegram/set-webhook` | Authenticated helper to register the webhook URL with Telegram. |

Webhook verification:

- Prefer Telegram secret token header `X-Telegram-Bot-Api-Secret-Token`.
- Secret value comes from `TELEGRAM_WEBHOOK_SECRET`.
- Bot API token comes from `TELEGRAM_BOT_TOKEN`.
- Reject requests without the correct secret token in production.
- Dedupe by Telegram `update_id`.

Inbound handling:

- Normalize messages, edited messages, callback queries, and basic commands.
- Ignore unsupported update types with a structured debug record.
- Direct messages route to `session.dmScope = "per-channel-peer"`.
- Groups require mention or explicit command by default.
- Unknown senders get a pairing/approval response and do not trigger the agent.
- Allowed sender state is stored in D1 or DO SQLite with account/agent scope.

Outbound handling:

- Agent replies are sent through `channel-delivery`.
- Use Telegram `sendMessage` first.
- Add `reply_to_message_id` when available.
- Split long messages safely before Telegram limits.
- Retry rate-limit/transient failures; do not retry permanent authorization failures.
- Store platform message IDs in delivery records for audit/debug.

Telegram commands for MVP:

- `/start` explains pairing or current access.
- `/status` returns agent/gateway status.
- `/plugin search <query>` maps to `plugins.search`.
- `/plugin install <ref>` maps to `plugins.planInstall` and approval flow.
- `/help` lists supported commands.

Post-MVP Telegram work:

- Inline buttons for approval flows.
- File/photo/audio/document ingest.
- Rich formatting and markdown escaping.
- Multi-agent selection commands.
- Group thread/topic routing.

## Channel Runtime

Initial channels:

- `telegram`
- `webchat` as debug/control fallback

Channel interface:

```ts
export interface ChannelRuntime {
  id: string;
  verifyWebhook(req: Request, env: Env): Promise<WebhookVerification>;
  normalizeInbound(input: WebhookInput): Promise<InboundMessage[]>;
  send(input: ChannelSendInput): Promise<ChannelSendResult>;
}
```

Inbound flow:

1. Router receives `/webhook/:channel`.
2. Channel verifies signature/token.
3. Router dedupes by platform event ID.
4. Simple messages may dispatch directly to `AgentObject`.
5. Expensive fanout or retries go to `webhook-events`.
6. Agent run output sends via `channel-delivery`.

Session routing:

- Telegram direct messages use `per-channel-peer`.
- Telegram groups require mention by default and route per group/thread where available.
- WebChat default: `main` and is debug/control only in MVP.
- Group/channel rooms require mention gate by default.
- Unknown external senders require allowlist or pairing.

## Security And Auth

MVP auth modes:

- Gateway shared token.
- Webhook secrets per channel.
- Admin operations require token plus admin scope.

Later auth modes:

- Device pairing.
- OAuth for control UI.
- Trusted proxy/Tailscale-like identity if deployed behind Cloudflare Access.

Never store secret values in:

- D1.
- DO SQLite.
- R2 plugin archives after extraction metadata.
- Logs.
- Audit payloads.
- Agent prompt context.

Allowed secret locations:

- Workers Secrets.
- Secrets Store binding if adopted.
- Runtime-only memory for provider/channel call.

Audit every privileged action:

- Plugin install/enable/update.
- Config write.
- Provider secret status change.
- Channel allowlist change.
- Tool policy change.
- Container start/exec/network grant.

## Container Backend Contract

Containers are out of MVP, but interfaces should exist.

Core interface:

```ts
export interface ContainerBackend {
  ensureSandbox(input: EnsureSandboxInput): Promise<SandboxHandle>;
  invoke(input: ContainerInvokeInput): Promise<ContainerInvokeResult>;
  snapshot(input: ContainerSnapshotInput): Promise<ContainerSnapshotResult>;
  destroy(input: DestroySandboxInput): Promise<void>;
}
```

Container policy:

- Default internet disabled.
- Allowed hosts explicit.
- Credentials injected by Worker outbound handler, not environment variables visible to the process.
- Workspace imported/exported through R2.
- Logs streamed to R2 and summarized in DO SQLite.

Do not let Container code become required for core builds.

## Workflows

Use Workflows for:

- Human approval waits that can outlive a WebSocket.
- Long plugin scan pipelines.
- Long media/document processing.
- Long container tasks.

Do not use Workflows for:

- Normal single-turn model streaming.
- WebSocket event ordering.
- Simple queue retries.

Workflow state must reference D1/R2/DO records by ID, not embed large payloads.

## Prompt Assembly

Prompt context order:

1. Base system prompt.
2. Runtime context block.
3. Agent identity/config.
4. Enabled skills.
5. Memory snippets.
6. Session transcript window.
7. Current user/channel message.

Runtime context block should include:

- Cloudflare runtime notice.
- No unrestricted host access.
- Enabled tools summary.
- Network/file policy summary.
- Container status if any.
- Plugin compatibility caveats when relevant.

Use a NemoClaw-like block:

```text
<clawflare-runtime>
You are running in Clawflare on Cloudflare Workers.
You do not have unrestricted host filesystem or shell access.
Filesystem tools operate on a virtual R2-backed workspace.
Network access is policy-gated.
If access is blocked, report it as a Clawflare policy block.
</clawflare-runtime>
```

## Compatibility Matrix

MVP compatibility:

| OpenClaw feature | Clawflare MVP |
| --- | --- |
| WS `connect` | Implement compatible subset |
| WS `agent` | Implement compatible subset |
| WS `agent.wait` | Implement |
| WS `chat.send` | Implement |
| Sessions list | Minimal |
| Session transcript preview | Minimal or stub |
| OpenAI `/v1/models` | Implement |
| OpenAI `/v1/chat/completions` | Implement |
| OpenAI `/v1/responses` | Implement |
| Control UI | Minimal webchat/control placeholder |
| Plugins search | Implement through ClawHub |
| Plugin install | Skills only |
| Native plugin execution | First-party ported extensions only |
| Shell tools | Unsupported |
| Docker/SSH/OpenShell sandbox | Unsupported |
| Containers | Interface only |
| Browser tool | Unsupported or Browser Run spike later |
| Mobile nodes | Unsupported |
| Local-device channels | Unsupported |

## Implementation Milestones

### Milestone 1: Scaffold

Files:

- `package.json`
- `tsconfig.json`
- `vitest.config.ts`
- `wrangler.jsonc`
- `src/entry.ts`
- `src/env.ts`
- `src/router/index.ts`
- `src/agents/agent-object.ts`
- `src/protocol/frames.ts`
- `src/storage/d1.ts`

Acceptance:

- `pnpm check` passes.
- `wrangler dev` starts.
- `/healthz` returns OK.
- Agent DO can be addressed.

### Milestone 2: Protocol And WebSocket

Files:

- `src/gateway/ws.ts`
- `src/gateway/methods.ts`
- `src/gateway/auth.ts`
- `src/protocol/connect.ts`
- `src/protocol/errors.ts`

Acceptance:

- WS sends `connect.challenge`.
- `connect` returns `hello-ok`.
- `health` method works.
- Unknown methods return structured `NOT_IMPLEMENTED`.

### Milestone 3: Agent Run Loop

Files:

- `src/agents/runtime.ts`
- `src/agents/run-loop.ts`
- `src/sessions/store.ts`
- `src/sessions/lanes.ts`
- `src/providers/registry.ts`
- `src/providers/openai-compatible.ts`

Acceptance:

- `agent` returns accepted ack.
- Assistant output streams over WS.
- `agent.wait` returns terminal status.
- Runs are serialized per session.
- Transcript is persisted to R2.

### Milestone 4: HTTP Compatibility

Files:

- `src/router/openai.ts`
- `src/providers/models.ts`
- `src/providers/cloudflare-ai-gateway.ts`
- `extensions/cloudflare-ai-gateway/`

Acceptance:

- `/v1/models` works.
- `/v1/chat/completions` works non-streaming.
- `/v1/responses` works non-streaming.
- Provider auth status reports configured/missing without leaking values.

### Milestone 5: Queues And Storage

Files:

- `src/queues/index.ts`
- `src/queues/channel-delivery.ts`
- `src/queues/transcript-indexing.ts`
- `src/queues/plugin-scans.ts`
- `src/memory/vectorize.ts`

Acceptance:

- Queue consumers process idempotent messages.
- Transcript indexing queue writes memory/index records.
- Failed queue messages emit audit events.

### Milestone 6: Tools

Files:

- `src/tools/registry.ts`
- `src/tools/workspace.ts`
- `src/tools/web-fetch.ts`
- `src/tools/message-send.ts`
- `src/security/policy.ts`

Acceptance:

- Tool catalog lists built-ins.
- Workspace list/read/write works through R2.
- Web fetch enforces allowlist and size cap.
- Denied tool calls produce agent-visible policy errors.

### Milestone 7: ClawHub Skills

Files:

- `src/plugins/clawhub-client.ts`
- `src/plugins/resolver.ts`
- `src/plugins/install-plan.ts`
- `src/plugins/skill-installer.ts`
- `src/plugins/scanner.ts`

Acceptance:

- Agent can search ClawHub.
- Agent can plan a skill install.
- Admin approval is required.
- Installed skill is available in the next prompt.
- Native plugin install planning works but execution is disabled unless compatible.

### Milestone 8: Telegram Primary Channel

Files:

- `src/channels/telegram.ts`
- `src/channels/session-routing.ts`
- `src/channels/telegram-commands.ts`
- `src/channels/telegram-delivery.ts`
- `src/channels/webchat.ts`
- `src/web/`

Acceptance:

- Telegram webhook can trigger an agent turn.
- Unknown Telegram users are blocked or paired.
- Telegram replies are sent through `channel-delivery`.
- Telegram delivery retries are idempotent.
- Telegram group messages require mention by default.
- WebChat can send and receive agent messages for debug/control use.

### Milestone 9: Doctor And Audit

Files:

- `src/cli/doctor.ts`
- `src/security/audit.ts`
- `src/config/effective.ts`

Acceptance:

- `clawflare doctor` reports missing bindings/secrets/config.
- Security audit catches public unsafe setup.
- Audit events are queryable.

## Testing Strategy

Unit tests:

- Protocol schemas.
- Method dispatch.
- Policy decisions.
- Provider normalization.
- Tool input/output validation.
- Plugin resolver and scanner.
- Queue message idempotency.

Integration tests:

- Worker routes with Miniflare/Workers test pool.
- Durable Object WebSocket handshake.
- Agent run loop with fake provider.
- R2 transcript writes.
- D1 migrations.
- Queue consumer processing.

Compatibility fixtures:

- OpenClaw-style `connect` request.
- OpenClaw-style `agent` request.
- OpenAI `/v1/chat/completions` request.
- OpenAI `/v1/responses` request.
- ClawHub skill metadata sample.
- Native `openclaw.plugin.json` sample.

Live tests:

- Cloudflare AI Gateway model call.
- Telegram webhook send/receive.
- Telegram delivery retry/idempotency.
- Vectorize memory search.

Live tests must be opt-in and skipped by default.

## Coding Standards

- Strict TypeScript.
- No default `any`.
- All public payloads schema-validated.
- No direct `env.SECRET` reads outside provider/channel secret resolvers.
- No direct R2/D1/KV access outside `src/storage` adapters unless a module owns a Cloudflare primitive by design.
- Every side-effecting method requires an idempotency key or server-generated dedupe key.
- Every privileged action writes an audit event.
- Every unsupported compatibility method returns a typed error.
- Large payloads use R2 pointers.

## Risks

Primary risks:

- OpenClaw protocol drift.
- ClawHub API drift.
- Native plugin expectations exceeding Workers runtime constraints.
- Durable Object hibernation breaking assumed in-memory state.
- Provider streaming differences.
- Queue retries duplicating side effects.
- Secret leakage through logs, prompts, plugin scans, or audit payloads.

Mitigations:

- Keep protocol fixtures copied from OpenClaw examples.
- Version every public schema.
- Make queue consumers idempotent.
- Keep secrets behind narrow resolver functions.
- Fail closed for plugin execution.
- Keep Containers optional until the isolate-native path is stable.

## Non-Goals For MVP

- Full OpenClaw Gateway parity.
- Running OpenClaw itself unchanged in Workers.
- Shell/exec tools.
- Docker/SSH/OpenShell sandboxes.
- Arbitrary native plugin execution.
- Local-device channels.
- Mobile nodes.
- Browser automation.
- Multi-tenant hostile isolation in one shared agent.

## First Implementation Order

Start with this exact order:

1. Scaffold package, TypeScript, Wrangler, tests.
2. Define `Env`, protocol schemas, and error types.
3. Implement `/healthz`.
4. Implement `AgentObject` addressability.
5. Implement WS challenge and `connect`.
6. Implement `health` method.
7. Implement fake provider and agent run loop.
8. Implement R2 transcript persistence.
9. Implement OpenAI-compatible non-streaming HTTP endpoints.
10. Add queue envelope and one consumer.
11. Add workspace tools.
12. Add ClawHub skill resolver and install plan.

Only after step 12 should we add real channels or native plugin compatibility.
