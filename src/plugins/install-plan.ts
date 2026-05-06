import { Type, type Static } from "@sinclair/typebox";
import type { ParsedPluginManifest } from "./types";
import type { PluginScanResult } from "./scanner";

export const PluginInstallPlanSchema = Type.Object({
  pluginId: Type.String(),
  version: Type.String(),
  source: Type.Literal("clawhub"),
  status: Type.Union([Type.Literal("ready"), Type.Literal("blocked")]),
  compatibilityTier: Type.Number(),
  approvalRequired: Type.Boolean(),
  skills: Type.Array(Type.String()),
  warnings: Type.Array(Type.String()),
  actions: Type.Array(Type.String()),
});

export type PluginInstallPlan = Static<typeof PluginInstallPlanSchema>;

export function createPluginInstallPlan(manifest: ParsedPluginManifest, scan: PluginScanResult): PluginInstallPlan {
  const warnings = scan.findings.map((finding) => finding.message);

  if (manifest.native || !scan.ok) {
    return {
      pluginId: manifest.pluginId,
      version: manifest.version,
      source: "clawhub",
      status: "blocked",
      compatibilityTier: 0,
      approvalRequired: true,
      skills: manifest.skills.map((skill) => skill.name),
      warnings: [
        ...warnings,
        ...(manifest.native ? ["Native plugin execution is fail-closed in the MVP."] : []),
      ],
      actions: ["download", "quarantine", "inspect"],
    };
  }

  return {
    pluginId: manifest.pluginId,
    version: manifest.version,
    source: "clawhub",
    status: "ready",
    compatibilityTier: 1,
    approvalRequired: true,
    skills: manifest.skills.map((skill) => skill.name),
    warnings,
    actions: ["download", "quarantine", "install-skills"],
  };
}
