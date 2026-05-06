export interface ClawHubSkill {
  name: string;
  description?: string;
  content: string;
}

export interface ClawHubPackage {
  name: string;
  version: string;
  description?: string;
  manifest: unknown;
  archiveUrl?: string;
  source?: string;
}

export interface ParsedPluginManifest {
  pluginId: string;
  version: string;
  description?: string;
  skills: ClawHubSkill[];
  native: boolean;
  raw: unknown;
}

export interface InstalledPlugin {
  pluginId: string;
  version: string;
  manifest: ParsedPluginManifest;
  enabled: boolean;
}
