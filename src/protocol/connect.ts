import type { ClawflareEnv } from "../env";
import { getRuntimeDefaults } from "../env";
import { eventFrame, type GatewayEvent } from "./frames";

export const protocolVersion = 3;
export const serverVersion = "0.0.0";
export const challengeTtlMs = 5 * 60 * 1000;
export const tickIntervalMs = 30_000;
export const maxPayloadBytes = 1024 * 1024;
export const maxBufferedBytes = 4 * 1024 * 1024;

export const supportedMethods = [
  "connect",
  "health",
  "agent",
  "agent.wait",
  "chat.send",
  "sessions.list",
  "sessions.preview",
  "models.list",
  "models.authStatus",
  "tools.catalog",
  "plugins.search",
  "plugins.inspect",
  "plugins.planInstall",
  "plugins.install",
  "plugins.enable",
] as const;

export const supportedEvents = ["connect.challenge", "presence", "tick", "agent", "chat", "health", "plugin"] as const;

export interface ConnectChallengePayload {
  type: "connect.challenge";
  protocol: typeof protocolVersion;
  nonce: string;
  server: {
    version: string;
  };
  issuedAt: string;
  expiresAt: string;
}

export interface ConnectParams {
  token?: string;
  device?: {
    id?: string;
    name?: string;
    kind?: string;
  };
}

export interface HelloOkPayload {
  type: "hello-ok";
  protocol: typeof protocolVersion;
  server: {
    version: string;
    connId: string;
  };
  features: {
    methods: readonly string[];
    events: readonly string[];
  };
  snapshot: {
    presence: {
      accountId: string;
      agentId: string;
      environment: string;
      online: boolean;
    };
    health: {
      ok: boolean;
      runtime: "cloudflare-workers";
    };
  };
  auth: {
    role: "operator";
    scopes: readonly string[];
  };
  policy: {
    maxPayload: number;
    maxBufferedBytes: number;
    tickIntervalMs: number;
  };
}

export function createConnectChallenge(now = new Date(), nonce: string = crypto.randomUUID()): ConnectChallengePayload {
  return {
    type: "connect.challenge",
    protocol: protocolVersion,
    nonce,
    server: {
      version: serverVersion,
    },
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + challengeTtlMs).toISOString(),
  };
}

export function createConnectChallengeEvent(options?: { now?: Date; nonce?: string; seq?: number }): GatewayEvent {
  return eventFrame(
    "connect.challenge",
    createConnectChallenge(options?.now, options?.nonce),
    options?.seq === undefined ? undefined : { seq: options.seq },
  );
}

export function createHelloOk(env: ClawflareEnv, connId: string = crypto.randomUUID()): HelloOkPayload {
  const defaults = getRuntimeDefaults(env);

  return {
    type: "hello-ok",
    protocol: protocolVersion,
    server: {
      version: serverVersion,
      connId,
    },
    features: {
      methods: supportedMethods,
      events: supportedEvents,
    },
    snapshot: {
      presence: {
        ...defaults,
        online: true,
      },
      health: {
        ok: true,
        runtime: "cloudflare-workers",
      },
    },
    auth: {
      role: "operator",
      scopes: ["read", "write", "admin"],
    },
    policy: {
      maxPayload: maxPayloadBytes,
      maxBufferedBytes,
      tickIntervalMs,
    },
  };
}
