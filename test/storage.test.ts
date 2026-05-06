import { describe, expect, it } from "vitest";
import { D1Storage, type AccountRecord } from "../src/storage/d1";
import {
  artifactKey,
  pluginArchiveKey,
  pluginManifestKey,
  runEventsKey,
  transcriptKey,
  workspaceObjectKey,
} from "../src/storage/keys";
import { R2Storage } from "../src/storage/r2";
import { DurableObjectSqliteStorage, durableObjectSqliteMigrations, type SessionRecord } from "../src/storage/do-sqlite";

class FakeD1Statement {
  private bindings: unknown[] = [];

  constructor(
    private readonly db: FakeD1Database,
    private readonly query: string,
  ) {}

  bind(...values: unknown[]): FakeD1Statement {
    this.bindings = values;
    return this;
  }

  async run(): Promise<unknown> {
    this.db.calls.push({ query: this.query, bindings: this.bindings });
    return { success: true };
  }

  async first<T>(): Promise<T | null> {
    this.db.calls.push({ query: this.query, bindings: this.bindings });
    return this.db.firstResult as T | null;
  }
}

class FakeD1Database {
  readonly calls: Array<{ query: string; bindings: unknown[] }> = [];
  firstResult: unknown = null;

  prepare(query: string): FakeD1Statement {
    return new FakeD1Statement(this, query);
  }
}

class FakeR2Object {
  constructor(private readonly body: string) {}

  async text(): Promise<string> {
    return this.body;
  }
}

class FakeR2Bucket {
  readonly objects = new Map<string, string>();
  readonly metadata = new Map<string, unknown>();

  async put(key: string, value: string | ArrayBuffer | ReadableStream, options?: unknown): Promise<R2Object> {
    this.metadata.set(key, options);

    if (typeof value === "string") {
      this.objects.set(key, value);
    } else if (value instanceof ArrayBuffer) {
      this.objects.set(key, new TextDecoder().decode(value));
    } else {
      this.objects.set(key, "[stream]");
    }

    return {
      key,
      version: "fake",
      size: this.objects.get(key)?.length ?? 0,
      etag: "fake-etag",
      httpEtag: '"fake-etag"',
      uploaded: new Date("2026-05-06T00:00:00.000Z"),
      checksums: {},
    } as R2Object;
  }

  async get(key: string): Promise<R2ObjectBody | null> {
    const object = this.objects.get(key);
    return object === undefined ? null : (new FakeR2Object(object) as unknown as R2ObjectBody);
  }
}

class FakeSql {
  readonly calls: Array<{ query: string; bindings: unknown[] }> = [];
  rows: unknown[] = [];

  exec<T>(query: string, ...bindings: unknown[]): Iterable<T> {
    this.calls.push({ query, bindings });
    return this.rows as T[];
  }
}

describe("R2 key helpers", () => {
  it("creates approved R2 key shapes", async () => {
    expect(transcriptKey({ accountId: "acct", agentId: "agent", sessionId: "sess" })).toBe(
      "accounts/acct/agents/agent/sessions/sess/transcript.jsonl",
    );
    expect(runEventsKey({ accountId: "acct", agentId: "agent", runId: "run" })).toBe(
      "accounts/acct/agents/agent/runs/run/events.jsonl",
    );
    expect(await workspaceObjectKey({ accountId: "acct", agentId: "agent", path: "/notes/todo.md", hash: "abc" })).toBe(
      "accounts/acct/agents/agent/workspace/abc/todo.md",
    );
    expect(pluginArchiveKey({ accountId: "acct", agentId: "agent", pluginId: "plug", version: "1.0.0" })).toBe(
      "accounts/acct/agents/agent/plugins/plug/1.0.0/archive.tgz",
    );
    expect(pluginManifestKey({ accountId: "acct", agentId: "agent", pluginId: "plug", version: "1.0.0" })).toBe(
      "accounts/acct/agents/agent/plugins/plug/1.0.0/manifest.json",
    );
    expect(artifactKey({ accountId: "acct", agentId: "agent", artifactId: "art", name: "out.txt" })).toBe(
      "accounts/acct/agents/agent/artifacts/art/out.txt",
    );
  });
});

describe("D1 storage adapter", () => {
  it("upserts and reads account records", async () => {
    const db = new FakeD1Database();
    const storage = new D1Storage(db as unknown as D1Database);
    const record: AccountRecord = {
      id: "acct",
      display_name: "Account",
      created_at: "2026-05-06T00:00:00.000Z",
      updated_at: "2026-05-06T00:00:00.000Z",
    };

    await storage.upsertAccount(record);
    db.firstResult = record;

    await expect(storage.getAccount("acct")).resolves.toEqual(record);
    expect(db.calls[0]?.query).toContain("INSERT INTO accounts");
    expect(db.calls[0]?.bindings).toEqual(["acct", "Account", record.created_at, record.updated_at]);
    expect(db.calls[1]?.query).toContain("SELECT * FROM accounts");
    expect(db.calls[1]?.bindings).toEqual(["acct"]);
  });
});

describe("R2 storage adapter", () => {
  it("stores and reads transcripts from the transcript bucket", async () => {
    const transcripts = new FakeR2Bucket();
    const storage = new R2Storage({
      transcripts: transcripts as unknown as R2Bucket,
      artifacts: new FakeR2Bucket() as unknown as R2Bucket,
      pluginArchives: new FakeR2Bucket() as unknown as R2Bucket,
    });

    await storage.putTranscript("transcript.jsonl", '{"type":"message"}\n');

    await expect(storage.getTranscriptText("transcript.jsonl")).resolves.toBe('{"type":"message"}\n');
    expect(transcripts.metadata.get("transcript.jsonl")).toMatchObject({
      httpMetadata: {
        contentType: "application/jsonl",
      },
    });
  });
});

describe("Durable Object SQLite storage adapter", () => {
  it("runs all local DO SQLite migrations", () => {
    const sql = new FakeSql();
    const storage = new DurableObjectSqliteStorage({ sql });

    storage.migrate();

    expect(sql.calls).toHaveLength(durableObjectSqliteMigrations.length);
    expect(sql.calls[0]?.query).toContain("CREATE TABLE IF NOT EXISTS sessions");
  });

  it("upserts and reads sessions", () => {
    const sql = new FakeSql();
    const storage = new DurableObjectSqliteStorage({ sql });
    const session: SessionRecord = {
      session_key: "acct:agent:telegram:1",
      session_id: "sess",
      account_id: "acct",
      agent_id: "agent",
      title: null,
      status: "active",
      last_run_id: null,
      transcript_r2_key: null,
      session_started_at: "2026-05-06T00:00:00.000Z",
      last_interaction_at: "2026-05-06T00:00:00.000Z",
      updated_at: "2026-05-06T00:00:00.000Z",
    };

    storage.upsertSession(session);
    sql.rows = [session];

    expect(storage.getSession(session.session_key)).toEqual(session);
    expect(sql.calls[0]?.query).toContain("INSERT INTO sessions");
    expect(sql.calls[0]?.bindings[0]).toBe(session.session_key);
    expect(sql.calls[1]?.query).toContain("SELECT * FROM sessions");
  });
});
