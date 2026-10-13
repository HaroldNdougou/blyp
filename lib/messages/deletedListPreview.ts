import type { ChatMessage } from "@/lib/api/types";
import { getMessagesSnapshot } from "@/lib/messagesCache";

/** Dernier message du fil s’il est supprimé pour tous (aperçu liste). */
export function lastDeletedMessageInThread(
  token: string,
  conversationId: string,
): ChatMessage | null {
  const cid = String(conversationId ?? "").trim();
  if (!cid || !token) return null;
  const msgs = getMessagesSnapshot(token, cid);
  if (!msgs?.length) return null;
  const last = msgs[msgs.length - 1];
  return last.deletedForAll ? last : null;
}

export function messageFromSelf(
  msg: ChatMessage,
  myId: string | null,
): boolean {
  if (!myId) return false;
  const s = msg.senderUserId;
  return s === myId || s === "me";
}
