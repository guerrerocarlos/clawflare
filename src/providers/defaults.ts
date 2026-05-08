import type { ClawflareEnv } from "../env";
import { FakeProviderRuntime } from "./fake";
import { OpenAiCompatibleProvider } from "./openai-compatible";
import type { ProviderRuntime } from "./runtime";
import { WorkersAiProvider } from "./workers-ai";

export function selectDefaultAgentProvider(env: ClawflareEnv): ProviderRuntime {
  if (env.OPENAI_API_KEY) {
    return new OpenAiCompatibleProvider(env.OPENAI_COMPATIBLE_BASE_URL);
  }

  if (env.AI !== undefined && env.CLAWFLARE_DEFAULT_MODEL?.startsWith("@cf/")) {
    return new WorkersAiProvider();
  }

  return new FakeProviderRuntime();
}
