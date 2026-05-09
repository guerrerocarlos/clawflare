# Clawflare

Clawflare is an OpenClaw-compatible agent gateway subset built for Cloudflare Workers, Durable Objects, Queues, R2, D1, KV, and Workers AI. The MVP is Telegram-first and uses WebChat/HTTP mostly as debug and compatibility surfaces.

Primary live endpoint:

- `https://clawflare.omattic.com`

Telegram webhook:

- `https://clawflare.omattic.com/webhook/telegram`

`GET /` serves a minimal WebChat page for local debugging/control only.

## What It Does

- Accepts Telegram messages and routes them into a Durable Object-backed agent runtime.
- Exposes an OpenClaw-compatible protocol subset over HTTP/WebSocket.
- Stores session/run state in Durable Object SQLite.
- Stores artifacts/transcripts/plugin payloads in R2.
- Uses Cloudflare Queues for retryable background work.
- Supports ClawHub package search, inspection, install planning, install, and enable flows.
- Uses an OpenAI-compatible provider path for model inference. Current default is OpenRouter with:
  - `OPENAI_COMPATIBLE_BASE_URL=https://openrouter.ai/api/v1`
  - `CLAWFLARE_DEFAULT_MODEL=nvidia/nemotron-3-super-120b-a12b:free`

## How It Works

Runtime flow:

1. Telegram sends an update to `/webhook/telegram`.
2. The Worker validates the webhook secret, normalizes the message, and forwards it to the per-agent Durable Object.
3. The Durable Object creates a run, builds a prompt, injects enabled plugin skills, and calls the selected provider.
4. The result is stored and sent back through Telegram.

Core files:

- [src/channels/telegram.ts](src/channels/telegram.ts)
- [src/agents/agent-object.ts](src/agents/agent-object.ts)
- [src/agents/run-loop.ts](src/agents/run-loop.ts)
- [src/providers/defaults.ts](src/providers/defaults.ts)

## Providers

The agent runtime selects a default provider from environment/config:

- If `OPENAI_API_KEY` is set, it uses the OpenAI-compatible provider.
- If `AI` is bound and the default model starts with `@cf/`, it uses Workers AI.
- Otherwise it falls back to the fake provider used for tests and bring-up.

Current production default is OpenRouter via the OpenAI-compatible provider.

Relevant files:

- [src/providers/defaults.ts](src/providers/defaults.ts)
- [src/providers/openai-compatible.ts](src/providers/openai-compatible.ts)
- [src/providers/workers-ai.ts](src/providers/workers-ai.ts)

## Plugins

Current plugin behavior is skills-first, not native execution.

What works:

- `plugins.search`
- `plugins.inspect`
- `plugins.planInstall`
- `plugins.install`
- `plugins.enable`

What an enabled plugin does today:

- its `skills` content is injected into the agent prompt as extra instructions

What does not work yet:

- native plugin runtime execution
- hooks
- plugin-defined executable tools
- autonomous self-install inside the agent loop

Important current limitation:

- installed plugin metadata is stored durably in D1
- enabled/runtime state is stored durably in Durable Object SQLite
- manifests and archives are persisted to R2
- native plugin execution and plugin-contributed executable tools are still not implemented

Relevant files:

- [src/plugins/runtime.ts](src/plugins/runtime.ts)
- [src/plugins/prompt.ts](src/plugins/prompt.ts)
- [src/plugins/manifest.ts](src/plugins/manifest.ts)
- [src/plugins/install-plan.ts](src/plugins/install-plan.ts)
- [src/plugins/registry.ts](src/plugins/registry.ts)

## Tools

Built-in tools currently defined:

- `workspace_list`
- `workspace_read`
- `workspace_write`
- `workspace_patch`
- `web_fetch`
- `message_send`
- `memory_search`

Important limitation:

- tools are registered and exposed in the protocol catalog
- direct `tools.invoke` is implemented for the gateway and HTTP route
- the agent run loop now supports a bounded first-pass tool loop using a strict structured tool-call format
- the autonomous loop is intentionally conservative and currently limited to `workspace_list`, `workspace_read`, and `web_fetch`

So today the agent is no longer purely prompt-to-provider, but it is still an early-stage tool-using agent rather than a full OpenClaw-style execution loop.

Relevant files:

