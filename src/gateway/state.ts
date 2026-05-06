import { challengeTtlMs } from "../protocol/connect";

export interface GatewayConnectionState {
  connId: string;
  nonce: string;
  authenticated: boolean;
  seq: number;
  issuedAt: string;
  expiresAt: string;
  lastSeenAt: string;
  scopes: readonly string[];
}

export interface GatewayConnectionStateOptions {
  now?: Date;
  connId?: string;
  nonce?: string;
}

export function createGatewayConnectionState(options?: GatewayConnectionStateOptions): GatewayConnectionState {
  const now = options?.now ?? new Date();

  return {
    connId: options?.connId ?? crypto.randomUUID(),
    nonce: options?.nonce ?? crypto.randomUUID(),
    authenticated: false,
    seq: 0,
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + challengeTtlMs).toISOString(),
    lastSeenAt: now.toISOString(),
    scopes: [],
  };
}

export function nextSequence(state: GatewayConnectionState): number {
  state.seq += 1;
  state.lastSeenAt = new Date().toISOString();
  return state.seq;
}

export function markAuthenticated(state: GatewayConnectionState, scopes: readonly string[]): void {
  state.authenticated = true;
  state.scopes = scopes;
  state.lastSeenAt = new Date().toISOString();
}
