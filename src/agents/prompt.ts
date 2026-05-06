import type { AgentRunInput } from "./runtime";

export function buildPrompt(input: AgentRunInput, runtime: { accountId: string; agentId: string; sessionKey: string }): string {
  const runtimeBlock = [
    "<clawflare-runtime>",
    JSON.stringify(
      {
        accountId: runtime.accountId,
        agentId: runtime.agentId,
        sessionKey: runtime.sessionKey,
        environment: "cloudflare-workers",
        protocol: "openclaw-compatible-subset",
      },
      null,
      2,
    ),
    "</clawflare-runtime>",
  ].join("\n");

  const messages = input.messages.map((message) => `${message.role}: ${message.content}`).join("\n");

  return `${runtimeBlock}\n\n${messages}`;
}
