import type { ClawflareEnv } from "../env";
import { getRuntimeDefaults } from "../env";
import type { AgentEventSink, AgentRunInput, AgentRuntime, AgentWaitInput } from "../agents/runtime";
import { createHelloOk, protocolVersion, supportedEvents, supportedMethods } from "../protocol/connect";
import { createDefaultToolRegistry } from "../tools/registry";
import {
  badRequest,
  createGatewayError,
  ClawflareError,
  notImplemented,
  toClawflareError,
  unauthorized,
} from "../protocol/errors";
import { errorResponseFrame, responseFrame, type GatewayRequest, type GatewayResponse } from "../protocol/frames";
import { markAuthenticated, type GatewayConnectionState } from "./state";

export interface GatewayMethodContext {
  env: ClawflareEnv;
  connection: GatewayConnectionState;
  agentRuntime?: AgentRuntime;
  emitAgentEvent?: AgentEventSink;
}

function getObjectParams(params: unknown): Record<string, unknown> {
  if (params === undefined) {
    return {};
  }

  if (typeof params !== "object" || params === null || Array.isArray(params)) {
    throw badRequest("Method params must be an object.");
  }

  return params as Record<string, unknown>;
}

function requireAuthenticated(connection: GatewayConnectionState): void {
  if (!connection.authenticated) {
    throw unauthorized("Connection is not authenticated.");
  }
}

function executeConnect(request: GatewayRequest, context: GatewayMethodContext): unknown {
  const params = getObjectParams(request.params);
  const expectedToken = context.env.CLAWFLARE_GATEWAY_TOKEN;

  if (!expectedToken) {
    throw unauthorized("CLAWFLARE_GATEWAY_TOKEN is not configured.");
  }

  if (params.token !== expectedToken) {
    throw unauthorized("Invalid gateway token.");
  }

  const scopes = ["read", "write", "admin"];
  markAuthenticated(context.connection, scopes);

  return createHelloOk(context.env, context.connection.connId);
}

function executeHealth(context: GatewayMethodContext): unknown {
  requireAuthenticated(context.connection);

  return {
    type: "health",
    ok: true,
    protocol: protocolVersion,
    defaults: getRuntimeDefaults(context.env),
    connection: {
      connId: context.connection.connId,
      authenticated: context.connection.authenticated,
      seq: context.connection.seq,
      lastSeenAt: context.connection.lastSeenAt,
      scopes: context.connection.scopes,
    },
    features: {
      methods: supportedMethods,
      events: supportedEvents,
    },
  };
}

function requireAgentRuntime(context: GatewayMethodContext, method: string): AgentRuntime {
  if (!context.agentRuntime) {
    throw methodNotImplemented(method);
  }

  return context.agentRuntime;
}

function methodNotImplemented(method: string): ClawflareError {
  return new ClawflareError(
    createGatewayError({
      code: "NOT_IMPLEMENTED",
      message: `Gateway method ${method} is not implemented yet.`,
      details: { method },
    }),
    501,
  );
}

function parseMessages(params: Record<string, unknown>): AgentRunInput["messages"] {
  if (Array.isArray(params.messages)) {
    return params.messages.map((message) => {
      if (typeof message !== "object" || message === null) {
        throw badRequest("messages entries must be objects.");
      }

      const item = message as Record<string, unknown>;

      if (typeof item.role !== "string" || typeof item.content !== "string") {
        throw badRequest("messages entries must include string role and content.");
      }

      return {
        role: item.role as AgentRunInput["messages"][number]["role"],
        content: item.content,
      };
    });
  }

  if (typeof params.message === "string") {
    return [{ role: "user", content: params.message }];
  }

  if (typeof params.prompt === "string") {
    return [{ role: "user", content: params.prompt }];
  }

  throw badRequest("agent requires messages, message, or prompt.");
}

function parseAgentRunInput(params: Record<string, unknown>, connection: GatewayConnectionState): AgentRunInput {
  const session = typeof params.session === "object" && params.session !== null ? (params.session as Record<string, unknown>) : undefined;
  const input: AgentRunInput = {
    session: {
      channel: typeof session?.channel === "string" ? session.channel : "gateway",
      peerId: typeof session?.peerId === "string" ? session.peerId : connection.connId,
      ...(typeof session?.threadId === "string" ? { threadId: session.threadId } : {}),
    },
    messages: parseMessages(params),
  };

  if (typeof params.accountId === "string") {
    input.accountId = params.accountId;
  }

  if (typeof params.agentId === "string") {
    input.agentId = params.agentId;
  }

  if (typeof params.sessionKey === "string") {
    input.sessionKey = params.sessionKey;
  }

  if (typeof params.model === "string") {
    input.model = params.model;
  }

  if (typeof params.idempotencyKey === "string") {
    input.idempotencyKey = params.idempotencyKey;
  }

  if (typeof params.metadata === "object" && params.metadata !== null) {
    input.metadata = params.metadata as Record<string, unknown>;
  }

  return input;
}

async function executeAgent(request: GatewayRequest, context: GatewayMethodContext): Promise<unknown> {
  requireAuthenticated(context.connection);
  const runtime = requireAgentRuntime(context, "agent");
  const params = getObjectParams(request.params);

  return await runtime.startRun(
    parseAgentRunInput(params, context.connection),
    context.emitAgentEvent === undefined ? undefined : { sink: context.emitAgentEvent },
  );
}

async function executeAgentWait(request: GatewayRequest, context: GatewayMethodContext): Promise<unknown> {
  requireAuthenticated(context.connection);
  const runtime = requireAgentRuntime(context, "agent.wait");
  const params = getObjectParams(request.params);

  if (typeof params.runId !== "string") {
    throw badRequest("agent.wait requires runId.");
  }

  const waitInput: AgentWaitInput = {
    runId: params.runId,
    ...(typeof params.timeoutMs === "number" ? { timeoutMs: params.timeoutMs } : {}),
  };

  return await runtime.waitForRun(waitInput);
}

async function executeSessionsList(request: GatewayRequest, context: GatewayMethodContext): Promise<unknown> {
  requireAuthenticated(context.connection);
  const runtime = requireAgentRuntime(context, "sessions.list");
  const params = getObjectParams(request.params);

  const input: { accountId?: string; agentId?: string } = {};

  if (typeof params.accountId === "string") {
    input.accountId = params.accountId;
  }

  if (typeof params.agentId === "string") {
    input.agentId = params.agentId;
  }

  return await runtime.listSessions(input);
}

export async function executeGatewayMethod(request: GatewayRequest, context: GatewayMethodContext): Promise<unknown> {
  switch (request.method) {
    case "connect":
      return executeConnect(request, context);
    case "health":
      return executeHealth(context);
    case "agent":
      return await executeAgent(request, context);
    case "agent.wait":
      return await executeAgentWait(request, context);
    case "sessions.list":
      return await executeSessionsList(request, context);
    case "tools.catalog":
      requireAuthenticated(context.connection);
      return { tools: createDefaultToolRegistry().catalog() };
    default:
      if (supportedMethods.includes(request.method as (typeof supportedMethods)[number])) {
        requireAuthenticated(context.connection);
        throw methodNotImplemented(request.method);
      }

      throw notImplemented(`method ${request.method}`);
  }
}

export async function dispatchGatewayMethod(
  request: GatewayRequest,
  context: GatewayMethodContext,
): Promise<GatewayResponse> {
  try {
    const payload = await executeGatewayMethod(request, context);
    return responseFrame(request.id, payload);
  } catch (error) {
    return errorResponseFrame(request.id, toClawflareError(error).gatewayError);
  }
}
