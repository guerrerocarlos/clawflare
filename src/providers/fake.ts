import type { AgentMessage } from "../agents/runtime";

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

export class FakeProviderRuntime {
  async complete(input: FakeProviderInput): Promise<FakeProviderOutput> {
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
