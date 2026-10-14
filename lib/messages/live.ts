import { getAccessToken, getUserSnapshot } from "@/lib/auth/authSession";
import {
  applyReactionFromSync,
  findPeerUserId,
  patchMessageDeletedForAll,
  patchMessageReactions,
  patchMoneyClaimed,
  patchMoneyTransfer,
  patchReceipts,
  removeMessageFromSnapshot,
  upsertPushedMessage,
  type MoneyClaimedPatch,
  type MoneyUpdatedPatch,
} from "@/lib/messagesCache";
import type { ChatMessage, MessageReaction } from "@/lib/api/types";
import {
  isReactionSyncBody,
  parseReactionSyncBody,
} from "@/lib/messages/reactionSync";
import { AppState, NativeEventEmitter, NativeModules, Platform } from "react-native";

type Listener = (conversationId: string) => void;
type ClaimedListener = (patch: MoneyClaimedPatch) => void;
export type ReceiptPatch = {
  conversationId: string;
  kind: "read" | "delivered";
  at: string;
};
type ReceiptListener = (patch: ReceiptPatch) => void;
export type ReactionPatch = {
  conversationId: string;
  messageId: string;
  reactions: MessageReaction[];
};
type ReactionListener = (patch: ReactionPatch) => void;
export type MessageDeletedPatch = {
  conversationId: string;
  messageId: string;
  deletedForAll: boolean;
};
type MessageDeletedListener = (patch: MessageDeletedPatch) => void;
export type TypingPatch = {
  conversationId: string;
  fromName: string;
  on: boolean;
};
type TypingListener = (patch: TypingPatch) => void;
type MoneyUpdatedListener = (patch: MoneyUpdatedPatch) => void;

const listeners = new Set<Listener>();
const claimedListeners = new Set<ClaimedListener>();
const receiptListeners = new Set<ReceiptListener>();
const reactionListeners = new Set<ReactionListener>();
const messageDeletedListeners = new Set<MessageDeletedListener>();
const typingListeners = new Set<TypingListener>();
const moneyUpdatedListeners = new Set<MoneyUpdatedListener>();
const typingByConv = new Map<string, { fromName: string; until: number }>();
const TYPING_TTL_MS = 6000;
let activeConversationId: string | null = null;
let nativeListening = false;

/** Fil actuellement ouvert — sert à masquer la notif si on est déjà dedans. */
export function setActiveConversation(id: string | null): void {
  activeConversationId = id && id.length > 0 ? id : null;
  if (activeConversationId) {
    void import("@/lib/messages/unread").then((m) => {
      m.clearUnread(activeConversationId!);
    });
    void dismissPresentedMessageNotification(activeConversationId);
  }
  void import("@/lib/push/announceNative").then((m) => {
    void m.setActiveConversationNative(activeConversationId);
  });
}

async function dismissPresentedMessageNotification(
  conversationId: string,
): Promise<void> {
  if (Platform.OS === "web") return;
  try {
    const Notifications = await import("expo-notifications");
    const presented = await Notifications.getPresentedNotificationsAsync();
    for (const n of presented) {
      const raw = n.request.content.data as Record<string, unknown>;
      const incoming = parseMessagePush(raw);
      const claimed = parseMoneyClaimedPush(raw);
      const same =
        incoming?.conversationId === conversationId ||
        claimed?.conversationId === conversationId;
      if (!same) continue;
      await Notifications.dismissNotificationAsync(n.request.identifier);
    }
  } catch {
    /* best effort */
  }
}

export function isViewingConversation(conversationId: string): boolean {
  return (
    activeConversationId != null && activeConversationId === conversationId
  );
}

export function subscribeIncomingMessage(cb: Listener): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function subscribeMoneyClaimed(cb: ClaimedListener): () => void {
  claimedListeners.add(cb);
  return () => {
    claimedListeners.delete(cb);
  };
}

export function notifyMoneyClaimed(raw: MoneyClaimedPatch): void {
  const conversationId = String(raw.conversationId ?? "").trim();
  const transferId = String(raw.transferId ?? "").trim();
  if (!conversationId || !transferId) return;
  const patch: MoneyClaimedPatch = {
    conversationId,
    transferId,
    claimedByFirstName: String(raw.claimedByFirstName ?? "").trim(),
    claimedAt: String(raw.claimedAt ?? "").trim() || new Date().toISOString(),
  };
  patchMoneyClaimed(patch);
  for (const cb of claimedListeners) cb(patch);
}

