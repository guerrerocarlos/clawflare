import type { ClawflareEnv } from "../env";
import { AnthropicCompatibleProvider } from "./anthropic-compatible";
import { CloudflareAiGatewayProvider } from "./cloudflare-ai-gateway";
import { ProviderError } from "./errors";
import { FakeProviderRuntime } from "./fake";
import { OpenAiCompatibleProvider } from "./openai-compatible";
import type { AuthStatus, ModelInfo, ProviderFetch, ProviderRuntime } from "./runtime";
import { WorkersAiProvider } from "./workers-ai";

export interface ModelRef {
  providerId: string;
  model: string;
}

export function parseModelRef(ref: string): ModelRef {
  const separator = ref.indexOf("/");

  if (separator <= 0 || separator === ref.length - 1) {
    throw new ProviderError("PROVIDER_BAD_MODEL_REF", "Model ref must use provider/model format.", 400, false);
  }

  return {
    providerId: ref.slice(0, separator),
    model: ref.slice(separator + 1),
  };
}

export class ProviderRegistry {
  private readonly providers = new Map<string, ProviderRuntime>();

  register(provider: ProviderRuntime): void {
    this.providers.set(provider.id, provider);
  }

  get(providerId: string): ProviderRuntime {
    const provider = this.providers.get(providerId);

    if (!provider) {
      throw new ProviderError("PROVIDER_BAD_MODEL_REF", `Unknown provider ${providerId}.`, 400, false);
    }

    return provider;
  }

  resolve(modelRef: string): { provider: ProviderRuntime; model: string } {
    const parsed = parseModelRef(modelRef);
    return {
      provider: this.get(parsed.providerId),
      model: parsed.model,
    };
  }

  async listModels(env: ClawflareEnv, fetcher: ProviderFetch): Promise<ModelInfo[]> {
    const lists = await Promise.all(
      [...this.providers.values()].map(async (provider) => {
        try {
          return await provider.listModels({ env, fetcher });
        } catch {
          return [];
        }
      }),
    );

    return lists.flat();
  }

  async authStatuses(env: ClawflareEnv, fetcher: ProviderFetch): Promise<AuthStatus[]> {
    return await Promise.all([...this.providers.values()].map((provider) => provider.authStatus({ env, fetcher })));
  }
}

export function createDefaultProviderRegistry(): ProviderRegistry {
  const registry = new ProviderRegistry();

  registry.register(new FakeProviderRuntime());
  registry.register(new OpenAiCompatibleProvider());
  registry.register(new AnthropicCompatibleProvider());
  registry.register(new WorkersAiProvider());
  registry.register(new CloudflareAiGatewayProvider());

  return registry;
}
