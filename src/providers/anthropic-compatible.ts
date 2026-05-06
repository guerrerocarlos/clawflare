import { providerHttpError, ProviderError } from "./errors";
import type { AuthStatus, ModelInfo, ProviderCompleteInput, ProviderCompleteOutput, ProviderContext, ProviderRuntime } from "./runtime";
import { requireSecret, secretStatus } from "./secrets";

interface AnthropicMessageResponse {
  content?: Array<{
    type: string;
    text?: string;
  }>;
  usage?: Record<string, unknown>;
}

export class AnthropicCompatibleProvider implements ProviderRuntime {
  readonly id = "anthropic-compatible";

  constructor(private readonly baseUrl = "https://api.anthropic.com/v1") {}

  async authStatus(ctx: ProviderContext): Promise<AuthStatus> {
    const apiKey = secretStatus(ctx.env, "ANTHROPIC_API_KEY");

    return {
      provider: this.id,
      configured: apiKey.configured,
      requiredSecrets: [apiKey],
    };
  }

  async listModels(ctx: ProviderContext): Promise<ModelInfo[]> {
    const apiKey = requireSecret(ctx.env, "ANTHROPIC_API_KEY", this.id);
    const response = await ctx.fetcher(`${this.baseUrl}/models`, {
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
    });

    if (!response.ok) {
      throw providerHttpError(this.id, response);
    }

    const payload = (await response.json()) as { data?: Array<{ id: string; display_name?: string }> };

    return (payload.data ?? []).map((model) => {
      const info: ModelInfo = {
        id: `${this.id}/${model.id}`,
        provider: this.id,
      };

      if (model.display_name !== undefined) {
        info.name = model.display_name;
      }

      return info;
    });
  }

  async complete(input: ProviderCompleteInput, ctx: ProviderContext): Promise<ProviderCompleteOutput> {
    const apiKey = requireSecret(ctx.env, "ANTHROPIC_API_KEY", this.id);
    const system = input.messages.filter((message) => message.role === "system").map((message) => message.content).join("\n");
    const messages = input.messages
      .filter((message) => message.role !== "system")
      .map((message) => ({
        role: message.role === "assistant" ? "assistant" : "user",
        content: message.content,
      }));
    const response = await ctx.fetcher(`${this.baseUrl}/messages`, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: input.model,
        max_tokens: input.maxTokens ?? 1024,
        messages,
        ...(system.length === 0 ? {} : { system }),
      }),
    });

    if (!response.ok) {
      throw providerHttpError(this.id, response);
    }

    const payload = (await response.json()) as AnthropicMessageResponse;
    const text = payload.content?.filter((part) => part.type === "text").map((part) => part.text ?? "").join("");

    if (!text) {
      throw new ProviderError("PROVIDER_RESPONSE", `${this.id} returned no text content.`, 502, false);
    }

    const output: ProviderCompleteOutput = {
      text,
      raw: payload,
    };

    if (payload.usage !== undefined) {
      output.usage = payload.usage;
    }

    return output;
  }
}