export type MoneyTrayKind = "claimed" | "thanks";

export type MoneyTrayPatch = {
  kind: MoneyTrayKind;
  conversationId: string;
  transferId: string;
  fromName: string;
};

export function notifyMoneyTray(raw: MoneyTrayPatch): void {
  const conversationId = String(raw.conversationId ?? "").trim();
  const transferId = String(raw.transferId ?? "").trim();
  if (!conversationId || !transferId) return;
  const fromName = String(raw.fromName ?? "").trim();
  const kind = raw.kind;
  if (kind === "claimed") {
    notifyMoneyClaimed({
      conversationId,
      transferId,
      claimedByFirstName: fromName,
      claimedAt: new Date().toISOString(),
    });
    return;
  }
  notifyMoneyUpdated({
    conversationId,
    transferId,
    thanksFirstName: fromName,
  });
}

export function subscribeConversationReceipt(
  cb: ReceiptListener,
): () => void {
  receiptListeners.add(cb);
  return () => {
    receiptListeners.delete(cb);
  };
}

export function notifyConversationReceipt(raw: ReceiptPatch): void {
  const conversationId = String(raw.conversationId ?? "").trim();
  const at = String(raw.at ?? "").trim();
  if (!conversationId || !at) return;
  const kind = raw.kind === "read" ? "read" : "delivered";
  const patch: ReceiptPatch = { conversationId, kind, at };
  patchReceipts(conversationId, kind, at);
  for (const cb of receiptListeners) cb(patch);
}

export function subscribeMessageReaction(
  cb: ReactionListener,
): () => void {
  reactionListeners.add(cb);
  return () => {
    reactionListeners.delete(cb);
  };
}

export function notifyMessageReaction(raw: ReactionPatch): void {
  const conversationId = String(raw.conversationId ?? "").trim();
  const messageId = String(raw.messageId ?? "").trim();
  if (!conversationId || !messageId) return;
  const reactions = Array.isArray(raw.reactions) ? raw.reactions : [];
  const patch: ReactionPatch = { conversationId, messageId, reactions };
  patchMessageReactions(conversationId, messageId, reactions);
  for (const cb of reactionListeners) cb(patch);
}

export function subscribeMessageDeleted(
  cb: MessageDeletedListener,
): () => void {
  messageDeletedListeners.add(cb);
  return () => {
    messageDeletedListeners.delete(cb);
  };
}

export function notifyMessageDeleted(raw: MessageDeletedPatch): void {
  const conversationId = String(raw.conversationId ?? "").trim();
  const messageId = String(raw.messageId ?? "").trim();
  if (!conversationId || !messageId) return;
  const deletedForAll = raw.deletedForAll !== false;
  const patch: MessageDeletedPatch = {
    conversationId,
    messageId,
    deletedForAll,
  };
  if (deletedForAll) {
    patchMessageDeletedForAll(conversationId, messageId);
  } else {
    const token = getAccessToken();
    if (token) removeMessageFromSnapshot(token, conversationId, messageId);
  }
  for (const cb of messageDeletedListeners) cb(patch);
}

export function parseMessageDeletedPush(
  data: Record<string, unknown> | undefined | null,
): MessageDeletedPatch | null {
  if (!data || typeof data !== "object") return null;
  let raw: Record<string, unknown> | null = null;
  if (data.type === "message_deleted") raw = data;
  const body = data.body;
  if (!raw && typeof body === "string" && body.startsWith("{")) {
    try {
      const parsed = JSON.parse(body) as Record<string, unknown>;
      if (parsed?.type === "message_deleted") raw = parsed;
    } catch {
      return null;
    }
  }
  if (!raw) return null;
  const conversationId = String(raw.conversationId ?? "").trim();
  const messageId = String(raw.messageId ?? "").trim();
  if (!conversationId || !messageId) return null;
  const flag = String(raw.deletedForAll ?? "1").trim();
  return {
    conversationId,
    messageId,
    deletedForAll: flag !== "0" && flag !== "false",
  };
}

export function subscribeConversationTyping(cb: TypingListener): () => void {
  typingListeners.add(cb);
  return () => {
    typingListeners.delete(cb);
  };
}

export function getTypingSnapshot(
  conversationId: string,
): { fromName: string } | null {
  const id = String(conversationId ?? "").trim();
  if (!id) return null;
  const cur = typingByConv.get(id);
  if (!cur || cur.until <= Date.now()) {
    typingByConv.delete(id);
    return null;
  }
  return { fromName: cur.fromName };
}

