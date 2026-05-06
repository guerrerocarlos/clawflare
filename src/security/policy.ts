export type ToolEffect = "read" | "write" | "network" | "channel" | "memory";

export interface ToolPolicy {
  effects: ToolEffect[];
}

export interface ToolPolicyContext {
  allowedTools?: readonly string[];
  allowRead?: boolean;
  allowWrite?: boolean;
  allowNetwork?: boolean;
  allowChannelSend?: boolean;
  allowMemory?: boolean;
  webFetchAllowlist?: readonly string[];
}

export class PolicyError extends Error {
  constructor(
    message: string,
    readonly code = "POLICY_DENIED",
  ) {
    super(message);
    this.name = "PolicyError";
  }
}

export function assertToolAllowed(toolName: string, policy: ToolPolicy, context: ToolPolicyContext): void {
  if (context.allowedTools !== undefined && !context.allowedTools.includes(toolName)) {
    throw new PolicyError(`Tool ${toolName} is not allowed by policy.`);
  }

  for (const effect of policy.effects) {
    if (effect === "read" && context.allowRead !== true) {
      throw new PolicyError(`Tool ${toolName} requires read permission.`);
    }

    if (effect === "write" && context.allowWrite !== true) {
      throw new PolicyError(`Tool ${toolName} requires write permission.`);
    }

    if (effect === "network" && context.allowNetwork !== true) {
      throw new PolicyError(`Tool ${toolName} requires network permission.`);
    }

    if (effect === "channel" && context.allowChannelSend !== true) {
      throw new PolicyError(`Tool ${toolName} requires channel send permission.`);
    }

    if (effect === "memory" && context.allowMemory !== true) {
      throw new PolicyError(`Tool ${toolName} requires memory permission.`);
    }
  }
}
