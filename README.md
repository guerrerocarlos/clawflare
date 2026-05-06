# Clawflare

Clawflare is an OpenClaw-compatible agent gateway subset designed for Cloudflare Workers, Durable Objects, Queues, R2, D1, KV, Vectorize, and Workers AI. The MVP uses Telegram as the primary communication channel and keeps WebChat/HTTP endpoints as debug and compatibility surfaces.

## MVP Scope

- OpenClaw-compatible Gateway protocol subset.
- Durable Object per-agent gateway/runtime.
- Cloudflare Queues for retryable background work, not ordered agent turns.
- Telegram-first channel integration.
- ClawHub-compatible plugin search, planning, and skills-first install flow.
- Optional Cloudflare Containers later for tasks that cannot run in isolates.

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
```

## Configuration

Bindings are declared in `wrangler.jsonc`. Placeholder IDs such as `replace-after-create` must be replaced after creating Cloudflare resources.

Secrets are set with `wrangler secret put`:

```sh
wrangler secret put CLAWFLARE_GATEWAY_TOKEN
wrangler secret put TELEGRAM_BOT_TOKEN
wrangler secret put TELEGRAM_WEBHOOK_SECRET
```

Provider secrets such as `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, and `CLOUDFLARE_AI_GATEWAY_API_KEY` are optional until provider runtime phases are implemented.
