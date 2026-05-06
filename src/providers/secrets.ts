import type { ClawflareEnv } from "../env";
import { ProviderError } from "./errors";

export type ProviderSecretName =
  | "OPENAI_API_KEY"
  | "ANTHROPIC_API_KEY"
  | "CLOUDFLARE_AI_GATEWAY_API_KEY"
  | "CLOUDFLARE_ACCOUNT_ID"
  | "CLOUDFLARE_AI_GATEWAY_NAME";

export interface SecretStatus {
  name: ProviderSecretName;
  configured: boolean;
}

export function secretStatus(env: ClawflareEnv, name: ProviderSecretName): SecretStatus {
  return {
    name,
    configured: typeof env[name] === "string" && env[name].length > 0,
  };
}

export function requireSecret(env: ClawflareEnv, name: ProviderSecretName, provider: string): string {
  const value = env[name];

  if (typeof value !== "string" || value.length === 0) {
    throw new ProviderError("PROVIDER_AUTH", `${provider} requires ${name}.`, 401, false);
  }

  return value;
}
