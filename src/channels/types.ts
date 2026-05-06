export type ChannelKind = "telegram" | "webchat";

export interface NormalizedChatMessage {
  channel: ChannelKind;
  chatId: string;
  senderId: string;
  senderName?: string;
  text: string;
  isGroup: boolean;
  messageId?: number;
  threadId?: string;
}

export interface ChannelDeliveryMessage {
  channel: ChannelKind;
  chatId: string;
  text: string;
  replyToMessageId?: number;
}
