import type { ChatMessage } from "@/lib/api/types";
import { isOutboundMessagePending } from "@/lib/messages/outboundPending";
import { isReactionSyncMessage } from "@/lib/messages/reactionSync";

export const FORWARD_SOURCE_STATUS = "__status__";
export const FORWARD_SOURCE_SOA_REPORT = "__soa_report__";

export type OutboundDocumentForward = {
  localUri: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  pageCount?: number | null;
  thumbLocalUri?: string | null;
};

export type ForwardDraft = {
  sourceConversationId: string;
  messages: ChatMessage[];
  outboundDocument?: OutboundDocumentForward;
};

export function isSyntheticForwardSource(sourceConversationId: string): boolean {
  const id = String(sourceConversationId ?? "").trim();
  return id === FORWARD_SOURCE_STATUS || id === FORWARD_SOURCE_SOA_REPORT;
}

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
