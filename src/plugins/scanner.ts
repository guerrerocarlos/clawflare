export interface PluginScanResult {
  ok: boolean;
  findings: Array<{
    code: string;
    message: string;
  }>;
}

const forbiddenPatterns = ["child_process", "node:fs", "fs.", "node:net", "node:tls", "eval(", "new Function"];
const forbiddenScripts = ["preinstall", "install", "postinstall", "prepare"];

export function scanPluginSource(input: { source?: string; packageJson?: unknown }): PluginScanResult {
  const findings: PluginScanResult["findings"] = [];

  for (const pattern of forbiddenPatterns) {
    if (input.source?.includes(pattern)) {
      findings.push({ code: "FORBIDDEN_API", message: `Forbidden API pattern ${pattern} found.` });
    }
  }

  if (typeof input.packageJson === "object" && input.packageJson !== null) {
    const scripts = (input.packageJson as { scripts?: Record<string, unknown> }).scripts ?? {};

    for (const script of forbiddenScripts) {
      if (typeof scripts[script] === "string") {
        findings.push({ code: "FORBIDDEN_SCRIPT", message: `Forbidden package script ${script} found.` });
      }
    }
  }

  return {
    ok: findings.length === 0,
    findings,
  };
}
