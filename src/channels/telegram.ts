import type { ClawflareEnv } from "../env";
import { getRuntimeDefaults } from "../env";
import { chatMessageToAgentInput } from "./session-routing";
import {
  enqueueTelegramRetry,
  sendTelegramMessage,
  TelegramPermanentDeliveryError,
  TelegramRetryableDeliveryError,
} from "./telegram-delivery";
import type { NormalizedChatMessage } from "./types";

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

interface TelegramMessage {
  message_id: number;
  message_thread_id?: number;
  text?: string;
  chat: {
    id: number;
    type: "private" | "group" | "supergroup" | "channel";
    title?: string;
  };
  from?: {
    id: number;
    username?: string;
    first_name?: string;
  };
}

interface AgentObjectRunResponse {
  accepted?: {
    runId: string;
  };
  result?: {
    status: string;
    summary?: {
      outputText?: string;
    };
    error?: {
      message?: string;
      code?: string;
      status?: number;
    };
  };
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function configuredTelegramWebhookUrl(env: ClawflareEnv): string | null {
  if (!env.CLAWFLARE_PUBLIC_BASE_URL) {
    return null;
  }

  return new URL("/webhook/telegram", env.CLAWFLARE_PUBLIC_BASE_URL).toString();
}

function authControl(request: Request, env: ClawflareEnv): Response | null {
  const expected = env.CLAWFLARE_GATEWAY_TOKEN;
  const authorization = request.headers.get("authorization");
  const token = authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : undefined;

  if (!expected || token !== expected) {
    return json({ ok: false, error: { code: "UNAUTHORIZED" } }, 401);
  }

  return null;
}

function verifyWebhookSecret(request: Request, env: ClawflareEnv): Response | null {
  if (!env.TELEGRAM_WEBHOOK_SECRET) {
    return json({ ok: false, error: { code: "UNAUTHORIZED", message: "TELEGRAM_WEBHOOK_SECRET is not configured." } }, 401);
  }

  if (request.headers.get("x-telegram-bot-api-secret-token") !== env.TELEGRAM_WEBHOOK_SECRET) {
    return json({ ok: false, error: { code: "UNAUTHORIZED", message: "Invalid Telegram webhook secret." } }, 401);
  }

  return null;
}

async function isDuplicate(env: ClawflareEnv, updateId: number): Promise<boolean> {
  const key = `telegram:update:${updateId}`;

  if ((await env.CATALOG_CACHE.get(key)) !== null) {
    return true;
  }

  await env.CATALOG_CACHE.put(key, "1", { expirationTtl: 24 * 60 * 60 });
  return false;
}

async function senderAllowed(env: ClawflareEnv, senderId: string): Promise<boolean> {
  const configured = (env.TELEGRAM_ALLOWED_USER_IDS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (configured.includes(senderId)) {
    return true;
  }

  return (await env.CATALOG_CACHE.get(`telegram:allow:user:${senderId}`)) === "1";
}

function normalizeTelegramMessage(env: ClawflareEnv, message: TelegramMessage): NormalizedChatMessage | null {
  if (!message.text || !message.from) {
    return null;
  }

  const isGroup = message.chat.type === "group" || message.chat.type === "supergroup";
  let text = message.text.trim();

  if (isGroup) {
    const username = env.TELEGRAM_BOT_USERNAME;
    const mentionsBot = username ? text.includes(`@${username}`) : false;
    const command = text.startsWith("/");

    if (!mentionsBot && !command) {
      return null;
    }

    if (username) {
      text = text.replaceAll(`@${username}`, "").trim();
    }
  }

  const normalized: NormalizedChatMessage = {
    channel: "telegram",
    chatId: String(message.chat.id),
    senderId: String(message.from.id),
    text,
    isGroup,
    messageId: message.message_id,
    ...(message.message_thread_id === undefined ? {} : { threadId: String(message.message_thread_id) }),
  };

  const senderName = message.from.username ?? message.from.first_name;

  if (senderName !== undefined) {
    normalized.senderName = senderName;
  }

  return normalized;
}

async function reply(env: ClawflareEnv, message: NormalizedChatMessage, text: string): Promise<void> {
  const defaults = getRuntimeDefaults(env);

  try {
    const delivery = {
      chatId: message.chatId,
      text,
      ...(message.messageId === undefined ? {} : { replyToMessageId: message.messageId }),
    };
    await sendTelegramMessage(env, delivery);
  } catch (error) {
    if (error instanceof TelegramRetryableDeliveryError) {
      await enqueueTelegramRetry(
        env,
        {
          chatId: message.chatId,
          text,
          ...(message.messageId === undefined ? {} : { replyToMessageId: message.messageId }),
        },
        defaults.accountId,
        defaults.agentId,
      );
      return;
    }

    if (error instanceof TelegramPermanentDeliveryError) {
      return;
    }

    throw error;
  }
}

async function invokeAgent(env: ClawflareEnv, request: Request, message: NormalizedChatMessage): Promise<string> {
  const defaults = getRuntimeDefaults(env);
  const id = env.AGENT_OBJECT.idFromName(`${defaults.accountId}:${defaults.agentId}`);
  const url = new URL(request.url);
  url.pathname = "/__clawflare/agent/openai-run";
  url.search = "";
  const response = await env.AGENT_OBJECT.get(id).fetch(
    new Request(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: chatMessageToAgentInput(message) }),
    }),
  );
  const payload = (await response.json()) as AgentObjectRunResponse;

  if (payload.result?.status === "failed") {
    const message = payload.result.error?.message;
    return message ? `Provider error: ${message}` : "Provider error: agent run failed.";
  }

  return payload.result?.summary?.outputText ?? "No response produced.";
}

