import type { ChatMessage, Conversation } from "@/lib/api/types";

const conversationsByToken = new Map<string, Conversation[]>();
const messagesByKey = new Map<string, ChatMessage[]>();

function msgKey(token: string, conversationId: string) {
  return `${token}::${conversationId}`;
}

export function getConversationsSnapshot(
  token: string,
): Conversation[] | null {
  if (!token) return null;
  const v = conversationsByToken.get(token);
  return v !== undefined ? v : null;
}

export function setConversationsSnapshot(
  token: string,
  items: Conversation[],
) {
  if (!token) return;
  conversationsByToken.set(token, items);
}

export function getMessagesSnapshot(
  token: string,
  conversationId: string,
): ChatMessage[] | null {
  if (!token) return null;
  const v = messagesByKey.get(msgKey(token, conversationId));
  return v !== undefined ? v : null;
}

export function setMessagesSnapshot(
  token: string,
  conversationId: string,
  items: ChatMessage[],
) {
  if (!token) return;
  messagesByKey.set(msgKey(token, conversationId), items);
}

export function clearAllMessagesSnapshots() {
  conversationsByToken.clear();
  messagesByKey.clear();
  void import("@/lib/messages/unread").then((m) => m.clearAllUnread());
}
