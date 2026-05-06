import type { AgentRunInput } from "./runtime";
import type { ClawHubSkill } from "../plugins/types";
import { renderEnabledSkillsBlock } from "../plugins/prompt";

export function buildPrompt(
  input: AgentRunInput,
  runtime: { accountId: string; agentId: string; sessionKey: string },
  options?: { skills?: ClawHubSkill[] },
): string {
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
  const skills = renderEnabledSkillsBlock(options?.skills ?? []);

  return [runtimeBlock, skills, messages].filter((part) => part.length > 0).join("\n\n");
}
