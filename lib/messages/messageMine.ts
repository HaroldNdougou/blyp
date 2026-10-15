import type { ChatMessage } from "@/lib/api/types";

/** Aligné sur `isMine` du fil (JWT sub + optimistic clientId). */
export function isChatMessageMine(
  msg: ChatMessage,
  myUserId: string | null,
): boolean {
  if (myUserId && msg.senderUserId === myUserId) return true;
  if (msg.clientId && msg.id === msg.clientId) return true;
  return false;
}
