import { Type } from "@sinclair/typebox";
import type { ToolRuntime } from "./runtime";
import { ToolError } from "./runtime";

export function messageSendTool(): ToolRuntime {
  return {
    name: "message_send",
    description: "Send a message through the configured channel runtime.",
    inputSchema: Type.Object({
      channel: Type.String({ minLength: 1 }),
      peerId: Type.String({ minLength: 1 }),
      text: Type.String({ minLength: 1 }),
      replyToMessageId: Type.Optional(Type.String()),
    }),
    policy: { effects: ["channel"] },
    async invoke(input, context) {
      if (!context.channelRuntime) {
        throw new ToolError("CHANNEL_UNAVAILABLE", "Channel runtime is not configured.");
      }

      return await context.channelRuntime.sendMessage(input as { channel: string; peerId: string; text: string });
    },
  };
}