export function notifyConversationTyping(raw: TypingPatch): void {
  const conversationId = String(raw.conversationId ?? "").trim();
  if (!conversationId) return;
  const fromName = String(raw.fromName ?? "").trim();
  const on = raw.on !== false;
  if (!on) {
    typingByConv.delete(conversationId);
  } else {
    typingByConv.set(conversationId, {
      fromName,
      until: Date.now() + TYPING_TTL_MS,
    });
    setTimeout(() => {
      const cur = typingByConv.get(conversationId);
      if (cur && cur.until <= Date.now()) {
        typingByConv.delete(conversationId);
        for (const cb of typingListeners) {
          cb({ conversationId, fromName: cur.fromName, on: false });
        }
      }
    }, TYPING_TTL_MS + 40);
  }
  for (const cb of typingListeners) {
    cb({ conversationId, fromName, on });
  }
}

export function subscribeMoneyUpdated(cb: MoneyUpdatedListener): () => void {
  moneyUpdatedListeners.add(cb);
  return () => {
    moneyUpdatedListeners.delete(cb);
  };
}

export function notifyMoneyUpdated(raw: MoneyUpdatedPatch): void {
  const conversationId = String(raw.conversationId ?? "").trim();
  const transferId = String(raw.transferId ?? "").trim();
  if (!conversationId || !transferId) return;
  const patch: MoneyUpdatedPatch = {
    conversationId,
    transferId,
    status: String(raw.status ?? "").trim(),
    claimedByFirstName: String(raw.claimedByFirstName ?? "").trim(),
    claimedByUserId: String(raw.claimedByUserId ?? "").trim(),
    thanksFirstName: String(raw.thanksFirstName ?? "").trim(),
    thanksUserId: String(raw.thanksUserId ?? "").trim(),
    claimedAt: String(raw.claimedAt ?? "").trim(),
  };
  patchMoneyTransfer(patch);
  for (const cb of moneyUpdatedListeners) cb(patch);
}

export function ingestSilentChatPush(raw: unknown): boolean {
  if (!raw || typeof raw !== "object") return false;
  const data = raw as Record<string, unknown>;
  const typing = parseConversationTypingPush(data);
  if (typing) {
    notifyConversationTyping(typing);
    return true;
  }
  const updated = parseMoneyUpdatedPush(data);
  if (updated) {
    notifyMoneyUpdated(updated);
    return true;
  }
  const deleted = parseMessageDeletedPush(data);
  if (deleted) {
    notifyMessageDeleted(deleted);
    return true;
  }
  return false;
}

export function notifyIncomingMessage(
  conversationId: string,
  messageId?: string,
  opts?: { silent?: boolean; body?: string; pushed?: ParsedMessagePush | null },
): void {
  const id = String(conversationId ?? "").trim();
  if (!id) return;
  const parsed = parseReactionSyncBody(opts?.body);
  if (parsed) {
    const peerId = findPeerUserId(id);
    if (peerId) {
      const reactions = applyReactionFromSync(
        id,
        parsed.messageId,
        peerId,
        parsed.emoji,
      );
      if (reactions) {
        notifyMessageReaction({
          conversationId: id,
          messageId: parsed.messageId,
          reactions,
        });
      }
    }
  }
  const pushed = opts?.pushed;
  if (!opts?.silent && !parsed && pushed) {
    const msg = chatMessageFromPush(pushed);
    if (msg) upsertPushedMessage(getAccessToken(), msg);
  }
  if (!opts?.silent && !parsed && !isViewingConversation(id)) {
    void import("@/lib/messages/unread").then((m) => {
      m.bumpUnread(id, messageId);
    });
  }
  if (!opts?.silent && !parsed && pushed) {
    const me = String(getUserSnapshot()?.id ?? "").trim();
    const from = String(pushed.senderUserId ?? "").trim();
    const fromPeer = !from || !me || from !== me;
    if (fromPeer && AppState.currentState === "active") {
      if (!isViewingConversation(id)) {
        void import("@/lib/messages/chatSounds").then((m) => {
          m.playChatSound("incomingList");
        });
      }
    }
  }
  for (const cb of listeners) cb(id);
  if (!opts?.silent && !parsed) ackIncomingReceipt(id);
}

