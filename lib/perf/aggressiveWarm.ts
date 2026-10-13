/**
 * Prefetch : modules UI après parse ; hydrate SQLite tôt ;
 * client API / sync réseau seulement APRÈS le 1er frame (ne pas voler Pay).
 */
import { floodAllTabs } from "@/lib/perf/floodAllTabs";
import { InteractionManager } from "react-native";

let warmed = false;

function warmJsModules(token: string | null): void {
  void import("@/app/deposit");
  void import("@/app/(tabs)/history");
  void import("@/components/history/HistoryScreen");
  void import("@/components/history/preloadHistory").then((m) => {
    void m.preloadHistoryScreen();
  });
  void import("@expo/vector-icons").then((m) => {
    void m.Ionicons.loadFont().catch(() => {});
  });
  void import("@/components/pay/PayRegisterOverlay");
  void import("@/app/(tabs)/messages");
  void import("@/components/messages/ConversationsScreen");
  void import("@/components/messages/ChatThreadScreen");
  void import("@/app/chat/[id]");
  void import("@/lib/messages/prefetchChatThread");
  void import("@/lib/messages/chatSend").then((m) => m.prefetchChatMessaging());
  void import("@/lib/image/pickFromLibrary").then((m) =>
    m.warmImageLibraryPermission(),
  );
  if (token) {
    void import("@/app/(tabs)/profile");
    void import("@/app/pocket/[id]");
  }
}

export function runAggressiveWarm(opts: {
  token: string | null;
  phone?: string;
}): void {
  if (warmed) return;
  warmed = true;

  const { token, phone } = opts;

  /** Modules écrans : OK en parallèle léger — pas le gros client API. */
  warmJsModules(token);
  floodAllTabs(token);

  /** Cache tx + messages RAM (SQLite) — léger ; ne parse pas api/client. */
  if (token && phone) {
    void (async () => {
      try {
        const { hydrateTransactionsCache, getTransactionsSnapshot } =
          await import("@/lib/transactionsCache");
        await hydrateTransactionsCache(phone);
        const snap = getTransactionsSnapshot(phone);
        if (snap) {
          const { ensureHistoryUiRows } = await import(
            "@/lib/history/historyUiCache"
          );
          ensureHistoryUiRows(phone, snap);
        }
        const { hydrateMessagesCache } = await import("@/lib/messagesCache");
        await hydrateMessagesCache(phone, token);
        const { hydrateSpendCategories } = await import(
          "@/lib/peers/peerCategoryCache"
        );
        await hydrateSpendCategories();
        const { startQuickAmountsEngine } = await import(
          "@/lib/pay/quickAmounts"
        );
        startQuickAmountsEngine(phone);
        const { hydratePockets } = await import("@/lib/pockets/store");
        await hydratePockets(phone);
      } catch {
        /* best effort */
      }
    })();
  }

  /** Après 1er frame Pay uniquement : API client + JWT + sync. */
  InteractionManager.runAfterInteractions(() => {
    if (token) {
      void import("@/lib/api/client")
        .then((m) => m.ensureSessionFresh())
        .catch(() => {
          /* réseau / session — silencieux */
        });
    }
    if (!token || !phone) return;
    void (async () => {
      try {
        const { syncTransactionsFromNetwork } = await import(
          "@/lib/sync/transactionsSync"
        );
        await syncTransactionsFromNetwork(token, phone);
      } catch {
        /* best effort */
      }
      void import("@/lib/pockets/store")
        .then((m) => m.syncPocketsFromNetwork(token, phone))
        .catch(() => {});
      try {
        const api = await import("@/lib/api/client");
        const cache = await import("@/lib/messagesCache");
        const { items } = await api.listConversations(token);
        cache.setConversationsSnapshot(token, items);
        for (const c of items.slice(0, 5)) {
          const {
            items: msgs,
            peerLastReadAt,
            peerLastDeliveredAt,
          } = await api.listMessages(token, c.id);
          cache.applyServerMessagesSnapshot(token, c.id, msgs);
          cache.setReceiptsSnapshot(c.id, {
            peerLastReadAt: peerLastReadAt ?? null,
            peerLastDeliveredAt: peerLastDeliveredAt ?? null,
          });
        }
      } catch {
        /* best effort */
      }
    })();
  });
}

export function resetAggressiveWarm(): void {
  warmed = false;
}
