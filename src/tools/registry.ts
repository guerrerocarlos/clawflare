import { Value } from "@sinclair/typebox/value";
import { assertToolAllowed } from "../security/policy";
import { memorySearchTool } from "./memory-search";
import { messageSendTool } from "./message-send";
import type { ToolInvokeContext, ToolRuntime } from "./runtime";
import { ToolError } from "./runtime";
import { webFetchTool } from "./web-fetch";
import { workspaceTools } from "./workspace";

export class ToolRegistry {
  private readonly tools = new Map<string, ToolRuntime>();

  register(tool: ToolRuntime): void {
    this.tools.set(tool.name, tool);
  }

  catalog(): Array<Pick<ToolRuntime, "name" | "description" | "inputSchema" | "policy">> {
    return [...this.tools.values()].map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      policy: tool.policy,
    }));
  }

  get(name: string): ToolRuntime {
    const tool = this.tools.get(name);

    if (!tool) {
      throw new ToolError("TOOL_NOT_FOUND", `Tool ${name} was not found.`);
    }

    return tool;
  }

  async invoke(name: string, input: unknown, context: ToolInvokeContext): Promise<unknown> {
    const tool = this.get(name);
    assertToolAllowed(tool.name, tool.policy, context.policy);

    if (!Value.Check(tool.inputSchema, input)) {
      throw new ToolError("BAD_TOOL_INPUT", `Input for tool ${tool.name} does not match its schema.`);
    }

    return await tool.invoke(input, context);
  }
}

export function createDefaultToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();

  for (const tool of workspaceTools()) {
    registry.register(tool);
  }

  registry.register(webFetchTool());
  registry.register(messageSendTool());
  registry.register(memorySearchTool());

  return registry;
}