function ackIncomingReceipt(conversationId: string): void {
  void (async () => {
    try {
      const { getAccessToken } = await import("@/lib/auth/authSession");
      const token = getAccessToken();
      if (!token) return;
      const api = await import("@/lib/api/client");
      /** WhatsApp : bleu seulement si le fil est ouvert ET l’app au premier plan. */
      const viewing =
        isViewingConversation(conversationId) &&
        AppState.currentState === "active";
      if (viewing) {
        await api.markConversationRead(token, conversationId);
      } else {
        await api.markConversationDelivered(token, conversationId);
      }
    } catch {
      /* best effort */
    }
  })();
}

/** Pont FCM natif → append live (indépendant d’Expo). */
export function startMessageLiveBridge(): void {
  if (nativeListening || Platform.OS !== "android") return;
  nativeListening = true;
  const mod = (
    NativeModules as { BlypPaymentAnnounce?: object }
  ).BlypPaymentAnnounce;
  if (!mod) return;
  const em = new NativeEventEmitter(mod as never);
  em.addListener("blyp_message_received", (raw: unknown) => {
    ingestIncomingPush(raw);
  });
  em.addListener("blyp_money_claimed", (raw: Record<string, unknown>) => {
    const parsed = parseMoneyClaimedPush(raw);
    if (parsed) notifyMoneyClaimed(parsed);
  });
  em.addListener("blyp_conversation_receipt", (raw: Record<string, unknown>) => {
    const parsed = parseConversationReceiptPush(raw);
    if (parsed) notifyConversationReceipt(parsed);
  });
  em.addListener("blyp_conversation_typing", (raw: Record<string, unknown>) => {
    ingestSilentChatPush(raw);
  });
  em.addListener("blyp_money_updated", (raw: Record<string, unknown>) => {
    ingestSilentChatPush(raw);
  });
  em.addListener("blyp_money_tray", (raw: Record<string, unknown>) => {
    const parsed = parseMoneyTrayPush(raw);
    if (parsed) notifyMoneyTray(parsed);
  });
}

function unwrapPushData(
  data: Record<string, unknown> | undefined | null,
): Record<string, unknown> | null {
  if (!data || typeof data !== "object") return null;
  if (data.type === "message_received") return data;
  if (data.conversationId && (data.messageId || data.body || data.message)) {
    return data;
  }
  const body = data.body;
  if (typeof body === "string" && body.startsWith("{")) {
    try {
      const parsed = JSON.parse(body) as Record<string, unknown>;
      if (parsed?.type === "message_received") return parsed;
    } catch {
      return null;
    }
  }
  return null;
}

export type ParsedMessagePush = {
  conversationId: string;
  messageId: string;
  fromName: string;
  body: string;
  silent: boolean;
  messageType: string;
  senderUserId: string;
  createdAt: string;
  transferId: string;
  amountFcfa: number;
  expiresAt: string;
};

