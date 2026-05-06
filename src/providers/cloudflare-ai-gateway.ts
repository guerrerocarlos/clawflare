import { providerHttpError, ProviderError } from "./errors";
import type { AuthStatus, ModelInfo, ProviderCompleteInput, ProviderCompleteOutput, ProviderContext, ProviderRuntime } from "./runtime";
import { secretStatus } from "./secrets";

interface CloudflareGatewayResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
  usage?: Record<string, unknown>;
}

export class CloudflareAiGatewayProvider implements ProviderRuntime {
  readonly id = "cloudflare-ai-gateway";

  constructor(private readonly upstreamProvider = "openai") {}

  async authStatus(ctx: ProviderContext): Promise<AuthStatus> {
    const apiKey = secretStatus(ctx.env, "CLOUDFLARE_AI_GATEWAY_API_KEY");
    const accountId = secretStatus(ctx.env, "CLOUDFLARE_ACCOUNT_ID");
    const gatewayName = secretStatus(ctx.env, "CLOUDFLARE_AI_GATEWAY_NAME");

    return {
      provider: this.id,
      configured: accountId.configured && gatewayName.configured,
      requiredSecrets: [accountId, gatewayName, apiKey],
      details: {
        upstreamProvider: this.upstreamProvider,
      },
    };
  }

  async listModels(ctx: ProviderContext): Promise<ModelInfo[]> {
    const response = await ctx.fetcher(`${this.baseUrl(ctx)}/models`, {
      headers: this.headers(ctx),
    });

    if (!response.ok) {
      throw providerHttpError(this.id, response);
    }

    const payload = (await response.json()) as { data?: Array<{ id: string; created?: number }> };

    return (payload.data ?? []).map((model) => {
      const info: ModelInfo = {
        id: `${this.id}/${model.id}`,
        provider: this.id,
        metadata: {
          upstreamProvider: this.upstreamProvider,
        },
      };

      if (model.created !== undefined) {
        info.created = model.created;
      }

      return info;
    });
  }

  async complete(input: ProviderCompleteInput, ctx: ProviderContext): Promise<ProviderCompleteOutput> {
    const response = await ctx.fetcher(`${this.baseUrl(ctx)}/chat/completions`, {
      method: "POST",
      headers: {
        ...this.headers(ctx),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: input.model,
        messages: input.messages.map((message) => ({ role: message.role, content: message.content })),
        stream: false,
      }),
    });

    if (!response.ok) {
      throw providerHttpError(this.id, response);
    }

    const payload = (await response.json()) as CloudflareGatewayResponse;
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

  private baseUrl(ctx: ProviderContext): string {
    const accountId = ctx.env.CLOUDFLARE_ACCOUNT_ID;
    const gatewayName = ctx.env.CLOUDFLARE_AI_GATEWAY_NAME;

    if (!accountId || !gatewayName) {
      throw new ProviderError("PROVIDER_AUTH", `${this.id} requires CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_AI_GATEWAY_NAME.`, 401, false);
    }

    return `https://gateway.ai.cloudflare.com/v1/${encodeURIComponent(accountId)}/${encodeURIComponent(
      gatewayName,
    )}/${encodeURIComponent(this.upstreamProvider)}`;
  }

  private headers(ctx: ProviderContext): HeadersInit {
    if (!ctx.env.CLOUDFLARE_AI_GATEWAY_API_KEY) {
      return {};
    }

    return {
      authorization: `Bearer ${ctx.env.CLOUDFLARE_AI_GATEWAY_API_KEY}`,
    };
  }
}
