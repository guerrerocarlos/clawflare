import type { AgentRunInput } from "../agents/runtime";
import type { NormalizedChatMessage } from "./types";

export function chatMessageToAgentInput(message: NormalizedChatMessage): AgentRunInput {
  return {
    session: {
      channel: message.channel,
      peerId: message.chatId,
      ...(message.threadId === undefined ? {} : { threadId: message.threadId }),
    },
    messages: [
      {
        role: "user",
        content: message.text,
      },
    ],
    metadata: {
      senderId: message.senderId,
      senderName: message.senderName,
      messageId: message.messageId,
      isGroup: message.isGroup,
    },
  };
}
