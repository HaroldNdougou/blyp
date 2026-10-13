import type { ChatMessage, MessageReplyTo } from "@/lib/api/types";
import type { TFunction } from "i18next";

type ReplyRaw = ChatMessage & {
  replyToMessageId?: string;
  replyToSenderUserId?: string;
  replyToType?: MessageReplyTo["type"];
  replyToPreview?: string | null;
};

/** API / cache : objet `replyTo` ou champs plats Dynamo. */
export function getMessageReplyTo(msg: ChatMessage): MessageReplyTo | null {
  const nested = msg.replyTo;
  if (nested?.messageId) {
    const id = String(nested.messageId).trim();
    if (id) return { ...nested, messageId: id };
  }
  const raw = msg as ReplyRaw;
  const messageId = String(raw.replyToMessageId ?? "").trim();
  if (!messageId) return null;
  return {
    messageId,
    senderUserId: String(raw.replyToSenderUserId ?? ""),
    type: raw.replyToType ?? "text",
    preview: raw.replyToPreview ?? null,
  };
}

export function withNormalizedReplyTo(msg: ChatMessage): ChatMessage {
  const replyTo = getMessageReplyTo(msg);
  if (replyTo === msg.replyTo) return msg;
  return { ...msg, replyTo };
}

export function messageReplySnippet(
  msg: ChatMessage,
  t: TFunction,
  formatFcfa: (n: number) => string,
): string {
  if (msg.type === "text") {
    const raw = String(msg.body ?? "").trim();
    if (!raw) return "";
    return raw.length > 120 ? `${raw.slice(0, 117)}…` : raw;
  }
  if (msg.type === "voice") return t("messages.voicePreview");
  if (msg.type === "image") {
    const cap = String(msg.body ?? "").trim();
    return cap || t("messages.imagePreview");
  }
  if (msg.type === "money" && msg.moneyTransfer) {
    return t("messages.moneyPreview", {
      amount: formatFcfa(msg.moneyTransfer.amountFcfa),
    });
  }
  return "";
}

export function replyToFromMessage(
  msg: ChatMessage,
  t: TFunction,
  formatFcfa: (n: number) => string,
): MessageReplyTo {
  const preview = messageReplySnippet(msg, t, formatFcfa);
  return {
    messageId: msg.id,
    senderUserId: msg.senderUserId,
    type: msg.type,
    preview: preview || null,
  };
}

export function replySnippetText(
  replyTo: MessageReplyTo,
  t: TFunction,
): string {
  const p = String(replyTo.preview ?? "").trim();
  if (p) return p;
  if (replyTo.type === "voice") return t("messages.voicePreview");
  if (replyTo.type === "image") return t("messages.imagePreview");
  if (replyTo.type === "money") return t("messages.moneyReplySnippet");
  return "";
}

export function replyAuthorName(
  replyTo: MessageReplyTo,
  myId: string | null,
  peerName: string,
  t: TFunction,
): string {
  if (myId && replyTo.senderUserId === myId) return t("messages.replyYou");
  const name = peerName.trim();
  return name || t("messages.someone");
}
