import type { ClawHubSkill } from "./types";

export function renderEnabledSkillsBlock(skills: ClawHubSkill[]): string {
  if (skills.length === 0) {
    return "";
  }

  return [
    "<clawflare-skills>",
    ...skills.map((skill) => [`# ${skill.name}`, skill.description ?? "", skill.content].filter(Boolean).join("\n")),
    "</clawflare-skills>",
  ].join("\n");
}
