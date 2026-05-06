import type { ClawHubPackage, ClawHubSkill, ParsedPluginManifest } from "./types";

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readSkills(manifest: Record<string, unknown>): ClawHubSkill[] {
  const skills = Array.isArray(manifest.skills) ? manifest.skills : [];

  return skills
    .filter((skill): skill is Record<string, unknown> => typeof skill === "object" && skill !== null)
    .map((skill) => {
      const parsed: ClawHubSkill = {
        name: readString(skill.name) ?? "skill",
        content: readString(skill.content) ?? readString(skill.prompt) ?? "",
      };
      const description = readString(skill.description);

      if (description !== undefined) {
        parsed.description = description;
      }

      return parsed;
    })
    .filter((skill) => skill.content.length > 0);
}

export function parsePluginManifest(pkg: ClawHubPackage): ParsedPluginManifest {
  const manifest = typeof pkg.manifest === "object" && pkg.manifest !== null ? (pkg.manifest as Record<string, unknown>) : {};
  const pluginId = readString(manifest.id) ?? readString(manifest.name) ?? pkg.name;
  const version = readString(manifest.version) ?? pkg.version;
  const skills = readSkills(manifest);
  const native = Boolean(manifest.extensions ?? manifest.tools ?? manifest.hooks ?? manifest.runtime);
  const parsed: ParsedPluginManifest = {
    pluginId,
    version,
    skills,
    native,
    raw: pkg.manifest,
  };
  const description = readString(manifest.description) ?? pkg.description;

  if (description !== undefined) {
    parsed.description = description;
  }

  return parsed;
}
