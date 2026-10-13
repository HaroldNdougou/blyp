/**
 * Liste fil inversée + flags date — recalcul seulement si le tableau `messages` change (ref).
 */
import type { ChatMessage } from "@/lib/api/types";
import { messageDayKey } from "@/lib/format";
import { foldReactionSyncMessages } from "@/lib/messages/reactionSync";

export type ChatThreadListModel = {
  newestFirst: ChatMessage[];
  showDateAt: boolean[];
  flashTypes: string[];
};

type Pack = {
  source: ChatMessage[];
  model: ChatThreadListModel;
};

const packs = new Map<string, Pack>();

function flashTypeForMessage(m: ChatMessage): string {
  if (m.deletedForAll) return "deleted";
  if (m.type === "image") return "image";
  if (m.type === "voice") return "voice";
  if (m.type === "money") return "money";
  return "text";
}

function buildModel(messages: ChatMessage[]): ChatThreadListModel {
  const folded = foldReactionSyncMessages(messages);
  const n = folded.length;
  const newestFirst = new Array<ChatMessage>(n);
  const showDateAt = new Array<boolean>(n);
  const flashTypes = new Array<string>(n);
  for (let i = 0; i < n; i++) {
    const chronIdx = n - 1 - i;
    const item = folded[chronIdx];
    newestFirst[i] = item;
    flashTypes[i] = flashTypeForMessage(item);
    const olderChronIdx = chronIdx - 1;
    showDateAt[i] =
      olderChronIdx < 0 ||
      messageDayKey(folded[olderChronIdx].createdAt) !==
        messageDayKey(item.createdAt);
  }
  return { newestFirst, showDateAt, flashTypes };
}

export function ensureChatThreadListModel(
  conversationId: string,
  messages: ChatMessage[],
): ChatThreadListModel {
  const cid = String(conversationId ?? "").trim();
  if (!cid) return buildModel(messages);
  const prev = packs.get(cid);
  if (prev && prev.source === messages) return prev.model;
  const model = buildModel(messages);
  packs.set(cid, { source: messages, model });
  return model;
}

export function clearChatThreadListModel(conversationId?: string): void {
  if (conversationId) packs.delete(String(conversationId).trim());
  else packs.clear();
}

export function chatFlashItemType(item: ChatMessage): string {
  return flashTypeForMessage(item);
}
