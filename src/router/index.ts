import type { ClawflareEnv } from "../env";
import { getRuntimeDefaults } from "../env";
import { createHelloOk, serverVersion, supportedEvents, supportedMethods } from "../protocol/connect";
import { badRequest, methodNotAllowed, notFound, notImplemented, toClawflareError } from "../protocol/errors";
import { jsonResponse } from "../shared/http";
import { handleWebChatMessage } from "../channels/webchat";
import { handleTelegramSetWebhook, handleTelegramStatus, handleTelegramWebhook } from "../channels/telegram";
import { renderDebugWebChat } from "../web";
import { handleChatCompletions, handleModelGet, handleModelsList, handleResponses } from "./openai";
import { handleDoctor } from "./doctor";

type RouteHandler = (request: Request, env: ClawflareEnv, ctx?: ExecutionContext) => Response | Promise<Response>;

interface ReservedRoute {
  method: string;
  path: string;
  handler: RouteHandler;
}

function routeKey(method: string, path: string): string {
  return `${method.toUpperCase()} ${path}`;
}

function errorResponse(error: unknown): Response {
  const normalized = toClawflareError(error);

  return jsonResponse(
    {
      ok: false,
      error: normalized.gatewayError,
    },
    { status: normalized.status },
  );
}

function reservedNotImplemented(request: Request): Response {
  const url = new URL(request.url);
  const route = routeKey(request.method, url.pathname);
  const error = notImplemented(route);

  return errorResponse(error);
}

function getAgentObjectStub(env: ClawflareEnv): DurableObjectStub {
  const defaults = getRuntimeDefaults(env);
  const id = env.AGENT_OBJECT.idFromName(`${defaults.accountId}:${defaults.agentId}`);
  return env.AGENT_OBJECT.get(id);
}

async function routeWebSocket(request: Request, env: ClawflareEnv): Promise<Response> {
  if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    return errorResponse(badRequest("Expected WebSocket upgrade for /ws.", {
      route: routeKey(request.method, new URL(request.url).pathname),
    }));
  }

  return getAgentObjectStub(env).fetch(request);
}

function routeHealth(request: Request, env: ClawflareEnv): Response {
  const url = new URL(request.url);
  const defaults = getRuntimeDefaults(env);

  return jsonResponse({
    ok: true,
    service: "clawflare",
    runtime: "cloudflare-workers",
    version: serverVersion,
    defaults,
    protocol: {
      version: createHelloOk(env, "healthz").protocol,
      methods: supportedMethods,
      events: supportedEvents,
    },
    route: routeKey(request.method, url.pathname),
  });
}

function routeRoot(): Response {
  return renderDebugWebChat();
}

const reservedRoutes: ReservedRoute[] = [
  { method: "GET", path: "/", handler: routeRoot },
  { method: "POST", path: "/webchat/message", handler: handleWebChatMessage },
  { method: "GET", path: "/healthz", handler: routeHealth },
  { method: "GET", path: "/doctor", handler: handleDoctor },
  { method: "GET", path: "/ws", handler: routeWebSocket },
  { method: "GET", path: "/v1/models", handler: handleModelsList },
  { method: "POST", path: "/v1/chat/completions", handler: handleChatCompletions },
  { method: "POST", path: "/v1/responses", handler: handleResponses },
  { method: "POST", path: "/webhook/telegram", handler: handleTelegramWebhook },
  { method: "GET", path: "/telegram/status", handler: handleTelegramStatus },
  { method: "POST", path: "/telegram/set-webhook", handler: handleTelegramSetWebhook },
  { method: "POST", path: "/tools/invoke", handler: reservedNotImplemented },
];

const routeTable = new Map(reservedRoutes.map((route) => [routeKey(route.method, route.path), route]));
const knownPaths = new Set(reservedRoutes.map((route) => route.path));

function matchDynamicRoute(method: string, path: string): ReservedRoute | undefined {
  if (method === "GET" && path.startsWith("/v1/models/") && path.length > "/v1/models/".length) {
    return {
      method,
      path,
      handler: (request, env) => handleModelGet(request, env, decodeURIComponent(path.slice("/v1/models/".length))),
    };
  }

  return undefined;
}

export async function routeRequest(request: Request, env: ClawflareEnv, ctx?: ExecutionContext): Promise<Response> {
  try {
    const url = new URL(request.url);
    const method = request.method.toUpperCase();
    const route = routeTable.get(routeKey(method, url.pathname)) ?? matchDynamicRoute(method, url.pathname);

    if (route) {
      return await route.handler(request, env, ctx);
    }

    if (knownPaths.has(url.pathname)) {
      return errorResponse(methodNotAllowed(method, url.pathname));
    }

    if (url.pathname.startsWith("/v1/models/")) {
      return errorResponse(methodNotAllowed(method, url.pathname));
    }

    return errorResponse(notFound("Route not found", { route: routeKey(method, url.pathname) }));
  } catch (error) {
    return errorResponse(error);
  }
}
