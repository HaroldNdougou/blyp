import type { ChatMessage } from "@/lib/api/types";
import type { ThemeColors } from "@/lib/theme/colors";
import type { TFunction } from "i18next";

import { formatMoneyExpiresDate } from "@/lib/format";
import { isOutboundMessagePending } from "@/lib/messages/outboundPending";

export function firstNameOf(raw: string | null | undefined): string {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  return s.split(/\s+/)[0] ?? s;
}

export function tickForMessage(
  msg: ChatMessage,
  peerLastReadAt: string | null,
  peerLastDeliveredAt: string | null,
): "sending" | "read" | "delivered" | "sent" {
  if (isOutboundMessagePending(msg)) return "sending";
  if (peerLastReadAt && msg.createdAt <= peerLastReadAt) return "read";
  if (peerLastDeliveredAt && msg.createdAt <= peerLastDeliveredAt) {
    return "delivered";
  }
  return "sent";
}

export function moneyStatusText(
  tr: NonNullable<ChatMessage["moneyTransfer"]>,
  recipientMe: boolean,
  iAmSender: boolean,
  peerName: string,
  t: TFunction,
): string {
  const status = tr.status;
  if (status === "claimed") {
    const senderRecalled = Boolean(
      tr.claimedByUserId && tr.fromUserId && tr.claimedByUserId === tr.fromUserId,
    );
    const peer = firstNameOf(peerName) || t("messages.someone");
    if (senderRecalled) {
      return iAmSender
        ? t("messages.statusClaimedSelf")
        : t("messages.statusClaimedSelfBy", { name: peer });
    }
    return recipientMe
      ? t("messages.statusClaimed")
      : t("messages.statusClaimedBy", { name: peer });
  }
  if (status === "expired") return t("messages.statusExpired");
  if (status === "cancelled") return t("messages.statusCancelled");
  return t("messages.statusPending");
}

export function thanksLabel(
  tr: NonNullable<ChatMessage["moneyTransfer"]>,
  recipientMe: boolean,
  peerName: string,
  t: TFunction,
): string {
  if (!tr.thanksUserId && !tr.thanksFirstName) return "";
  if (recipientMe) return t("messages.thanksYou");
  const name = firstNameOf(peerName) || t("messages.someone");
  return t("messages.thanksBy", { name });
}

export function moneyExpiresLine(
  tr: NonNullable<ChatMessage["moneyTransfer"]>,
  t: TFunction,
): string {
  if (tr.status !== "pending" || !tr.expiresAt) return "";
  if (Date.parse(tr.expiresAt) <= Date.now()) return "";
  const date = formatMoneyExpiresDate(tr.expiresAt);
  if (!date) return "";
  return t("messages.moneyExpiresOn", { date });
}

export function moneyAmountColor(
  tr: NonNullable<ChatMessage["moneyTransfer"]>,
  mine: boolean,
  colors: ThemeColors,
): string {
  const senderRecalled =
    tr.status === "claimed" &&
    Boolean(
      tr.claimedByUserId &&
        tr.fromUserId &&
        tr.claimedByUserId === tr.fromUserId,
    );
  if (senderRecalled || tr.status === "expired" || tr.status === "cancelled") {
    return colors.moneyAmountExpired;
  }
  if (tr.status === "claimed") return colors.moneyAmountClaimed;
  return mine ? colors.moneyAmountSent : colors.moneyAmountPending;
}

export function reactionsKey(
  list: ChatMessage["reactions"],
): string {
  if (!list || list.length === 0) return "";
  return list
    .map((r) => `${r.userId}:${r.emoji}`)
    .sort()
    .join("|");
}

export function messageRowContentKey(msg: ChatMessage): string {
  const tr = msg.moneyTransfer;
  return [
    isOutboundMessagePending(msg) ? "pending" : "acked",
    msg.type,
    msg.body ?? "",
    msg.voice?.key ?? "",
    msg.voice?.durationMs ?? "",
    msg.image?.key ?? "",
    msg.document?.key ?? "",
    msg.document?.thumbKey ?? "",
    msg.document?.fileName ?? "",
    msg.document?.pageCount ?? "",
    tr?.status ?? "",
    tr?.transferId ?? "",
    tr?.thanksUserId ?? "",
    reactionsKey(msg.reactions),
    msg.replyTo?.messageId ?? "",
    msg.replyTo?.preview ?? "",
  ].join("\u001f");
}
