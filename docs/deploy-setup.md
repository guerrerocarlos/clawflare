# Deploy Setup

## Cloudflare Resources

Create the resources referenced by `wrangler.jsonc`, then replace placeholder IDs:

- D1 database: `clawflare`
- KV namespace: `CATALOG_CACHE`
- R2 buckets: `clawflare-transcripts`, `clawflare-artifacts`, `clawflare-plugin-archives`
- Queues: `channel-delivery`, `webhook-events`, `transcript-indexing`, `plugin-scans`, `audit-events`
- Vectorize index: `clawflare-memory`
- Workers AI binding: `AI`

## Secrets

```sh
wrangler secret put CLAWFLARE_GATEWAY_TOKEN
wrangler secret put TELEGRAM_BOT_TOKEN
wrangler secret put TELEGRAM_WEBHOOK_SECRET
wrangler secret put TELEGRAM_ALLOWED_USER_IDS
```

Provider secrets are optional until those providers are selected:

```sh
wrangler secret put OPENAI_API_KEY
wrangler secret put ANTHROPIC_API_KEY
wrangler secret put CLOUDFLARE_AI_GATEWAY_API_KEY
```

## Deploy

```sh
corepack pnpm typecheck
corepack pnpm test
corepack pnpm deploy
```

After deploy, run the authenticated doctor route:

```sh
curl -H "Authorization: Bearer $CLAWFLARE_GATEWAY_TOKEN" https://<worker-host>/doctor
```
