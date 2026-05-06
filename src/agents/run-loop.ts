import type { ClawflareEnv, QueuePayload } from "../env";
import { getRuntimeDefaults } from "../env";
import { FakeProviderRuntime } from "../providers/fake";
import { normalizeSessionRef } from "../sessions/keys";
import { SessionLanes } from "../sessions/lanes";
import type { AgentRuntimeStore } from "../sessions/store";
import { runEventsKey, transcriptKey } from "../storage/keys";
import { buildPrompt } from "./prompt";
import type {
  AgentEventSink,
  AgentRunAccepted,
  AgentRunInput,
  AgentRunOptions,
  AgentRunSummary,
  AgentRuntime,
  AgentStreamEvent,
  AgentWaitInput,
  AgentWaitResult,
  AbortRunInput,
  AbortRunResult,
  ListSessionsInput,
  ListSessionsResult,
} from "./runtime";

interface QueueLike {
  send(message: QueuePayload): Promise<unknown>;
}

interface AgentR2Storage {
  putTranscript(key: string, body: string | ReadableStream): Promise<unknown>;
  putRunEvents(key: string, body: string | ReadableStream): Promise<unknown>;
}

export interface DurableAgentRuntimeOptions {
  env: ClawflareEnv;
  store: AgentRuntimeStore;
  r2: AgentR2Storage;
  lanes?: SessionLanes;
  provider?: FakeProviderRuntime;
  transcriptIndexingQueue?: QueueLike;
  auditQueue?: QueueLike;
  now?: () => Date;
  runId?: () => string;
}

interface RunCompletion {
  promise: Promise<AgentWaitResult>;
}

export class DurableAgentRuntime implements AgentRuntime {
  private readonly lanes: SessionLanes;
  private readonly provider: FakeProviderRuntime;
  private readonly completions = new Map<string, RunCompletion>();
  private readonly now: () => Date;
  private readonly runId: () => string;

  constructor(private readonly options: DurableAgentRuntimeOptions) {
    this.lanes = options.lanes ?? new SessionLanes();
    this.provider = options.provider ?? new FakeProviderRuntime();
    this.now = options.now ?? (() => new Date());
    this.runId = options.runId ?? (() => crypto.randomUUID());
  }

  async startRun(input: AgentRunInput, options?: AgentRunOptions): Promise<AgentRunAccepted> {
    const defaults = getRuntimeDefaults(this.options.env);
    const session = normalizeSessionRef(input, defaults);
    const runId = this.runId();
    const acceptedAt = this.now().toISOString();
    const transcriptR2Key = transcriptKey({ ...session });

    await this.options.store.upsertSession({
      session_key: session.sessionKey,
      session_id: session.sessionId,
      account_id: session.accountId,
      agent_id: session.agentId,
      title: input.messages.find((message) => message.role === "user")?.content.slice(0, 80) ?? null,
      status: "active",
      last_run_id: runId,
      transcript_r2_key: transcriptR2Key,
      session_started_at: acceptedAt,
      last_interaction_at: acceptedAt,
      updated_at: acceptedAt,
    });

    await this.options.store.insertRun({
      run_id: runId,
      session_key: session.sessionKey,
      session_id: session.sessionId,
      status: "accepted",
      idempotency_key: input.idempotencyKey ?? null,
      input_json: JSON.stringify(input),
      summary_json: null,
      error_json: null,
      accepted_at: acceptedAt,
      started_at: null,
      ended_at: null,
    });

    const accepted: AgentRunAccepted = {
      type: "agent.accepted",
      runId,
      sessionKey: session.sessionKey,
      sessionId: session.sessionId,
      status: "accepted",
      acceptedAt,
    };

    const promise = Promise.resolve().then(() =>
      this.lanes.runExclusive(session.sessionKey, () => this.processRun(input, accepted, options?.sink)),
    );
    this.completions.set(runId, { promise });

    return accepted;
  }

  async waitForRun(input: AgentWaitInput): Promise<AgentWaitResult> {
    const completion = this.completions.get(input.runId);

    if (!completion) {
      const run = await this.options.store.getRun(input.runId);

      if (!run) {
        return { type: "agent.wait", runId: input.runId, status: "failed", error: { code: "NOT_FOUND" } };
      }

      if (run.status === "completed") {
        const result: AgentWaitResult = {
          type: "agent.wait",
          runId: input.runId,
          status: "completed",
        };

        if (run.summary_json !== null) {
          result.summary = JSON.parse(run.summary_json) as AgentRunSummary;
        }

        return result;
      }

      return { type: "agent.wait", runId: input.runId, status: run.status as AgentWaitResult["status"] };
    }

    if (input.timeoutMs === undefined) {
      return await completion.promise;
    }

    return await Promise.race([
      completion.promise,
      new Promise<AgentWaitResult>((resolve) => {
        setTimeout(() => resolve({ type: "agent.wait", runId: input.runId, status: "timeout" }), input.timeoutMs);
      }),
    ]);
  }

