import { describe, expect, it } from "vitest";
import type { ClawflareEnv, QueuePayload } from "../src/env";
import { buildPrompt } from "../src/agents/prompt";
import { DurableAgentRuntime } from "../src/agents/run-loop";
import type { AgentMessage } from "../src/agents/runtime";
import { ProviderError } from "../src/providers/errors";
import { FakeProviderRuntime, type FakeProviderOutput } from "../src/providers/fake";
import type { ProviderCompleteInput, ProviderCompleteOutput, ProviderRuntime } from "../src/providers/runtime";
import { SessionLanes } from "../src/sessions/lanes";
import { normalizeSessionRef } from "../src/sessions/keys";
import { MemoryAgentRuntimeStore } from "../src/sessions/store";
import { createDefaultToolRegistry } from "../src/tools/registry";
import type { ToolInvokeContext } from "../src/tools/runtime";
import { MemoryWorkspaceIndex, R2WorkspaceBackend } from "../src/tools/workspace";

class FakeR2RuntimeStorage {
  readonly objects = new Map<string, string>();

  async putTranscript(key: string, body: string | ReadableStream): Promise<unknown> {
    this.objects.set(key, typeof body === "string" ? body : "[stream]");
    return undefined;
  }

  async putRunEvents(key: string, body: string | ReadableStream): Promise<unknown> {
    this.objects.set(key, typeof body === "string" ? body : "[stream]");
    return undefined;
  }
}

class FakeQueue {
  readonly messages: QueuePayload[] = [];

  async send(message: QueuePayload): Promise<unknown> {
    this.messages.push(message);
    return undefined;
  }
}

class RecordingProvider extends FakeProviderRuntime {
  constructor(private readonly order: string[]) {
    super();
  }

  override async complete(input: ProviderCompleteInput): Promise<ProviderCompleteOutput & FakeProviderOutput> {
    const label = input.messages.at(-1)?.content ?? "none";
    this.order.push(`start:${label}`);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const output = await super.complete(input);
    this.order.push(`end:${label}`);
    return output;
  }
}

function createRuntime(overrides?: {
  provider?: ProviderRuntime;
  runIds?: string[];
  toolContext?: ToolInvokeContext;
}) {
  const store = new MemoryAgentRuntimeStore();
  const r2 = new FakeR2RuntimeStorage();
  const transcriptQueue = new FakeQueue();
  const auditQueue = new FakeQueue();
  const runIds = overrides?.runIds ?? ["run-1"];
  let runIndex = 0;

  const runtimeOptions = {
    env: {
      CLAWFLARE_DEFAULT_ACCOUNT_ID: "acct",
      CLAWFLARE_DEFAULT_AGENT_ID: "agent",
      CLAWFLARE_ENV: "test",
    } as ClawflareEnv,
    store,
    r2,
    transcriptIndexingQueue: transcriptQueue,
    auditQueue,
    now: () => new Date("2026-05-06T12:00:00.000Z"),
    runId: () => runIds[runIndex++] ?? crypto.randomUUID(),
  };

  const runtime = new DurableAgentRuntime({
    ...runtimeOptions,
    ...(overrides?.provider === undefined ? {} : { provider: overrides.provider }),
    ...(overrides?.toolContext === undefined
      ? {}
      : {
          toolRegistry: createDefaultToolRegistry(),
          createToolContext: () => overrides.toolContext as ToolInvokeContext,
        }),
  });

  return { runtime, store, r2, transcriptQueue, auditQueue };
}

