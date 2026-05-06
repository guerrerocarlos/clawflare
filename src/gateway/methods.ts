import type { ClawflareEnv } from "../env";
import { getRuntimeDefaults } from "../env";
import { createHelloOk, protocolVersion, supportedEvents, supportedMethods } from "../protocol/connect";
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

export async function executeGatewayMethod(request: GatewayRequest, context: GatewayMethodContext): Promise<unknown> {
  switch (request.method) {
    case "connect":
      return executeConnect(request, context);
    case "health":
      return executeHealth(context);
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
