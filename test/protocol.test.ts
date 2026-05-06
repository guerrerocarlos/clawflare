import { describe, expect, it } from "vitest";
import { createConnectChallenge, createConnectChallengeEvent, createHelloOk } from "../src/protocol/connect";
import { badRequest } from "../src/protocol/errors";
import {
  errorResponseFrame,
  eventFrame,
  isGatewayRequest,
  parseGatewayFrame,
  requestFrame,
  responseFrame,
} from "../src/protocol/frames";
import type { ClawflareEnv } from "../src/env";

describe("gateway protocol frames", () => {
  it("builds and validates request, response, and event frames", () => {
    const request = requestFrame("1", "health");
    const response = responseFrame("1", { ok: true });
    const event = eventFrame("tick", { at: "2026-05-06T00:00:00.000Z" }, { seq: 1 });

    expect(isGatewayRequest(request)).toBe(true);
    expect(parseGatewayFrame(response)).toEqual(response);
    expect(parseGatewayFrame(event)).toEqual(event);
  });

  it("builds typed error response frames", () => {
    const error = badRequest("Invalid test payload").gatewayError;
    const frame = errorResponseFrame("2", error);

    expect(frame).toMatchObject({
      type: "res",
      id: "2",
      ok: false,
      error: {
        code: "BAD_REQUEST",
      },
    });
  });

  it("rejects invalid frames", () => {
    expect(() => parseGatewayFrame({ type: "req", id: "", method: "" })).toThrow("Invalid gateway frame");
  });
});

describe("connect protocol helpers", () => {
  it("creates deterministic challenge payloads when nonce and time are provided", () => {
    const now = new Date("2026-05-06T12:00:00.000Z");
    const challenge = createConnectChallenge(now, "nonce-1");
    const event = createConnectChallengeEvent({ now, nonce: "nonce-1", seq: 7 });

    expect(challenge).toMatchObject({
      type: "connect.challenge",
      protocol: 3,
      nonce: "nonce-1",
      issuedAt: "2026-05-06T12:00:00.000Z",
      expiresAt: "2026-05-06T12:05:00.000Z",
    });
    expect(event).toMatchObject({
      type: "event",
      event: "connect.challenge",
      seq: 7,
      payload: challenge,
    });
  });

  it("creates MVP hello-ok payloads", () => {
    const hello = createHelloOk(
      {
        CLAWFLARE_DEFAULT_ACCOUNT_ID: "acct",
        CLAWFLARE_DEFAULT_AGENT_ID: "agent",
        CLAWFLARE_ENV: "test",
      } as ClawflareEnv,
      "conn-1",
    );

    expect(hello).toMatchObject({
      type: "hello-ok",
      protocol: 3,
      server: {
        connId: "conn-1",
      },
      snapshot: {
        presence: {
          accountId: "acct",
          agentId: "agent",
          environment: "test",
          online: true,
        },
      },
      auth: {
        role: "operator",
      },
    });
    expect(hello.features.methods).toContain("connect");
    expect(hello.features.events).toContain("connect.challenge");
  });
});