  async listSessions(input: ListSessionsInput): Promise<ListSessionsResult> {
    const defaults = getRuntimeDefaults(this.options.env);
    const accountId = input.accountId ?? defaults.accountId;
    const agentId = input.agentId ?? defaults.agentId;
    const sessions = await this.options.store.listSessions(accountId, agentId);

    return {
      sessions: sessions.map((session) => ({
        sessionKey: session.session_key,
        sessionId: session.session_id,
        title: session.title,
        status: session.status,
        lastRunId: session.last_run_id,
        updatedAt: session.updated_at,
      })),
    };
  }

  async abortRun(input: AbortRunInput): Promise<AbortRunResult> {
    return {
      runId: input.runId,
      aborted: false,
    };
  }

  private async processRun(
    input: AgentRunInput,
    accepted: AgentRunAccepted,
    sink?: AgentEventSink,
  ): Promise<AgentWaitResult> {
    let seq = 0;
    const defaults = getRuntimeDefaults(this.options.env);
    const session = normalizeSessionRef(input, defaults);

    const emit = async (phase: AgentStreamEvent["phase"], payload: unknown): Promise<void> => {
      seq += 1;
      const event: AgentStreamEvent = {
        runId: accepted.runId,
        sessionKey: accepted.sessionKey,
        seq,
        phase,
        payload,
        createdAt: this.now().toISOString(),
      };

      await this.options.store.appendRunEvent({
        run_id: accepted.runId,
        seq,
        stream: "agent",
        event_json: JSON.stringify(event),
        created_at: event.createdAt,
      });
      await sink?.(event);
    };

    try {
      const startedAt = this.now().toISOString();
      await this.options.store.updateRunStatus(accepted.runId, { status: "running", started_at: startedAt });
      await emit("started", { status: "running", startedAt });

      const prompt = buildPrompt(input, {
        accountId: session.accountId,
        agentId: session.agentId,
        sessionKey: session.sessionKey,
      });
      const providerOutput = await this.provider.complete({ prompt, messages: input.messages });
      await emit("assistant", { text: providerOutput.text, usage: providerOutput.usage });

      const endedAt = this.now().toISOString();
      const summary: AgentRunSummary = {
        outputText: providerOutput.text,
        transcriptR2Key: transcriptKey({ ...session }),
        usage: providerOutput.usage,
      };
      await this.options.store.updateRunStatus(accepted.runId, {
        status: "completed",
        summary_json: JSON.stringify(summary),
        ended_at: endedAt,
      });
      await emit("completed", { status: "completed", endedAt, summary });
      await this.persistRunArtifacts(input, accepted.runId, session, summary);

      return {
        type: "agent.wait",
        runId: accepted.runId,
        status: "completed",
        summary,
      };
    } catch (error) {
      const endedAt = this.now().toISOString();
      await this.options.store.updateRunStatus(accepted.runId, {
        status: "failed",
        error_json: JSON.stringify(error instanceof Error ? { message: error.message } : error),
        ended_at: endedAt,
      });
      await emit("failed", { status: "failed", endedAt });

      return {
        type: "agent.wait",
        runId: accepted.runId,
        status: "failed",
        error,
      };
    }
  }

  private async persistRunArtifacts(
    input: AgentRunInput,
    runId: string,
    session: { accountId: string; agentId: string; sessionId: string; sessionKey: string },
    summary: AgentRunSummary,
  ): Promise<void> {
    const transcriptR2Key = transcriptKey(session);
    const eventsR2Key = runEventsKey({ accountId: session.accountId, agentId: session.agentId, runId });
    const runEvents = await this.options.store.listRunEvents(runId);
    const transcript = [
      ...input.messages.map((message) => JSON.stringify({ type: "message", ...message })),
      JSON.stringify({ type: "message", role: "assistant", content: summary.outputText }),
      "",
    ].join("\n");

    await this.options.r2.putTranscript(transcriptR2Key, transcript);
    await this.options.r2.putRunEvents(eventsR2Key, runEvents.map((event) => event.event_json).join("\n") + "\n");

    await this.options.transcriptIndexingQueue?.send({
      version: 1,
      type: "transcript.index",
      id: crypto.randomUUID(),
      accountId: session.accountId,
      agentId: session.agentId,
      sessionKey: session.sessionKey,
      idempotencyKey: `transcript:${runId}`,
      attempt: 0,
      createdAt: this.now().toISOString(),
      payload: {
        transcriptR2Key,
        runEventsR2Key: eventsR2Key,
      },
    });

    await this.options.auditQueue?.send({
      version: 1,
      type: "audit.persist",
      id: crypto.randomUUID(),
      accountId: session.accountId,
      agentId: session.agentId,
      sessionKey: session.sessionKey,
      idempotencyKey: `audit:${runId}`,
      attempt: 0,
      createdAt: this.now().toISOString(),
      payload: {
        action: "agent.run.completed",
        runId,
      },
    });
  }
}
