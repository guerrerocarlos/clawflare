# Telegram Setup

Telegram is the MVP primary channel.

## Bot Setup

1. Create a bot with BotFather and set `TELEGRAM_BOT_TOKEN`.
2. Generate a high-entropy webhook secret and set `TELEGRAM_WEBHOOK_SECRET`.
3. Set `TELEGRAM_ALLOWED_USER_IDS` to comma-separated Telegram user IDs allowed to talk to the agent.
4. Optionally set `TELEGRAM_BOT_USERNAME` so group mentions can be enforced accurately.

## Register Webhook

Use the authenticated helper route:

```sh
curl -X POST https://<worker-host>/telegram/set-webhook \
  -H "Authorization: Bearer $CLAWFLARE_GATEWAY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://<worker-host>/webhook/telegram"}'
```

The Worker verifies `X-Telegram-Bot-Api-Secret-Token` on every Telegram webhook request.

## Commands

- `/start`
- `/help`
- `/status`
- `/plugin search <query>`
- `/plugin install <ref>`

Groups require a command or mention of `TELEGRAM_BOT_USERNAME`.
