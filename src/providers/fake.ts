import type { AgentMessage } from "../agents/runtime";
import type { AuthStatus, ModelInfo, ProviderCompleteInput, ProviderCompleteOutput, ProviderContext, ProviderRuntime } from "./runtime";

export interface FakeProviderInput {
  prompt: string;
  messages: AgentMessage[];
}

export interface FakeProviderOutput {
  text: string;
  usage: {
    inputMessages: number;
    outputCharacters: number;
  };
}

export class FakeProviderRuntime implements ProviderRuntime {
  readonly id = "fake";

  async listModels(): Promise<ModelInfo[]> {
    return [
      {
        id: `${this.id}/deterministic`,
        provider: this.id,
        name: "Deterministic fake provider",
      },
    ];
  }

  async authStatus(_ctx: ProviderContext): Promise<AuthStatus> {
    return {
      provider: this.id,
      configured: true,
      requiredSecrets: [],
    };
  }

  async complete(input: ProviderCompleteInput): Promise<ProviderCompleteOutput & FakeProviderOutput> {
    const lastUserMessage = [...input.messages].reverse().find((message) => message.role === "user");
    const text = `Fake response: ${lastUserMessage?.content ?? "no user message"}`;

    return {
      text,
      usage: {
        inputMessages: input.messages.length,
        outputCharacters: text.length,
      },
    };
  }
}
