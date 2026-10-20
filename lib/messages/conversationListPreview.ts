import type { ChatMessage, Conversation } from "@/lib/api/types";
import { accessTokenSubject } from "@/lib/auth/accessTokenSubject";
import { formatFcfa } from "@/lib/formatFcfa";
import { documentNameFromListPreview } from "@/lib/document/kind";
import type { TFunction } from "i18next";

export function rawPreviewFromChatMessage(msg: ChatMessage): {
  preview: string;
  lastMessageType: Conversation["lastMessageType"];
  lastMessageAt: string;
} {
  const now = msg.createdAt || new Date().toISOString();
  const preview =
    msg.type === "money"
      ? `💰 ${msg.moneyTransfer?.amountFcfa ?? ""} F`
      : msg.type === "voice"
        ? "🎤"
        : msg.type === "image"
          ? String(msg.body ?? "").trim() || "📷"
          : msg.type === "document"
            ? (() => {
                const name = String(msg.document?.fileName ?? "").trim();
                return name
                  ? name.length > 72
                    ? `📄 ${name.slice(0, 69)}…`
                    : `📄 ${name}`
                  : "📄";
              })()
            : String(msg.body ?? "");
  const lastMessageType: Conversation["lastMessageType"] =
    msg.type === "money" ||
    msg.type === "voice" ||
    msg.type === "image" ||
    msg.type === "document"
      ? msg.type
      : "text";
  return { preview, lastMessageType, lastMessageAt: now };
}

export function lastMessageFromSelf(msg: ChatMessage, token: string): boolean {
  const sub = accessTokenSubject(token);
  return Boolean(
    msg.senderUserId &&
      (msg.senderUserId === "me" || (sub && msg.senderUserId === sub)),
  );
}

export function conversationFieldsFromLastMessage(
  msg: ChatMessage,
  token: string,
): Pick<
  Conversation,
  | "lastMessagePreview"
  | "lastMessageType"
  | "lastMessageAt"
  | "lastMessageFromSelf"
> {
  const { preview, lastMessageType, lastMessageAt } =
    rawPreviewFromChatMessage(msg);
  return {
    lastMessagePreview: preview,
    lastMessageType,
    lastMessageAt,
    lastMessageFromSelf: lastMessageFromSelf(msg, token),
  };
}

/** Texte affiché dans la liste — aligné sur `previewFor` (ConversationsScreen). */
export function displayListPreviewForMessage(
  msg: ChatMessage,
  t: TFunction,
  fallbackConversation?: Conversation,
): string {
  if (msg.type === "voice") {
    return t("messages.voicePreview");
  }
  if (msg.type === "image") {
    const p = String(msg.body ?? "").trim();
    if (p && p !== "IMAGE" && p !== "📷") return p;
    return t("messages.imagePreview");
  }
  if (msg.type === "document") {
    const { preview } = rawPreviewFromChatMessage(msg);
    const p = String(preview ?? "").trim();
    if (p && !p.startsWith("📄")) return p;
    const name = documentNameFromListPreview(p);
    if (name) return name;
    return t("messages.documentPreview");
  }
  if (msg.type === "money") {
    const { preview } = rawPreviewFromChatMessage(msg);
    const p = String(preview ?? "").trim();
    if (p && /[A-Za-zÀ-ÿ]/.test(p)) return p;
    const n = parseInt(p.replace(/\D/g, ""), 10);
    if (Number.isFinite(n) && n > 0) {
      return t("messages.moneyPreview", { amount: formatFcfa(n) });
    }
    if (p) return p;
    const fb = String(fallbackConversation?.lastMessagePreview ?? "").trim();
    if (fb) return fb;
  }
  const { preview } = rawPreviewFromChatMessage(msg);
  return String(preview ?? "").trim();
}
