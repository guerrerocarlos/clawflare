import { Type } from "@sinclair/typebox";
import type { ToolRuntime, WorkspaceEntry, WorkspaceFile, WorkspaceToolBackend } from "./runtime";
import { ToolError } from "./runtime";
import type { R2Storage } from "../storage/r2";
import { sha256Hex, workspaceObjectKey } from "../storage/keys";

export class MemoryWorkspaceIndex {
  private readonly entries = new Map<string, WorkspaceEntry>();

  async list(): Promise<WorkspaceEntry[]> {
    return [...this.entries.values()].sort((left, right) => left.path.localeCompare(right.path));
  }

  async get(path: string): Promise<WorkspaceEntry | null> {
    return this.entries.get(path) ?? null;
  }

  async upsert(entry: WorkspaceEntry): Promise<void> {
    this.entries.set(entry.path, entry);
  }
}

export interface WorkspaceIndexStore {
  list(): Promise<WorkspaceEntry[]>;
  get(path: string): Promise<WorkspaceEntry | null>;
  upsert(entry: WorkspaceEntry): Promise<void>;
}

export class R2WorkspaceBackend implements WorkspaceToolBackend {
  constructor(
    private readonly options: {
      accountId: string;
      agentId: string;
      r2: Pick<R2Storage, "putWorkspaceObject" | "getWorkspaceObjectText">;
      index: WorkspaceIndexStore;
      now?: () => Date;
    },
  ) {}

  async list(): Promise<WorkspaceEntry[]> {
    return await this.options.index.list();
  }

  async read(path: string): Promise<WorkspaceFile | null> {
    const entry = await this.options.index.get(path);

    if (!entry) {
      return null;
    }

    const content = await this.options.r2.getWorkspaceObjectText(entry.r2Key);

    if (content === null) {
      return null;
    }

    return {
      ...entry,
      content,
    };
  }

  async write(path: string, content: string, contentType = "text/plain; charset=utf-8"): Promise<WorkspaceEntry> {
    const hash = await sha256Hex(content);
    const r2Key = await workspaceObjectKey({
      accountId: this.options.accountId,
      agentId: this.options.agentId,
      path,
      hash,
    });
    const object = await this.options.r2.putWorkspaceObject(r2Key, content, { contentType });
    const entry: WorkspaceEntry = {
      path,
      r2Key,
      contentType,
      size: content.length,
      etag: object.etag,
      updatedAt: (this.options.now ?? (() => new Date()))().toISOString(),
    };

    await this.options.index.upsert(entry);
    return entry;
  }

  async patch(path: string, find: string, replace: string): Promise<WorkspaceFile> {
    const existing = await this.read(path);

    if (!existing) {
      throw new ToolError("NOT_FOUND", `Workspace file ${path} was not found.`);
    }

    if (!existing.content.includes(find)) {
      throw new ToolError("PATCH_MISS", `Patch target was not found in ${path}.`);
    }

    const content = existing.content.replaceAll(find, replace);
    const entry = await this.write(path, content, existing.contentType ?? undefined);

    return {
      ...entry,
      content,
    };
  }
}

function requireWorkspace(context: Parameters<ToolRuntime["invoke"]>[1]): WorkspaceToolBackend {
  if (!context.workspace) {
    throw new ToolError("WORKSPACE_UNAVAILABLE", "Workspace backend is not configured.");
  }

  return context.workspace;
}

export function workspaceTools(): ToolRuntime[] {
  return [
    {
      name: "workspace_list",
      description: "List files in the agent workspace.",
      inputSchema: Type.Object({}),
      policy: { effects: ["read"] },
      async invoke(_input, context) {
        return { files: await requireWorkspace(context).list() };
      },
    },
    {
      name: "workspace_read",
      description: "Read a text file from the agent workspace.",
      inputSchema: Type.Object({ path: Type.String({ minLength: 1 }) }),
      policy: { effects: ["read"] },
      async invoke(input, context) {
        const file = await requireWorkspace(context).read((input as { path: string }).path);

        if (!file) {
          throw new ToolError("NOT_FOUND", "Workspace file was not found.");
        }

        return file;
      },
    },
    {
      name: "workspace_write",
      description: "Write a text file to the agent workspace.",
      inputSchema: Type.Object({
        path: Type.String({ minLength: 1 }),
        content: Type.String(),
        contentType: Type.Optional(Type.String()),
      }),
      policy: { effects: ["write"] },
      async invoke(input, context) {
        const body = input as { path: string; content: string; contentType?: string };
        return await requireWorkspace(context).write(body.path, body.content, body.contentType);
      },
    },
    {
      name: "workspace_patch",
      description: "Patch a text file by replacing an exact string.",
      inputSchema: Type.Object({
        path: Type.String({ minLength: 1 }),
        find: Type.String({ minLength: 1 }),
        replace: Type.String(),
      }),
      policy: { effects: ["read", "write"] },
      async invoke(input, context) {
        const body = input as { path: string; find: string; replace: string };
        return await requireWorkspace(context).patch(body.path, body.find, body.replace);
      },
    },
  ];
}
