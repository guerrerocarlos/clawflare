import type { ClawflareEnv } from "../env";
import type { ClawflarePluginRuntime } from "../plugins/runtime";

export interface DoctorCheck {
  name: string;
  ok: boolean;
  severity: "info" | "warning" | "error";
  message: string;
}

export interface DoctorReport {
  ok: boolean;
  checks: DoctorCheck[];
}

function check(name: string, ok: boolean, severity: DoctorCheck["severity"], message: string): DoctorCheck {
  return { name, ok, severity, message };
}

export async function runDoctor(env: ClawflareEnv, pluginRuntime?: ClawflarePluginRuntime): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [
    check("binding.AGENT_OBJECT", env.AGENT_OBJECT !== undefined, "error", "Durable Object binding AGENT_OBJECT is required."),
    check("binding.DB", env.DB !== undefined, "error", "D1 binding DB is required."),
    check("binding.CATALOG_CACHE", env.CATALOG_CACHE !== undefined, "error", "KV binding CATALOG_CACHE is required."),
    check("secret.CLAWFLARE_GATEWAY_TOKEN", Boolean(env.CLAWFLARE_GATEWAY_TOKEN), "error", "Gateway token is required."),
    check("secret.TELEGRAM_BOT_TOKEN", Boolean(env.TELEGRAM_BOT_TOKEN), "warning", "Telegram bot token is required for MVP channel use."),
    check(
      "secret.TELEGRAM_WEBHOOK_SECRET",
      Boolean(env.TELEGRAM_WEBHOOK_SECRET),
      "warning",
      "Telegram webhook secret should be configured before exposing the webhook.",
    ),
    check(
      "telegram.allowlist",
      Boolean(env.TELEGRAM_ALLOWED_USER_IDS),
      "warning",
      "Configure TELEGRAM_ALLOWED_USER_IDS or KV allowlist before public Telegram use.",
    ),
  ];

  if (env.TELEGRAM_BOT_TOKEN && !env.TELEGRAM_WEBHOOK_SECRET) {
    checks.push(check("telegram.unsafe_webhook", false, "error", "Telegram bot token is set without webhook secret."));
  }

  if (pluginRuntime) {
    const skills = await pluginRuntime.enabledSkills();
    checks.push(check("plugins.enabled_skills", true, "info", `${skills.length} enabled ClawHub skill(s).`));
  }

  return {
    ok: checks.every((item) => item.ok || item.severity !== "error"),
    checks,
  };
}