function commandResponse(env: ClawflareEnv, message: NormalizedChatMessage): string | null {
  const text = message.text.trim();

  if (text.startsWith("/start")) {
    return "Clawflare is connected. Send a message here to talk to the agent.";
  }

  if (text.startsWith("/help")) {
    return "Commands: /start, /help, /status, /plugin search <query>, /plugin install <ref>.";
  }

  if (text.startsWith("/status")) {
    const defaults = getRuntimeDefaults(env);
    return `Clawflare status: ok. Account ${defaults.accountId}, agent ${defaults.agentId}.`;
  }

  if (text.startsWith("/plugin search ")) {
    const query = text.slice("/plugin search ".length).trim();
    return `Plugin search requested for "${query}". ClawHub search is wired in the plugin phase.`;
  }

  if (text.startsWith("/plugin install ")) {
    const ref = text.slice("/plugin install ".length).trim();
    return `Plugin install plan requested for "${ref}". Approval flow will inspect the ClawHub package before enabling it.`;
  }

  return null;
}

export async function handleTelegramWebhook(request: Request, env: ClawflareEnv): Promise<Response> {
  const secretError = verifyWebhookSecret(request, env);

  if (secretError) {
    return secretError;
  }

  const update = (await request.json()) as TelegramUpdate;

  if (await isDuplicate(env, update.update_id)) {
    return json({ ok: true, deduped: true });
  }

  if (!update.message) {
    return json({ ok: true, ignored: true });
  }

  const message = normalizeTelegramMessage(env, update.message);

  if (!message) {
    return json({ ok: true, ignored: true });
  }

  if (!(await senderAllowed(env, message.senderId))) {
    await reply(env, message, "This Telegram sender is not paired with Clawflare yet. Ask the operator to allowlist this user.");
    return json({ ok: true, pendingApproval: true });
  }

  const command = commandResponse(env, message);

  if (command) {
    await reply(env, message, command);
    return json({ ok: true, command: true });
  }

  const output = await invokeAgent(env, request, message);
  await reply(env, message, output);

  return json({ ok: true });
}

export async function handleTelegramStatus(request: Request, env: ClawflareEnv): Promise<Response> {
  const auth = authControl(request, env);

  if (auth) {
    return auth;
  }

  return json({
    ok: true,
    telegram: {
      botTokenConfigured: Boolean(env.TELEGRAM_BOT_TOKEN),
      webhookSecretConfigured: Boolean(env.TELEGRAM_WEBHOOK_SECRET),
      botUsername: env.TELEGRAM_BOT_USERNAME ?? null,
      webhookUrl: configuredTelegramWebhookUrl(env),
    },
  });
}

export async function handleTelegramSetWebhook(request: Request, env: ClawflareEnv): Promise<Response> {
  const auth = authControl(request, env);

  if (auth) {
    return auth;
  }

  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_WEBHOOK_SECRET) {
    return json({ ok: false, error: { code: "TELEGRAM_NOT_CONFIGURED" } }, 400);
  }

  const body = request.headers.get("content-length") === "0" ? {} : ((await request.json()) as { url?: string });
  const webhookUrl = body.url ?? configuredTelegramWebhookUrl(env);

  if (!webhookUrl) {
    return json({ ok: false, error: { code: "BAD_REQUEST", message: "url is required." } }, 400);
  }

  const response = await fetch(`${env.TELEGRAM_API_BASE_URL ?? "https://api.telegram.org"}/bot${env.TELEGRAM_BOT_TOKEN}/setWebhook`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      url: webhookUrl,
      secret_token: env.TELEGRAM_WEBHOOK_SECRET,
    }),
  });
  const payload = await response.json();

  return json({ ok: response.ok, telegram: payload }, response.ok ? 200 : 502);
}
