import type { ClawflareEnv } from "../env";
import { getRuntimeDefaults } from "../env";
import { DurableAgentRuntime } from "./run-loop";
import { jsonResponse } from "../shared/http";
import { DurableObjectSqliteStorage } from "../storage/do-sqlite";
import { createR2Storage } from "../storage/r2";
import { SqliteAgentRuntimeStore } from "../sessions/store";
import {
  handleGatewaySocketMessage,
  initializeGatewaySocket,
  restoreConnectionState,
  type GatewaySocketAttachment,
} from "../gateway/ws";
import { createGatewayConnectionState, type GatewayConnectionState } from "../gateway/state";

export class AgentObject {
  private readonly connections = new WeakMap<WebSocket, GatewayConnectionState>();
  private readonly agentRuntime: DurableAgentRuntime;

  constructor(
    private readonly state: DurableObjectState,
    private readonly env: ClawflareEnv,
  ) {
    const sqlite = new DurableObjectSqliteStorage(this.state.storage);
    sqlite.migrate();
    this.agentRuntime = new DurableAgentRuntime({
      env,
      store: new SqliteAgentRuntimeStore(sqlite),
      r2: createR2Storage(env),
      transcriptIndexingQueue: env.TRANSCRIPT_INDEXING_QUEUE,
      auditQueue: env.AUDIT_EVENTS_QUEUE,
    });

    for (const socket of this.state.getWebSockets()) {
      this.connections.set(socket, restoreConnectionState(socket.deserializeAttachment() as GatewaySocketAttachment | undefined));
    }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/ws" && request.headers.get("upgrade")?.toLowerCase() === "websocket") {
      const pair = new WebSocketPair();
      const client = pair[0];
      const server = pair[1];
      const connection = createGatewayConnectionState();

      this.state.acceptWebSocket(server);
      this.connections.set(server, connection);
      initializeGatewaySocket(server, connection);

      return new Response(null, {
        status: 101,
        webSocket: client,
      });
    }

    return jsonResponse(
      {
        ok: true,
        service: "clawflare-agent-object",
        durableObject: true,
        path: url.pathname,
        storage: {
          sqlite: typeof this.state.storage.sql === "object",
        },
        defaults: getRuntimeDefaults(this.env),
      },
      { status: 200 },
    );
  }

  async webSocketMessage(socket: WebSocket, message: ArrayBuffer | string): Promise<void> {
    const connection = this.getConnection(socket);
    await handleGatewaySocketMessage(socket, connection, this.env, message, { agentRuntime: this.agentRuntime });
  }

  webSocketClose(socket: WebSocket): void {
    this.connections.delete(socket);
  }

  webSocketError(socket: WebSocket): void {
    this.connections.delete(socket);
  }

  private getConnection(socket: WebSocket): GatewayConnectionState {
    const existing = this.connections.get(socket);

    if (existing) {
      return existing;
    }

    const restored = restoreConnectionState(socket.deserializeAttachment() as GatewaySocketAttachment | undefined);
    this.connections.set(socket, restored);
    return restored;
  }
}
