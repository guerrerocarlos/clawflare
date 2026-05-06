export interface AgentScopedKeyParts {
  accountId: string;
  agentId: string;
}

export interface SessionKeyParts extends AgentScopedKeyParts {
  sessionId: string;
}

export interface RunKeyParts extends AgentScopedKeyParts {
  runId: string;
}

export interface PluginKeyParts extends AgentScopedKeyParts {
  pluginId: string;
  version: string;
}

export interface ArtifactKeyParts extends AgentScopedKeyParts {
  artifactId: string;
  name: string;
}

export interface WorkspaceKeyParts extends AgentScopedKeyParts {
  path: string;
  hash?: string;
}

function encodeSegment(segment: string): string {
  return encodeURIComponent(segment).replaceAll("%2F", "/");
}

function filenameFromPath(path: string): string {
  const trimmed = path.replace(/^\/+|\/+$/g, "");
  const parts = trimmed.split("/").filter(Boolean);
  return parts.at(-1) ?? "object";
}

export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);

  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function transcriptKey(parts: SessionKeyParts): string {
  return `accounts/${encodeSegment(parts.accountId)}/agents/${encodeSegment(parts.agentId)}/sessions/${encodeSegment(
    parts.sessionId,
  )}/transcript.jsonl`;
}

export function runEventsKey(parts: RunKeyParts): string {
  return `accounts/${encodeSegment(parts.accountId)}/agents/${encodeSegment(parts.agentId)}/runs/${encodeSegment(
    parts.runId,
  )}/events.jsonl`;
}

export async function workspaceObjectKey(parts: WorkspaceKeyParts): Promise<string> {
  const hash = parts.hash ?? (await sha256Hex(parts.path));
  const filename = filenameFromPath(parts.path);

  return `accounts/${encodeSegment(parts.accountId)}/agents/${encodeSegment(parts.agentId)}/workspace/${hash}/${encodeSegment(
    filename,
  )}`;
}

export function pluginArchiveKey(parts: PluginKeyParts): string {
  return `accounts/${encodeSegment(parts.accountId)}/agents/${encodeSegment(parts.agentId)}/plugins/${encodeSegment(
    parts.pluginId,
  )}/${encodeSegment(parts.version)}/archive.tgz`;
}

export function pluginManifestKey(parts: PluginKeyParts): string {
  return `accounts/${encodeSegment(parts.accountId)}/agents/${encodeSegment(parts.agentId)}/plugins/${encodeSegment(
    parts.pluginId,
  )}/${encodeSegment(parts.version)}/manifest.json`;
}

export function artifactKey(parts: ArtifactKeyParts): string {
  return `accounts/${encodeSegment(parts.accountId)}/agents/${encodeSegment(parts.agentId)}/artifacts/${encodeSegment(
    parts.artifactId,
  )}/${encodeSegment(parts.name)}`;
}
