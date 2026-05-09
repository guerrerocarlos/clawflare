import { PolicyError } from "../security/policy";
import { ToolError } from "../tools/runtime";

export const gatewayErrorCodes = [
  "UNAUTHORIZED",
  "BAD_REQUEST",
  "NOT_FOUND",
  "METHOD_NOT_ALLOWED",
  "NOT_IMPLEMENTED",
  "CONFLICT",
  "INTERNAL",
] as const;

export type GatewayErrorCode = (typeof gatewayErrorCodes)[number];

export interface GatewayError {
  code: GatewayErrorCode;
  message: string;
  details?: unknown;
  retryable?: boolean;
}

interface GatewayErrorInput {
  code: GatewayErrorCode;
  message: string;
  details?: unknown | undefined;
  retryable?: boolean | undefined;
}

export class ClawflareError extends Error {
  readonly gatewayError: GatewayError;
  readonly status: number;

  constructor(gatewayError: GatewayError, status = statusForErrorCode(gatewayError.code)) {
    super(gatewayError.message);
    this.name = "ClawflareError";
    this.gatewayError = gatewayError;
    this.status = status;
  }
}

export function createGatewayError(input: GatewayErrorInput): GatewayError {
  return {
    code: input.code,
    message: input.message,
    ...(input.details === undefined ? {} : { details: input.details }),
    ...(input.retryable === undefined ? {} : { retryable: input.retryable }),
  };
}

export function unauthorized(message = "Unauthorized", details?: unknown): ClawflareError {
  return new ClawflareError(createGatewayError({ code: "UNAUTHORIZED", message, details }), 401);
}

export function badRequest(message = "Bad request", details?: unknown): ClawflareError {
  return new ClawflareError(createGatewayError({ code: "BAD_REQUEST", message, details }), 400);
}

export function notFound(message = "Not found", details?: unknown): ClawflareError {
  return new ClawflareError(createGatewayError({ code: "NOT_FOUND", message, details }), 404);
}

export function methodNotAllowed(method: string, path: string): ClawflareError {
  return new ClawflareError(
    createGatewayError({
      code: "METHOD_NOT_ALLOWED",
      message: `Method ${method} is not allowed for ${path}.`,
      details: { method, path },
    }),
    405,
  );
}

export function notImplemented(route: string): ClawflareError {
  return new ClawflareError(
    createGatewayError({
      code: "NOT_IMPLEMENTED",
      message: "Route is reserved for the OpenClaw-compatible MVP surface but is not implemented yet.",
      details: { route },
    }),
    501,
  );
}

export function conflict(message = "Conflict", details?: unknown): ClawflareError {
  return new ClawflareError(createGatewayError({ code: "CONFLICT", message, details }), 409);
}

export function internal(message = "Internal error", details?: unknown): ClawflareError {
  return new ClawflareError(createGatewayError({ code: "INTERNAL", message, details, retryable: true }), 500);
}

export function statusForErrorCode(code: GatewayErrorCode): number {
  switch (code) {
    case "UNAUTHORIZED":
      return 401;
    case "BAD_REQUEST":
      return 400;
    case "NOT_FOUND":
      return 404;
    case "METHOD_NOT_ALLOWED":
      return 405;
    case "NOT_IMPLEMENTED":
      return 501;
    case "CONFLICT":
      return 409;
    case "INTERNAL":
      return 500;
  }
}

export function toClawflareError(error: unknown): ClawflareError {
  if (error instanceof ClawflareError) {
    return error;
  }

  if (error instanceof PolicyError) {
    return badRequest(error.message, { code: error.code });
  }

  if (error instanceof ToolError) {
    return badRequest(error.message, { code: error.code, details: error.details });
  }

  if (error instanceof Error) {
    return internal(error.message);
  }

  return internal("Unknown internal error");
}
