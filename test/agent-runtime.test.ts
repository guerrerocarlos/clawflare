import { describe, expect, it } from "vitest";
import type { ClawflareEnv, QueuePayload } from "../src/env";
import { buildPrompt } from "../src/agents/prompt";
import { DurableAgentRuntime } from "../src/agents/run-loop";
import type { AgentMessage } from "../src/agents/runtime";
import { FakeProviderRuntime, type FakeProviderOutput } from "../src/providers/fake";
import type { ProviderCompleteInput, ProviderCompleteOutput } from "../src/providers/runtime";
import { SessionLanes } from "../src/sessions/lanes";
import { normalizeSessionRef } from "../src/sessions/keys";
import { MemoryAgentRuntimeStore } from "../src/sessions/store";

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

function createRuntime(overrides?: { provider?: FakeProviderRuntime; runIds?: string[] }) {
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

  const runtime = new DurableAgentRuntime(
    overrides?.provider === undefined ? runtimeOptions : { ...runtimeOptions, provider: overrides.provider },
  );

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
});

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
