import type { ClawflareEnv, QueuePayload } from "../env";
import { getRuntimeDefaults } from "../env";
import { FakeProviderRuntime } from "../providers/fake";
import { normalizeProviderError, ProviderError } from "../providers/errors";
import type { ProviderRuntime } from "../providers/runtime";
import { normalizeSessionRef } from "../sessions/keys";
import { SessionLanes } from "../sessions/lanes";
import type { AgentRuntimeStore } from "../sessions/store";
import { runEventsKey, transcriptKey } from "../storage/keys";
import type { ClawHubSkill } from "../plugins/types";
import { createProviderFetch } from "../providers/fetcher";
import type { ToolPolicyContext } from "../security/policy";
import type { ToolRegistry } from "../tools/registry";
import type { ToolInvokeContext } from "../tools/runtime";
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
  provider?: ProviderRuntime;
  transcriptIndexingQueue?: QueueLike;
  auditQueue?: QueueLike;
  enabledSkills?: () => Promise<ClawHubSkill[]>;
  toolRegistry?: ToolRegistry;
  createToolContext?: (session: { accountId: string; agentId: string; sessionId: string; sessionKey: string }, input: AgentRunInput) => ToolInvokeContext;
  modelToolPolicy?: ToolPolicyContext;
  maxToolSteps?: number;
  now?: () => Date;
  runId?: () => string;
}

interface RunCompletion {
  promise: Promise<AgentWaitResult>;
}

interface ParsedToolCall {
  name: string;
  input: unknown;
}

const toolCallStart = "<clawflare_tool_call>";
const toolCallEnd = "</clawflare_tool_call>";

function renderToolInstructions(catalog: Array<{ name: string; description: string; inputSchema: unknown }>): string {
  return [
    "You can use tools.",
    `If a tool is required, respond with exactly one ${toolCallStart}JSON${toolCallEnd} block and no extra text.`,
    'The JSON must look like {"name":"tool_name","input":{...}}.',
    "When you have enough information, respond with the final user-facing answer as plain text.",
    "Available tools:",
    JSON.stringify(catalog, null, 2),
  ].join("\n");
}

function parseToolCall(text: string): ParsedToolCall | null {
  const start = text.indexOf(toolCallStart);
  const end = text.indexOf(toolCallEnd);

  if (start === -1 || end === -1 || end <= start) {
    return null;
  }

  const jsonText = text.slice(start + toolCallStart.length, end).trim();

  if (jsonText.length === 0) {
    return null;
  }

  const value = JSON.parse(jsonText) as Record<string, unknown>;

  if (typeof value.name !== "string" || !("input" in value)) {
    throw new ProviderError("PROVIDER_RESPONSE", "Model returned an invalid tool call shape.", 502, false);
  }

  return {
    name: value.name,
    input: value.input,
  };
}

export class DurableAgentRuntime implements AgentRuntime {
  private readonly lanes: SessionLanes;
  private readonly provider: ProviderRuntime;
  private readonly maxToolSteps: number;
  private readonly completions = new Map<string, RunCompletion>();
  private readonly now: () => Date;
  private readonly runId: () => string;

