import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { badRequest, gatewayErrorCodes, type GatewayError } from "./errors";

const GatewayErrorCodeSchema = Type.Union(gatewayErrorCodes.map((code) => Type.Literal(code)));

export const GatewayErrorSchema = Type.Object({
  code: GatewayErrorCodeSchema,
  message: Type.String(),
  details: Type.Optional(Type.Unknown()),
  retryable: Type.Optional(Type.Boolean()),
});

export const GatewayRequestSchema = Type.Object({
  type: Type.Literal("req"),
  id: Type.String({ minLength: 1 }),
  method: Type.String({ minLength: 1 }),
  params: Type.Optional(Type.Unknown()),
});

export const GatewaySuccessResponseSchema = Type.Object({
  type: Type.Literal("res"),
  id: Type.String({ minLength: 1 }),
  ok: Type.Literal(true),
  payload: Type.Unknown(),
});

export const GatewayErrorResponseSchema = Type.Object({
  type: Type.Literal("res"),
  id: Type.String({ minLength: 1 }),
  ok: Type.Literal(false),
  error: GatewayErrorSchema,
});

export const GatewayEventSchema = Type.Object({
  type: Type.Literal("event"),
  event: Type.String({ minLength: 1 }),
  payload: Type.Unknown(),
  seq: Type.Optional(Type.Number({ minimum: 0 })),
  stateVersion: Type.Optional(Type.Number({ minimum: 0 })),
});

export const GatewayFrameSchema = Type.Union([
  GatewayRequestSchema,
  GatewaySuccessResponseSchema,
  GatewayErrorResponseSchema,
  GatewayEventSchema,
]);

export type GatewayRequest = Static<typeof GatewayRequestSchema>;
export type GatewaySuccessResponse = Static<typeof GatewaySuccessResponseSchema>;
export type GatewayErrorResponse = Static<typeof GatewayErrorResponseSchema>;
export type GatewayResponse = GatewaySuccessResponse | GatewayErrorResponse;
export type GatewayEvent = Static<typeof GatewayEventSchema>;
export type GatewayFrame = Static<typeof GatewayFrameSchema>;

export function isGatewayRequest(value: unknown): value is GatewayRequest {
  return Value.Check(GatewayRequestSchema, value);
}

export function isGatewayFrame(value: unknown): value is GatewayFrame {
  return Value.Check(GatewayFrameSchema, value);
}

export function parseGatewayFrame(value: unknown): GatewayFrame {
  if (!isGatewayFrame(value)) {
    throw badRequest("Invalid gateway frame");
  }

  return value;
}

export function requestFrame(id: string, method: string, params?: unknown): GatewayRequest {
  return {
    type: "req",
    id,
    method,
    ...(params === undefined ? {} : { params }),
  };
}

export function responseFrame(id: string, payload: unknown): GatewaySuccessResponse {
  return {
    type: "res",
    id,
    ok: true,
    payload,
  };
}

export function errorResponseFrame(id: string, error: GatewayError): GatewayErrorResponse {
  return {
    type: "res",
    id,
    ok: false,
    error,
  };
}

export function eventFrame(
  event: string,
  payload: unknown,
  options?: { seq?: number; stateVersion?: number },
): GatewayEvent {
  return {
    type: "event",
    event,
    payload,
    ...(options?.seq === undefined ? {} : { seq: options.seq }),
    ...(options?.stateVersion === undefined ? {} : { stateVersion: options.stateVersion }),
  };
}
