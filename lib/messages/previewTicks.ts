import type { Conversation } from "@/lib/api/types";
import { isOutboundMessagePending } from "@/lib/messages/outboundPending";
import { lastMessageFromSelf } from "@/lib/messages/conversationListPreview";
import {
  getMessagesSnapshot,
  getReceiptsSnapshot,
} from "@/lib/messagesCache";

export type PreviewTickState = "sending" | "sent" | "delivered" | "read";

function lastOutboundPending(
  token: string,
  conversationId: string,
  myId: string,
): boolean {
  const msgs = getMessagesSnapshot(token, conversationId);
  const last = msgs?.[msgs.length - 1];
  if (!last || !isOutboundMessagePending(last)) return false;
  const sid = String(last.senderUserId ?? "").trim();
  return sid === myId || sid === "me";
}

export function previewTickForConversation(
  conversation: Conversation,
  token: string,
  myId: string | null,
): PreviewTickState | null {
  const msgs = getMessagesSnapshot(token, conversation.id);
  const threadLast = msgs?.length ? msgs[msgs.length - 1] : null;
  const at =
    threadLast?.createdAt ?? conversation.lastMessageAt ?? "";
  if (!myId || !at) return null;

  if (threadLast) {
    if (!lastMessageFromSelf(threadLast, token)) return null;
  } else if (conversation.lastMessageFromSelf !== true) {
    return null;
  }

  if (lastOutboundPending(token, conversation.id, myId)) {
    return "sending";
  }

  const receipts = getReceiptsSnapshot(conversation.id);
  if (receipts?.peerLastReadAt && at <= receipts.peerLastReadAt) {
    return "read";
  }
  if (receipts?.peerLastDeliveredAt && at <= receipts.peerLastDeliveredAt) {
    return "delivered";
  }
  return "sent";
}