describe("agent runtime", () => {
  it("normalizes session keys", () => {
    expect(
      normalizeSessionRef(
        {
          session: { channel: "telegram", peerId: "42", threadId: "99" },
          messages: [{ role: "user", content: "hello" }],
        },
        { accountId: "acct", agentId: "agent" },
      ),
    ).toMatchObject({
      accountId: "acct",
      agentId: "agent",
      sessionKey: "acct:agent:telegram:42:99",
      sessionId: "telegram:42:99",
    });
  });

  it("builds prompts with a clawflare runtime block", () => {
    const prompt = buildPrompt(
      { messages: [{ role: "user", content: "hello" }] },
      { accountId: "acct", agentId: "agent", sessionKey: "session" },
    );

    expect(prompt).toContain("<clawflare-runtime>");
    expect(prompt).toContain('"protocol": "openclaw-compatible-subset"');
    expect(prompt).toContain("user: hello");
  });

  it("returns accepted ack, emits events, persists transcript, and enqueues terminal work", async () => {
    const { runtime, store, r2, transcriptQueue, auditQueue } = createRuntime();
    const events: string[] = [];
    const accepted = await runtime.startRun(
      {
        session: { channel: "telegram", peerId: "42" },
        messages: [{ role: "user", content: "hello" }],
      },
      {
        sink: (event) => {
          events.push(event.phase);
        },
      },
    );

    expect(accepted).toMatchObject({
      type: "agent.accepted",
      runId: "run-1",
      sessionKey: "acct:agent:telegram:42",
      status: "accepted",
    });

    const result = await runtime.waitForRun({ runId: "run-1" });

    expect(result).toMatchObject({
      type: "agent.wait",
      runId: "run-1",
      status: "completed",
      summary: {
        outputText: "Fake response: hello",
      },
    });
    expect(events).toEqual(["started", "assistant", "completed"]);
    expect(store.events.get("run-1")?.map((event) => event.seq)).toEqual([1, 2, 3]);
    expect([...r2.objects.values()].join("\n")).toContain("Fake response: hello");
    expect(transcriptQueue.messages[0]).toMatchObject({
      type: "transcript.index",
      accountId: "acct",
      agentId: "agent",
      sessionKey: "acct:agent:telegram:42",
    });
    expect(auditQueue.messages[0]).toMatchObject({
      type: "audit.persist",
      payload: {
        action: "agent.run.completed",
        runId: "run-1",
      },
    });
  });

  it("uses the environment default model when the input omits one", async () => {
    let capturedModel: string | undefined;

    class ModelRecordingProvider extends FakeProviderRuntime {
      override async complete(input: ProviderCompleteInput): Promise<ProviderCompleteOutput & FakeProviderOutput> {
        capturedModel = input.model;
        return await super.complete(input);
      }
    }

    const store = new MemoryAgentRuntimeStore();
    const r2 = new FakeR2RuntimeStorage();
    const runtime = new DurableAgentRuntime({
      env: {
        CLAWFLARE_DEFAULT_ACCOUNT_ID: "acct",
        CLAWFLARE_DEFAULT_AGENT_ID: "agent",
        CLAWFLARE_DEFAULT_MODEL: "nvidia/nemotron-3-super-120b-a12b:free",
      } as ClawflareEnv,
      store,
      r2,
      provider: new ModelRecordingProvider(),
      now: () => new Date("2026-05-06T12:00:00.000Z"),
      runId: () => "run-default-model",
    });

    const accepted = await runtime.startRun({
      session: { channel: "telegram", peerId: "42" },
      messages: [{ role: "user", content: "hello" }],
    });
    await runtime.waitForRun({ runId: accepted.runId });

    expect(capturedModel).toBe("nvidia/nemotron-3-super-120b-a12b:free");
  });

  it("returns normalized provider errors for failed runs", async () => {
    class FailingProvider extends FakeProviderRuntime {
      override async complete(): Promise<ProviderCompleteOutput & FakeProviderOutput> {
        throw new ProviderError("PROVIDER_AUTH", "openai-compatible rejected authentication.", 401, false);
      }
    }

    const { runtime, store } = createRuntime({
      provider: new FailingProvider(),
      runIds: ["run-provider-error"],
    });

    const accepted = await runtime.startRun({
      session: { channel: "telegram", peerId: "42" },
      messages: [{ role: "user", content: "hello" }],
    });
    const result = await runtime.waitForRun({ runId: accepted.runId });

    expect(result).toMatchObject({
      type: "agent.wait",
      runId: "run-provider-error",
      status: "failed",
      error: {
        code: "PROVIDER_AUTH",
        message: "openai-compatible rejected authentication.",
        status: 401,
        retryable: false,
      },
    });
    expect(store.runs.get("run-provider-error")?.error_json).toContain("openai-compatible rejected authentication.");
  });

  it("serializes runs per session lane", async () => {
    const order: string[] = [];
    const { runtime } = createRuntime({
      provider: new RecordingProvider(order),
      runIds: ["run-1", "run-2"],
    });
    const messages = (content: string): AgentMessage[] => [{ role: "user", content }];

    const first = await runtime.startRun({ sessionKey: "same-session", messages: messages("first") });
    const second = await runtime.startRun({ sessionKey: "same-session", messages: messages("second") });

    await runtime.waitForRun({ runId: first.runId });
    await runtime.waitForRun({ runId: second.runId });

    expect(order).toEqual(["start:first", "end:first", "start:second", "end:second"]);
  });

  it("can execute a bounded tool loop before producing the final answer", async () => {
    class ToolCallingProvider extends FakeProviderRuntime {
      calls = 0;

      override async complete(input: ProviderCompleteInput): Promise<ProviderCompleteOutput & FakeProviderOutput> {
        this.calls += 1;

        if (this.calls === 1) {
          expect(input.messages[0]?.role).toBe("system");
          expect(input.messages[0]?.content).toContain("<clawflare-tools>");
          return {
            text: '<clawflare_tool_call>{"name":"web_fetch","input":{"url":"https://example.com/page"}}</clawflare_tool_call>',
            usage: {
              inputMessages: input.messages.length,
              outputCharacters: 0,
            },
          };
        }

        const toolMessage = input.messages.at(-1);
        expect(toolMessage?.role).toBe("tool");
        expect(toolMessage?.content).toContain('"status":200');
        expect(toolMessage?.content).toContain('"text":"tool-ok"');

        return {
          text: "Fetched example.com successfully.",
          usage: {
            inputMessages: input.messages.length,
            outputCharacters: 33,
          },
        };
      }
    }

    const workspace = new R2WorkspaceBackend({
      accountId: "acct",
      agentId: "agent",
      r2: new FakeWorkspaceR2(),
      index: new MemoryWorkspaceIndex(),
      now: () => new Date("2026-05-06T00:00:00.000Z"),
    });
    const { runtime } = createRuntime({
      provider: new ToolCallingProvider(),
      runIds: ["run-tool-loop"],
      toolContext: {
        env: {} as ClawflareEnv,
        accountId: "acct",
        agentId: "agent",
        policy: {
          allowRead: true,
          allowWrite: false,
          allowNetwork: true,
          allowChannelSend: false,
          allowMemory: false,
          allowedTools: ["web_fetch", "workspace_read", "workspace_list"],
          webFetchAllowlist: ["example.com"],
        },
        workspace,
        fetcher: async () => new Response("tool-ok", { status: 200, headers: { "content-type": "text/plain" } }),
      },
    });
    const phases: string[] = [];

    const accepted = await runtime.startRun(
      {
        session: { channel: "telegram", peerId: "42" },
        messages: [{ role: "user", content: "please fetch example.com" }],
      },
      {
        sink: (event) => {
          phases.push(event.phase);
        },
      },
    );
    const result = await runtime.waitForRun({ runId: accepted.runId });

    expect(result).toMatchObject({
      status: "completed",
      summary: {
        outputText: "Fetched example.com successfully.",
        toolTrace: [
          {
            tool: "web_fetch",
            input: { url: "https://example.com/page" },
          },
        ],
      },
    });
    expect(phases).toEqual(["started", "tool", "tool", "assistant", "completed"]);
  });
});

class FakeWorkspaceR2 {
  readonly objects = new Map<string, string>();

  async putWorkspaceObject(key: string, body: string | ArrayBuffer | ReadableStream): Promise<R2Object> {
    this.objects.set(key, typeof body === "string" ? body : "[binary]");

    return {
      key,
      version: "fake",
      size: this.objects.get(key)?.length ?? 0,
      etag: "etag",
      httpEtag: '"etag"',
      uploaded: new Date("2026-05-06T00:00:00.000Z"),
      checksums: {},
    } as R2Object;
  }

  async getWorkspaceObjectText(key: string): Promise<string | null> {
    return this.objects.get(key) ?? null;
  }
}

describe("session lanes", () => {
  it("runs tasks for the same session in order", async () => {
    const lanes = new SessionLanes();
    const order: string[] = [];

    const first = lanes.runExclusive("session", async () => {
      order.push("first:start");
      await new Promise((resolve) => setTimeout(resolve, 0));
      order.push("first:end");
    });
    const second = lanes.runExclusive("session", async () => {
      order.push("second:start");
      order.push("second:end");
    });

    await Promise.all([first, second]);

    expect(order).toEqual(["first:start", "first:end", "second:start", "second:end"]);
  });
});