export function ingestIncomingPush(raw: unknown): ParsedMessagePush | null {
  if (typeof raw === "string") {
    const id = raw.trim();
    if (!id) return null;
    notifyIncomingMessage(id);
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const parsed = parseMessagePush(raw as Record<string, unknown>);
  if (!parsed) {
    const id = String(
      (raw as { conversationId?: unknown }).conversationId ?? "",
    ).trim();
    if (id) notifyIncomingMessage(id);
    return null;
  }
  notifyIncomingMessage(parsed.conversationId, parsed.messageId, {
    silent: parsed.silent,
    body: parsed.body,
    pushed: parsed,
  });
  return parsed;
}

export function parseMessagePush(
  data: Record<string, unknown> | undefined | null,
): ParsedMessagePush | null {
  const raw = unwrapPushData(data);
  if (!raw) return null;
  const conversationId = String(raw.conversationId ?? "").trim();
  if (!conversationId) return null;
  const body = String(raw.body ?? raw.message ?? "");
  const messageType = String(raw.messageType ?? "").trim().toLowerCase();
  const amountRaw = Number(raw.amountFcfa);
  const amountFromBody = parseInt(body.replace(/\D/g, ""), 10);
  const amountFcfa = Number.isFinite(amountRaw) && amountRaw > 0
    ? Math.floor(amountRaw)
    : Number.isFinite(amountFromBody) && amountFromBody > 0
      ? amountFromBody
      : 0;
  return {
    conversationId,
    messageId: String(raw.messageId ?? "").trim(),
    fromName: String(raw.fromName ?? "").trim() || "Blyp",
    body,
    silent:
      messageType === "reaction" ||
      isReactionSyncBody(body) ||
      body.trim().startsWith("BLYP_R"),
    messageType,
    senderUserId: String(raw.senderUserId ?? "").trim(),
    createdAt: String(raw.createdAt ?? "").trim(),
    transferId: String(raw.transferId ?? "").trim(),
    amountFcfa,
    expiresAt: String(raw.expiresAt ?? "").trim(),
  };
}

function stripImagePushPrefix(body: string): string | null {
  const raw = String(body ?? "").trim();
  if (!raw || raw === "📷 Photo" || raw === "📷") return null;
  if (raw.startsWith("📷 ")) return raw.slice(2).trim() || null;
  return raw;
}

function chatMessageFromPush(p: ParsedMessagePush): ChatMessage | null {
  if (!p.messageId || p.silent) return null;
  if (!p.createdAt) return null;
  const type: ChatMessage["type"] =
    p.messageType === "money"
      ? "money"
      : p.messageType === "voice"
        ? "voice"
        : p.messageType === "image"
          ? "image"
          : p.messageType === "document"
            ? "document"
            : "text";
  const amount = p.amountFcfa;
  const isMoney = type === "money" || (amount > 0 && /💰|fcfa|f\b/i.test(p.body));
  const kind: ChatMessage["type"] = isMoney ? "money" : type;
  const transferId = p.transferId || (kind === "money" ? p.messageId : "");
  return {
    id: p.messageId,
    conversationId: p.conversationId,
    senderUserId: p.senderUserId || "peer",
    type: kind,
    body:
      kind === "money" || kind === "voice" || kind === "document"
        ? null
        : kind === "image"
          ? stripImagePushPrefix(p.body)
          : p.body || null,
    moneyTransfer:
      kind === "money"
        ? {
            transferId,
            amountFcfa: amount,
            status: "pending",
            fromUserId: p.senderUserId || "peer",
            toUserId: null,
            toPhone: "",
            expiresAt: p.expiresAt || "",
            claimedAt: null,
            createdAt: p.createdAt,
          }
        : null,
    voice: kind === "voice" ? { key: "", durationMs: 0 } : null,
    image: kind === "image" ? { key: "", width: 0, height: 0 } : null,
    document:
      kind === "document"
        ? {
            key: "",
            fileName: String(p.body ?? "")
              .replace(/^📄\s*/, "")
              .trim() || "document",
            sizeBytes: 0,
          }
        : null,
    createdAt: p.createdAt,
    clientId: null,
  };
}

function unwrapMoneyClaimed(
  data: Record<string, unknown> | undefined | null,
): Record<string, unknown> | null {
  if (!data || typeof data !== "object") return null;
  if (data.type === "money_claimed") return data;
  const body = data.body;
  if (typeof body === "string" && body.startsWith("{")) {
    try {
      const parsed = JSON.parse(body) as Record<string, unknown>;
      if (parsed?.type === "money_claimed") return parsed;
    } catch {
      return null;
    }
  }
  return null;
}

export function parseMoneyClaimedPush(
  data: Record<string, unknown> | undefined | null,
): MoneyClaimedPatch | null {
  const raw = unwrapMoneyClaimed(data);
  if (!raw) return null;
  const conversationId = String(raw.conversationId ?? "").trim();
  const transferId = String(raw.transferId ?? "").trim();
  if (!conversationId || !transferId) return null;
  return {
    conversationId,
    transferId,
    claimedByFirstName: String(raw.claimedByFirstName ?? "").trim(),
    claimedAt: String(raw.claimedAt ?? "").trim() || new Date().toISOString(),
  };
}

function unwrapReceipt(
  data: Record<string, unknown> | undefined | null,
): Record<string, unknown> | null {
  if (!data || typeof data !== "object") return null;
  if (data.type === "conversation_receipt") return data;
  const body = data.body;
  if (typeof body === "string" && body.startsWith("{")) {
    try {
      const parsed = JSON.parse(body) as Record<string, unknown>;
      if (parsed?.type === "conversation_receipt") return parsed;
    } catch {
      return null;
    }
  }
  return null;
}

function unwrapReaction(
  data: Record<string, unknown> | undefined | null,
): Record<string, unknown> | null {
  if (!data || typeof data !== "object") return null;
  if (data.type === "message_reaction") return data;
  const body = data.body;
  if (typeof body === "string" && body.startsWith("{")) {
    try {
      const parsed = JSON.parse(body) as Record<string, unknown>;
      if (parsed?.type === "message_reaction") return parsed;
    } catch {
      return null;
    }
  }
  return null;
}

function parseReactionsField(raw: unknown): MessageReaction[] {
  let list: unknown = raw;
  if (typeof raw === "string" && raw.startsWith("[")) {
    try {
      list = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(list)) return [];
  const out: MessageReaction[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const userId = String((item as { userId?: unknown }).userId ?? "").trim();
    const emoji = String((item as { emoji?: unknown }).emoji ?? "").trim();
    if (!userId || !emoji) continue;
    out.push({ userId, emoji });
  }
  return out;
}

export function parseMessageReactionPush(
  data: Record<string, unknown> | undefined | null,
): ReactionPatch | null {
  const raw = unwrapReaction(data);
  if (!raw) return null;
  const conversationId = String(raw.conversationId ?? "").trim();
  const messageId = String(raw.messageId ?? "").trim();
  if (!conversationId || !messageId) return null;
  return {
    conversationId,
    messageId,
    reactions: parseReactionsField(raw.reactions),
  };
}

export function parseConversationReceiptPush(
  data: Record<string, unknown> | undefined | null,
): ReceiptPatch | null {
  const raw = unwrapReceipt(data);
  if (!raw) return null;
  const conversationId = String(raw.conversationId ?? "").trim();
  const at = String(raw.at ?? "").trim();
  if (!conversationId || !at) return null;
  return {
    conversationId,
    kind: raw.kind === "read" ? "read" : "delivered",
    at,
  };
}

function unwrapTypedPush(
  data: Record<string, unknown> | undefined | null,
  type: string,
): Record<string, unknown> | null {
  if (!data || typeof data !== "object") return null;
  if (data.type === type) return data;
  const body = data.body;
  if (typeof body === "string" && body.startsWith("{")) {
    try {
      const parsed = JSON.parse(body) as Record<string, unknown>;
      if (parsed?.type === type) return parsed;
    } catch {
      return null;
    }
  }
  return null;
}

export function parseConversationTypingPush(
  data: Record<string, unknown> | undefined | null,
): TypingPatch | null {
  const raw = unwrapTypedPush(data, "conversation_typing");
  if (!raw) return null;
  const conversationId = String(raw.conversationId ?? "").trim();
  if (!conversationId) return null;
  const onRaw = raw.on;
  const on = !(onRaw === false || onRaw === 0 || onRaw === "0");
  return {
    conversationId,
    fromName: String(raw.fromName ?? "").trim(),
    on,
  };
}

export function parseMoneyUpdatedPush(
  data: Record<string, unknown> | undefined | null,
): MoneyUpdatedPatch | null {
  const raw = unwrapTypedPush(data, "money_updated");
  if (!raw) return null;
  const conversationId = String(raw.conversationId ?? "").trim();
  const transferId = String(raw.transferId ?? "").trim();
  if (!conversationId || !transferId) return null;
  return {
    conversationId,
    transferId,
    status: String(raw.status ?? "").trim(),
    claimedByFirstName: String(raw.claimedByFirstName ?? "").trim(),
    claimedByUserId: String(raw.claimedByUserId ?? "").trim(),
    thanksFirstName: String(raw.thanksFirstName ?? "").trim(),
    thanksUserId: String(raw.thanksUserId ?? "").trim(),
    claimedAt: String(raw.claimedAt ?? "").trim(),
  };
}

export function parseMoneyTrayPush(
  data: Record<string, unknown> | undefined | null,
): MoneyTrayPatch | null {
  const claimed = unwrapTypedPush(data, "money_claimed");
  const thanks = unwrapTypedPush(data, "money_thanks");
  const raw = claimed ?? thanks;
  if (!raw) return null;
  const conversationId = String(raw.conversationId ?? "").trim();
  const transferId = String(raw.transferId ?? "").trim();
  if (!conversationId || !transferId) return null;
  const kind: MoneyTrayKind = claimed ? "claimed" : "thanks";
  const fromName =
    String(raw.fromName ?? "").trim() ||
    String(raw.thanksFirstName ?? "").trim() ||
    String(raw.claimedByName ?? "").trim() ||
    String(raw.claimedByFirstName ?? "").trim();
  return { kind, conversationId, transferId, fromName };
}
