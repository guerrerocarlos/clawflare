import type { ClawflareEnv, QueuePayload } from "../env";

export class TelegramRetryableDeliveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TelegramRetryableDeliveryError";
  }
}

export class TelegramPermanentDeliveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TelegramPermanentDeliveryError";
  }
}

export interface TelegramSendMessageInput {
  chatId: string;
  text: string;
  replyToMessageId?: number;
}

export function splitTelegramText(text: string, limit = 3900): string[] {
  if (text.length <= limit) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    chunks.push(remaining.slice(0, limit));
    remaining = remaining.slice(limit);
  }

  return chunks;
}

function telegramApiBase(env: ClawflareEnv): string {
  return env.TELEGRAM_API_BASE_URL ?? "https://api.telegram.org";
}

export async function sendTelegramMessage(
  env: ClawflareEnv,
  input: TelegramSendMessageInput,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN) {
    throw new TelegramPermanentDeliveryError("TELEGRAM_BOT_TOKEN is not configured.");
  }

  for (const chunk of splitTelegramText(input.text)) {
    const response = await fetcher(`${telegramApiBase(env)}/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: input.chatId,
        text: chunk,
        ...(input.replyToMessageId === undefined ? {} : { reply_to_message_id: input.replyToMessageId }),
      }),
    });

    if (response.ok) {
      continue;
    }

    if (response.status === 401 || response.status === 403) {
      throw new TelegramPermanentDeliveryError(`Telegram rejected the bot token or chat access with ${response.status}.`);
    }

    if (response.status === 429 || response.status >= 500) {
      throw new TelegramRetryableDeliveryError(`Telegram delivery failed transiently with ${response.status}.`);
    }

    throw new TelegramPermanentDeliveryError(`Telegram delivery failed permanently with ${response.status}.`);
  }
}

export async function enqueueTelegramRetry(
  env: ClawflareEnv,
  input: TelegramSendMessageInput,
  accountId: string,
  agentId: string,
): Promise<void> {
  const message: QueuePayload = {
    version: 1,
    type: "channel.delivery.retry",
    id: crypto.randomUUID(),
    accountId,
    agentId,
    idempotencyKey: `telegram:${input.chatId}:${crypto.randomUUID()}`,
    attempt: 0,
    createdAt: new Date().toISOString(),
    payload: {
      channel: "telegram",
      ...input,
    },
  };

  await env.CHANNEL_DELIVERY_QUEUE.send(message);
}
