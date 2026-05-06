import type { ClawflareEnv } from "../env";
import type { AgentRuntime } from "../agents/runtime";
import { createConnectChallenge } from "../protocol/connect";
import { badRequest, toClawflareError } from "../protocol/errors";
import {
  errorResponseFrame,
  eventFrame,
  isGatewayRequest,
  parseGatewayFrame,
  type GatewayEvent,
} from "../protocol/frames";
import { dispatchGatewayMethod } from "./methods";
import type { GatewayMethodContext } from "./methods";
import { createGatewayConnectionState, nextSequence, type GatewayConnectionState } from "./state";

export interface GatewayWebSocket {
  send(message: string): void;
  close(code?: number, reason?: string): void;
  serializeAttachment?(attachment: unknown): void;
}

export interface GatewaySocketAttachment {
  connId: string;
  nonce: string;
  authenticated: boolean;
  seq: number;
  issuedAt: string;
  expiresAt: string;
  lastSeenAt: string;
  scopes: readonly string[];
}

export interface GatewaySocketMessageOptions {
  agentRuntime?: AgentRuntime;
}

function serialize(state: GatewayConnectionState): GatewaySocketAttachment {
  return {
    connId: state.connId,
    nonce: state.nonce,
    authenticated: state.authenticated,
    seq: state.seq,
    issuedAt: state.issuedAt,
    expiresAt: state.expiresAt,
    lastSeenAt: state.lastSeenAt,
    scopes: state.scopes,
  };
}

export function restoreConnectionState(attachment: GatewaySocketAttachment | undefined): GatewayConnectionState {
  if (!attachment) {
    return createGatewayConnectionState();
  }

  return {
    connId: attachment.connId,
    nonce: attachment.nonce,
    authenticated: attachment.authenticated,
    seq: attachment.seq,
    issuedAt: attachment.issuedAt,
    expiresAt: attachment.expiresAt,
    lastSeenAt: attachment.lastSeenAt,
    scopes: attachment.scopes,
  };
}

export function persistConnectionState(socket: GatewayWebSocket, state: GatewayConnectionState): void {
  socket.serializeAttachment?.(serialize(state));
}

export function sendGatewayEvent(socket: GatewayWebSocket, state: GatewayConnectionState, event: GatewayEvent): void {
  socket.send(
    JSON.stringify({
      ...event,
      seq: event.seq ?? nextSequence(state),
    }),
  );
  persistConnectionState(socket, state);
}

export function sendTick(socket: GatewayWebSocket, state: GatewayConnectionState): void {
  sendGatewayEvent(
    socket,
    state,
    eventFrame("tick", {
      at: new Date().toISOString(),
      connId: state.connId,
      authenticated: state.authenticated,
    }),
  );
}

export function initializeGatewaySocket(socket: GatewayWebSocket, state = createGatewayConnectionState()): GatewayConnectionState {
  const issuedAt = new Date(state.issuedAt);
  const challenge = createConnectChallenge(issuedAt, state.nonce);

  sendGatewayEvent(socket, state, eventFrame("connect.challenge", challenge));
  return state;
}

export async function handleGatewaySocketMessage(
  socket: GatewayWebSocket,
  state: GatewayConnectionState,
  env: ClawflareEnv,
  message: ArrayBuffer | string,
  options?: GatewaySocketMessageOptions,
): Promise<void> {
  try {
    if (typeof message !== "string") {
      throw badRequest("Gateway messages must be JSON text frames.");
    }

    const frame = parseGatewayFrame(JSON.parse(message) as unknown);

    if (!isGatewayRequest(frame)) {
      throw badRequest("Gateway WebSocket messages must be request frames.");
    }

    const methodContext: GatewayMethodContext = {
      env,
      connection: state,
      emitAgentEvent: (event) => {
        sendGatewayEvent(socket, state, eventFrame("agent", event));
      },
    };

    if (options?.agentRuntime !== undefined) {
      methodContext.agentRuntime = options.agentRuntime;
    }

    const response = await dispatchGatewayMethod(frame, methodContext);
    socket.send(JSON.stringify(response));
    persistConnectionState(socket, state);

    if (frame.method === "connect" && response.ok) {
      sendGatewayEvent(
        socket,
        state,
        eventFrame("presence", {
          connId: state.connId,
          online: true,
          authenticated: state.authenticated,
        }),
      );
      sendTick(socket, state);
    }
  } catch (error) {
    const normalized = toClawflareError(error);
    socket.send(JSON.stringify(errorResponseFrame("unknown", normalized.gatewayError)));
  }
}
