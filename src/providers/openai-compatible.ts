import { providerHttpError, ProviderError } from "./errors";
import type { AuthStatus, ModelInfo, ProviderCompleteInput, ProviderCompleteOutput, ProviderContext, ProviderRuntime } from "./runtime";
import { requireSecret, secretStatus } from "./secrets";

interface OpenAiCompatibleResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
  usage?: Record<string, unknown>;
}

export class OpenAiCompatibleProvider implements ProviderRuntime {
  readonly id = "openai-compatible";

  constructor(private readonly baseUrl = "https://api.openai.com/v1") {}

  async authStatus(ctx: ProviderContext): Promise<AuthStatus> {
    const apiKey = secretStatus(ctx.env, "OPENAI_API_KEY");

    return {
      provider: this.id,
      configured: apiKey.configured,
      requiredSecrets: [apiKey],
    };
  }

  async listModels(ctx: ProviderContext): Promise<ModelInfo[]> {
    const apiKey = requireSecret(ctx.env, "OPENAI_API_KEY", this.id);
    const response = await ctx.fetcher(`${this.baseUrl}/models`, {
      headers: {
        authorization: `Bearer ${apiKey}`,
      },
    });

    if (!response.ok) {
      throw providerHttpError(this.id, response);
    }

    const payload = (await response.json()) as { data?: Array<{ id: string; created?: number; object?: string }> };

    return (payload.data ?? []).map((model) => {
      const info: ModelInfo = {
        id: `${this.id}/${model.id}`,
        provider: this.id,
      };

      if (model.created !== undefined) {
        info.created = model.created;
      }

      if (model.object !== undefined) {
        info.metadata = { object: model.object };
      }

      return info;
    });
  }

  async complete(input: ProviderCompleteInput, ctx: ProviderContext): Promise<ProviderCompleteOutput> {
    const apiKey = requireSecret(ctx.env, "OPENAI_API_KEY", this.id);
    const response = await ctx.fetcher(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: input.model,
        messages: input.messages.map((message) => ({ role: message.role, content: message.content })),
        stream: false,
        ...(input.temperature === undefined ? {} : { temperature: input.temperature }),
      }),
    });

    if (!response.ok) {
      throw providerHttpError(this.id, response);
    }

    const payload = (await response.json()) as OpenAiCompatibleResponse;
    const text = payload.choices?.[0]?.message?.content;

    if (typeof text !== "string") {
      throw new ProviderError("PROVIDER_RESPONSE", `${this.id} returned no message content.`, 502, false);
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
