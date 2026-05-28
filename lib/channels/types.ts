import type { ChannelName } from "../types";

export type { ChannelName };

export interface NormalizedMessage {
  senderId: string;
  messageId: string;
  text: string;
  contactName: string;
  channel: ChannelName;
}

export interface ChannelClient {
  name: ChannelName;
  extractMessages(rawBody: string): NormalizedMessage[];
  sendMessage(recipientId: string, text: string): Promise<boolean>;
  sendImage?(recipientId: string, imageUrl: string, caption?: string): Promise<boolean>;
  verifySignature(rawBody: string, signature: string | null): boolean;
}