  constructor(private readonly options: DurableAgentRuntimeOptions) {
    this.lanes = options.lanes ?? new SessionLanes();
    this.provider = options.provider ?? new FakeProviderRuntime();
    this.maxToolSteps = options.maxToolSteps ?? 3;
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
      }, { skills: (await this.options.enabledSkills?.()) ?? [] });
      const providerFetch = createProviderFetch();
      const toolTrace: NonNullable<AgentRunSummary["toolTrace"]> = [];
      const providerOutput = await this.completeWithTools(input, session, prompt, providerFetch, emit, toolTrace);
      await emit("assistant", { text: providerOutput.text, usage: providerOutput.usage });

      const endedAt = this.now().toISOString();
      const summary: AgentRunSummary = {
        outputText: providerOutput.text,
        transcriptR2Key: transcriptKey({ ...session }),
      };

      if (providerOutput.usage !== undefined) {
        summary.usage = providerOutput.usage;
      }
      if (toolTrace.length > 0) {
        summary.toolTrace = toolTrace;
      }
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
      const normalizedError = normalizeProviderError(error);
      const endedAt = this.now().toISOString();
      await this.options.store.updateRunStatus(accepted.runId, {
        status: "failed",
        error_json: JSON.stringify(normalizedError),
        ended_at: endedAt,
      });
      console.error("agent.run.failed", {
        runId: accepted.runId,
        sessionKey: accepted.sessionKey,
        error: normalizedError,
      });
      await emit("failed", { status: "failed", endedAt, error: normalizedError });

      return {
        type: "agent.wait",
        runId: accepted.runId,
        status: "failed",
        error: normalizedError,
      };
    }
  }

  private async completeWithTools(
    input: AgentRunInput,
    session: { accountId: string; agentId: string; sessionId: string; sessionKey: string },
    prompt: string,
    providerFetch: typeof fetch,
    emit: (phase: AgentStreamEvent["phase"], payload: unknown) => Promise<void>,
    toolTrace: NonNullable<AgentRunSummary["toolTrace"]>,
  ): Promise<Awaited<ReturnType<ProviderRuntime["complete"]>>> {
    const registry = this.options.toolRegistry;
    const toolContextFactory = this.options.createToolContext;
    const model = input.model ?? this.options.env.CLAWFLARE_DEFAULT_MODEL ?? "deterministic";

    if (!registry || !toolContextFactory) {
      return await this.provider.complete({ model, prompt, messages: input.messages }, { env: this.options.env, fetcher: providerFetch });
    }

    const toolContext = toolContextFactory(session, input);
    const allowedTools = registry
      .catalog()
      .filter((tool) => this.isToolAllowed(tool.name, toolContext.policy))
      .map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      }));

    if (allowedTools.length === 0) {
      return await this.provider.complete({ model, prompt, messages: input.messages }, { env: this.options.env, fetcher: providerFetch });
    }

    const systemContent = `${prompt}\n\n<clawflare-tools>\n${renderToolInstructions(allowedTools)}\n</clawflare-tools>`;
    const conversation = [{ role: "system" as const, content: systemContent }, ...input.messages];
    let providerOutput = await this.provider.complete(
      { model, prompt: systemContent, messages: conversation },
      { env: this.options.env, fetcher: providerFetch },
    );

    for (let step = 0; step < this.maxToolSteps; step += 1) {
      const toolCall = parseToolCall(providerOutput.text);

      if (!toolCall) {
        return providerOutput;
      }

      const traceEntry: NonNullable<AgentRunSummary["toolTrace"]>[number] = {
        tool: toolCall.name,
        input: toolCall.input,
      };
      await emit("tool", { step: step + 1, tool: toolCall.name, input: toolCall.input });

      try {
        const result = await registry.invoke(toolCall.name, toolCall.input, toolContext);
        traceEntry.result = result;
        toolTrace.push(traceEntry);
        conversation.push({ role: "assistant", content: providerOutput.text });
        conversation.push({ role: "tool", content: JSON.stringify({ tool: toolCall.name, ok: true, result }) });
        await emit("tool", { step: step + 1, tool: toolCall.name, result });
      } catch (error) {
        const normalizedError = normalizeProviderError(error);
        traceEntry.error = normalizedError;
        toolTrace.push(traceEntry);
        conversation.push({ role: "assistant", content: providerOutput.text });
        conversation.push({ role: "tool", content: JSON.stringify({ tool: toolCall.name, ok: false, error: normalizedError }) });
        await emit("tool", { step: step + 1, tool: toolCall.name, error: normalizedError });
      }

      providerOutput = await this.provider.complete(
        { model, prompt: systemContent, messages: conversation },
        { env: this.options.env, fetcher: providerFetch },
      );
    }

    throw new ProviderError("PROVIDER_RESPONSE", `Model exceeded the tool step limit of ${this.maxToolSteps}.`, 502, false);
  }

  private isToolAllowed(name: string, policy: ToolPolicyContext): boolean {
    if (policy.allowedTools !== undefined) {
      return policy.allowedTools.includes(name);
    }

    return true;
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
