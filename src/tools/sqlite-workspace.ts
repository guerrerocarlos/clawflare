import type { WorkspaceIndexRecord } from "../storage/do-sqlite";
import type { DurableObjectSqliteStorage } from "../storage/do-sqlite";
import type { WorkspaceEntry } from "./runtime";
import type { WorkspaceIndexStore } from "./workspace";

function fromRecord(record: WorkspaceIndexRecord): WorkspaceEntry {
  return {
    path: record.path,
    r2Key: record.r2_key,
    contentType: record.content_type,
    size: record.size,
    etag: record.etag,
    updatedAt: record.updated_at,
  };
}

function toRecord(entry: WorkspaceEntry): WorkspaceIndexRecord {
  return {
    path: entry.path,
    r2_key: entry.r2Key,
    content_type: entry.contentType ?? null,
    size: entry.size ?? null,
    etag: entry.etag ?? null,
    updated_at: entry.updatedAt,
  };
}

export class SqliteWorkspaceIndex implements WorkspaceIndexStore {
  constructor(private readonly storage: Pick<DurableObjectSqliteStorage, "listWorkspaceIndex" | "getWorkspaceIndex" | "upsertWorkspaceIndex">) {}

  async list(): Promise<WorkspaceEntry[]> {
    return (await this.storage.listWorkspaceIndex()).map(fromRecord);
  }

  async get(path: string): Promise<WorkspaceEntry | null> {
    const record = await this.storage.getWorkspaceIndex(path);
    return record === null ? null : fromRecord(record);
  }

  async upsert(entry: WorkspaceEntry): Promise<void> {
    await this.storage.upsertWorkspaceIndex(toRecord(entry));
  }
}
