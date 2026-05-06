# Local Setup

## Prerequisites

- Node.js 22 or newer.
- Corepack enabled for `pnpm`.
- Cloudflare Wrangler auth for deploy/dry-run checks.

## Install

```sh
corepack pnpm install
```

## Verify

```sh
corepack pnpm typecheck
corepack pnpm test
corepack pnpm exec wrangler deploy --dry-run --outdir .wrangler-dry-run
```

The unit suite uses mocked providers, Telegram Bot API, queues, and storage adapters. It does not call paid external model APIs.

## Run Locally

```sh
corepack pnpm dev
```

Before testing authenticated routes, configure `CLAWFLARE_GATEWAY_TOKEN` as a Wrangler secret or local dev secret.
