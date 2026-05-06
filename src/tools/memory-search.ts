import { Type } from "@sinclair/typebox";
import type { ToolRuntime } from "./runtime";

export function memorySearchTool(): ToolRuntime {
  return {
    name: "memory_search",
    description: "Search agent memory. MVP returns an empty result set until Vectorize indexing is wired.",
    inputSchema: Type.Object({
      query: Type.String({ minLength: 1 }),
      limit: Type.Optional(Type.Number({ minimum: 1, maximum: 20 })),
    }),
    policy: { effects: ["memory"] },
    async invoke(input) {
      return {
        query: (input as { query: string }).query,
        matches: [],
        backing: "stub",
      };
    },
  };
}
