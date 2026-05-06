import type { AuthStatus, ModelInfo, ProviderCompleteInput, ProviderCompleteOutput, ProviderContext, ProviderRuntime } from "./runtime";
import { ProviderError } from "./errors";

export class WorkersAiProvider implements ProviderRuntime {
  readonly id = "workers-ai";

  async authStatus(ctx: ProviderContext): Promise<AuthStatus> {
    return {
      provider: this.id,
      configured: ctx.env.AI !== undefined,
      requiredSecrets: [],
      details: {
        binding: "AI",
        configured: ctx.env.AI !== undefined,
      },
    };
  }

  async listModels(): Promise<ModelInfo[]> {
    return [
      {
        id: `${this.id}/@cf/meta/llama-3.1-8b-instruct`,
        provider: this.id,
        name: "Workers AI Llama 3.1 8B Instruct",
      },
    ];
  }

  async complete(input: ProviderCompleteInput, ctx: ProviderContext): Promise<ProviderCompleteOutput> {
    if (ctx.env.AI === undefined) {
      throw new ProviderError("PROVIDER_AUTH", "Workers AI binding AI is not configured.", 401, false);
    }

    const result = (await ctx.env.AI.run(input.model, {
      messages: input.messages.map((message) => ({ role: message.role, content: message.content })),
    })) as unknown;

    if (typeof result === "string") {
      return { text: result, raw: result };
    }

    if (typeof result === "object" && result !== null) {
      const object = result as Record<string, unknown>;
      const text = object.response ?? object.result ?? object.text;

      if (typeof text === "string") {
        return {
          text,
          raw: result,
        };
      }
    }

    throw new ProviderError("PROVIDER_RESPONSE", "Workers AI returned an unsupported response shape.", 502, false);
  }
}