- [src/tools/registry.ts](src/tools/registry.ts)
- [src/tools/workspace.ts](src/tools/workspace.ts)
- [src/tools/web-fetch.ts](src/tools/web-fetch.ts)
- [src/tools/message-send.ts](src/tools/message-send.ts)
- [src/tools/memory-search.ts](src/tools/memory-search.ts)
- [src/gateway/methods.ts](src/gateway/methods.ts)

## Extending The Agent

How to give the agent more tools today:

1. Implement a new tool runtime in `src/tools/`.
2. Register it in `createDefaultToolRegistry()` in [src/tools/registry.ts](src/tools/registry.ts).
3. Define its input/output schema and any policy checks.
4. Expose it through the protocol catalog and `tools.invoke`.
5. Decide whether it is safe for operator-only invocation, autonomous model invocation, or both.

How plugins affect behavior today:

- plugin install/enable flows are available through the gateway
- enabled plugin `skills` are injected into the prompt
- plugins do not yet execute code inside the agent runtime

How to improve the agent today:

- change the default provider or model
- refine the base system prompt/runtime instructions
- enable prompt-skill plugins
- add more built-in tools

What is still missing for a more OpenClaw-like agent:

- richer iterative tool calling in the run loop
- native model tool-calling support instead of the current structured text tool-call protocol
- broader autonomous tool allowlists and stronger execution policies
- plugin-contributed executable tools
- native plugin execution and hooks
- stronger memory retrieval/write flows

## Current Limits

OpenClaw-compatible subset implemented:

- `connect`
- `health`
- `agent`
- `agent.wait`
- `sessions.list`
- `tools.catalog`
- `plugins.search`
- `plugins.inspect`
- `plugins.planInstall`
- `plugins.install`
- `plugins.enable`

Not implemented yet:

- broader autonomous tool use beyond the current safe subset
- native model tool-calling support
- native plugin execution
- real memory search/indexing
- long-running self-improvement flows

## Queues

The following queues are provisioned and live:

- `clawflare-channel-delivery`
- `clawflare-webhook-events`
- `clawflare-transcript-indexing`
- `clawflare-plugin-scans`
- `clawflare-audit-events`

Queues are used for retryable/background work, not for ordered turn execution.

## Development

Use Corepack if `pnpm` is not installed directly:

```sh
corepack pnpm install
corepack pnpm typecheck
corepack pnpm test
corepack pnpm dev
```

Useful scripts:

```sh
corepack pnpm lint
corepack pnpm format
corepack pnpm check
corepack pnpm db:generate
corepack pnpm db:migrate:local
```

Detailed setup docs:

- [Local setup](docs/local-setup.md)
- [Deploy setup](docs/deploy-setup.md)
- [Telegram setup](docs/telegram.md)

## Configuration

Bindings and vars are declared in `wrangler.jsonc`.

Database schema and migrations are managed with Drizzle:

- D1 schema: [src/db/d1-schema.ts](src/db/d1-schema.ts)
- Durable Object SQLite schema: [src/db/do-schema.ts](src/db/do-schema.ts)
- D1 migration output: [drizzle/d1](drizzle/d1)
- Durable Object migration bundle: [drizzle/do/migrations.ts](drizzle/do/migrations.ts)

Secrets are set with `wrangler secret put`:

```sh
npx wrangler@4.90.0 secret put CLAWFLARE_GATEWAY_TOKEN
npx wrangler@4.90.0 secret put TELEGRAM_BOT_TOKEN
npx wrangler@4.90.0 secret put TELEGRAM_WEBHOOK_SECRET
npx wrangler@4.90.0 secret put TELEGRAM_ALLOWED_USER_IDS
npx wrangler@4.90.0 secret put OPENAI_API_KEY
```

Optional secrets/vars:

```sh
npx wrangler@4.90.0 secret put TELEGRAM_BOT_USERNAME
```

Local development can use a `.env` file. The current local `.env` convention includes:

```sh
OPENAI_API_KEY=...
OPENAI_COMPATIBLE_BASE_URL=https://openrouter.ai/api/v1
CLAWFLARE_DEFAULT_MODEL=nvidia/nemotron-3-super-120b-a12b:free
```

## Deployment

GitHub Actions deploys on `main` using:

- `npx wrangler@4.90.0 deploy`
- secret sync from GitHub Actions secrets into the Worker
- Telegram webhook sync after deploy

Current workflow:

- [.github/workflows/deploy.yml](.github/workflows/deploy.yml)
