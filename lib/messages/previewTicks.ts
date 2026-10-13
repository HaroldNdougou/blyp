import type { Conversation } from "@/lib/api/types";
import {
  getMessagesSnapshot,
  getReceiptsSnapshot,
} from "@/lib/messagesCache";

export type PreviewTickState = "sent" | "delivered" | "read";

export function previewTickForConversation(
  conversation: Conversation,
  token: string,
  myId: string | null,
): PreviewTickState | null {
  if (!myId || !conversation.lastMessageAt) return null;

  let fromSelf = conversation.lastMessageFromSelf;
  if (fromSelf !== true) {
    if (fromSelf === false) return null;
    const msgs = getMessagesSnapshot(token, conversation.id);
    const last = msgs?.[msgs.length - 1];
    if (!last || last.senderUserId !== myId) return null;
  }

  const at = conversation.lastMessageAt;
  const receipts = getReceiptsSnapshot(conversation.id);
  if (receipts?.peerLastReadAt && at <= receipts.peerLastReadAt) {
    return "read";
  }
  if (receipts?.peerLastDeliveredAt && at <= receipts.peerLastDeliveredAt) {
    return "delivered";
  }
  return "sent";
}
