import { NativeEventEmitter, NativeModules, Platform } from "react-native";

type Listener = (conversationId: string) => void;

const listeners = new Set<Listener>();
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
      const incoming = parseMessagePush(
        n.request.content.data as Record<string, unknown>,
      );
      if (incoming?.conversationId !== conversationId) continue;
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

export function notifyIncomingMessage(
  conversationId: string,
  messageId?: string,
): void {
  const id = String(conversationId ?? "").trim();
  if (!id) return;
  if (!isViewingConversation(id)) {
    void import("@/lib/messages/unread").then((m) => {
      m.bumpUnread(id, messageId);
    });
  }
  for (const cb of listeners) cb(id);
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
  em.addListener("blyp_message_received", (id: string) => {
    notifyIncomingMessage(String(id ?? ""));
  });
}

function unwrapPushData(
  data: Record<string, unknown> | undefined | null,
): Record<string, unknown> | null {
  if (!data || typeof data !== "object") return null;
  if (data.type === "message_received") return data;
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

export function parseMessagePush(
  data: Record<string, unknown> | undefined | null,
): { conversationId: string; messageId: string; fromName: string } | null {
  const raw = unwrapPushData(data);
  if (!raw) return null;
  const conversationId = String(raw.conversationId ?? "").trim();
  if (!conversationId) return null;
  return {
    conversationId,
    messageId: String(raw.messageId ?? "").trim(),
    fromName: String(raw.fromName ?? "").trim() || "Blyp",
  };
}
