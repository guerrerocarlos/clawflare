import { describe, expect, it } from "vitest";
import type { ClawflareEnv } from "../src/env";
import { dispatchGatewayMethod } from "../src/gateway/methods";
import { createGatewayConnectionState } from "../src/gateway/state";
import { handleGatewaySocketMessage, initializeGatewaySocket, type GatewayWebSocket } from "../src/gateway/ws";
import { requestFrame } from "../src/protocol/frames";

class FakeSocket implements GatewayWebSocket {
  readonly messages: string[] = [];
  attachment: unknown;

  send(message: string): void {
    this.messages.push(message);
  }

  close(): void {}

  serializeAttachment(attachment: unknown): void {
    this.attachment = attachment;
  }
}

const env = {
  CLAWFLARE_GATEWAY_TOKEN: "secret",
  CLAWFLARE_DEFAULT_ACCOUNT_ID: "acct",
  CLAWFLARE_DEFAULT_AGENT_ID: "agent",
  CLAWFLARE_ENV: "test",
} as ClawflareEnv;

describe("gateway websocket handling", () => {
  it("sends connect.challenge when a socket is initialized", () => {
    const socket = new FakeSocket();
    const state = createGatewayConnectionState({
      now: new Date("2026-05-06T12:00:00.000Z"),
      connId: "conn-1",
      nonce: "nonce-1",
    });

    initializeGatewaySocket(socket, state);

    expect(socket.messages).toHaveLength(1);
    expect(JSON.parse(socket.messages[0] ?? "")).toMatchObject({
      type: "event",
      event: "connect.challenge",
      seq: 1,
      payload: {
        nonce: "nonce-1",
        issuedAt: "2026-05-06T12:00:00.000Z",
      },
    });
    expect(socket.attachment).toMatchObject({
      connId: "conn-1",
      nonce: "nonce-1",
      seq: 1,
    });
  });

  it("handles connect over websocket and emits presence plus tick events", async () => {
    const socket = new FakeSocket();
    const state = createGatewayConnectionState({ connId: "conn-1", nonce: "nonce-1" });

    await handleGatewaySocketMessage(socket, state, env, JSON.stringify(requestFrame("req-1", "connect", { token: "secret" })));

    expect(socket.messages).toHaveLength(3);
    expect(JSON.parse(socket.messages[0] ?? "")).toMatchObject({
      type: "res",
      id: "req-1",
      ok: true,
      payload: {
        type: "hello-ok",
        server: {
          connId: "conn-1",
        },
      },
    });
    expect(JSON.parse(socket.messages[1] ?? "")).toMatchObject({
      type: "event",
      event: "presence",
      seq: 1,
    });
    expect(JSON.parse(socket.messages[2] ?? "")).toMatchObject({
      type: "event",
      event: "tick",
      seq: 2,
    });
  });
});

describe("gateway method dispatcher", () => {
  it("connects with the shared token", async () => {
    const state = createGatewayConnectionState({ connId: "conn-1" });
    const response = await dispatchGatewayMethod(requestFrame("1", "connect", { token: "secret" }), {
      env,
      connection: state,
    });

    expect(response).toMatchObject({
      type: "res",
      id: "1",
      ok: true,
      payload: {
        type: "hello-ok",
        server: {
          connId: "conn-1",
        },
      },
    });
    expect(state.authenticated).toBe(true);
  });

  it("rejects invalid shared tokens", async () => {
    const state = createGatewayConnectionState({ connId: "conn-1" });
    const response = await dispatchGatewayMethod(requestFrame("1", "connect", { token: "wrong" }), {
      env,
      connection: state,
    });

    expect(response).toMatchObject({
      type: "res",
      id: "1",
      ok: false,
      error: {
        code: "UNAUTHORIZED",
      },
    });
    expect(state.authenticated).toBe(false);
  });

  it("returns health for authenticated connections", async () => {
    const state = createGatewayConnectionState({ connId: "conn-1" });
    await dispatchGatewayMethod(requestFrame("1", "connect", { token: "secret" }), {
      env,
      connection: state,
    });

    const response = await dispatchGatewayMethod(requestFrame("2", "health"), {
      env,
      connection: state,
    });

    expect(response).toMatchObject({
      type: "res",
      id: "2",
      ok: true,
      payload: {
        type: "health",
        ok: true,
        connection: {
          connId: "conn-1",
          authenticated: true,
        },
      },
    });
  });

  it("returns structured errors for unknown methods", async () => {
    const state = createGatewayConnectionState({ connId: "conn-1" });
    await dispatchGatewayMethod(requestFrame("1", "connect", { token: "secret" }), {
      env,
      connection: state,
    });

    const response = await dispatchGatewayMethod(requestFrame("2", "unknown.method"), {
      env,
      connection: state,
    });

    expect(response).toMatchObject({
      type: "res",
      id: "2",
      ok: false,
      error: {
        code: "NOT_IMPLEMENTED",
      },
    });
  });
});
