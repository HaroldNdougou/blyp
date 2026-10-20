import type { ChatMessage } from "@/lib/api/types";
import { isOutboundMessagePending } from "@/lib/messages/outboundPending";
import { isReactionSyncMessage } from "@/lib/messages/reactionSync";

export type ForwardDraft = {
  sourceConversationId: string;
  messages: ChatMessage[];
};

let pending: ForwardDraft | null = null;

export function canForwardMessage(msg: ChatMessage): boolean {
  if (msg.deletedForAll) return false;
  if (isOutboundMessagePending(msg)) return false;
  if (msg.type === "money") return false;
  if (isReactionSyncMessage(msg)) return false;
  if (msg.type === "text") {
    return Boolean(String(msg.body ?? "").trim());
  }
  if (msg.type === "voice") {
    return Boolean(msg.voice?.key);
  }
  if (msg.type === "image") {
    return Boolean(msg.image?.key);
  }
  if (msg.type === "document") {
    return Boolean(msg.document?.key);
  }
  return false;
}

export function setForwardDraft(draft: ForwardDraft): void {
  pending = draft;
}

export function peekForwardDraft(): ForwardDraft | null {
  return pending;
}

export function consumeForwardDraft(): ForwardDraft | null {
  const d = pending;
  pending = null;
  return d;
}

export function clearForwardDraft(): void {
  pending = null;
}
