/**
 * Prefetch : modules UI après parse ; hydrate SQLite tôt ;
 * client API / sync réseau seulement APRÈS le 1er frame (ne pas voler Pay).
 */
import { floodAllTabs } from "@/lib/perf/floodAllTabs";
import { prefetchModule, prefetchModuleThen } from "@/lib/perf/prefetchModule";
import { InteractionManager } from "react-native";

let warmed = false;

function warmJsModules(token: string | null): void {
  prefetchModule(() => import("@/app/deposit"));
  prefetchModule(() => import("@/app/(tabs)/history"));
  prefetchModule(() => import("@/components/history/HistoryScreen"));
  prefetchModuleThen(
    () => import("@/components/history/preloadHistory"),
    (m) => {
      void m.preloadHistoryScreen();
    },
  );
  prefetchModuleThen(() => import("@expo/vector-icons"), (m) => {
    void m.Ionicons.loadFont().catch(() => {});
  });
  prefetchModule(() => import("@/components/pay/PayRegisterOverlay"));
  prefetchModule(() => import("@/app/(tabs)/index"));
  prefetchModule(() => import("@/app/(tabs)/pay"));
  prefetchModule(() => import("@/components/messages/ConversationsScreen"));
  prefetchModule(() => import("@/components/messages/ChatThreadScreen"));
  prefetchModule(() => import("@/components/messages/ChatThreadScreenBody"));
  prefetchModule(() => import("@/app/chat/[id]"));
  prefetchModule(() => import("@/lib/messages/prefetchChatThread"));
  prefetchModuleThen(() => import("@/lib/messages/chatSend"), (m) =>
    m.prefetchChatMessaging(),
  );
  prefetchModuleThen(() => import("@/lib/image/pickFromLibrary"), (m) =>
    m.warmImageLibraryPermission(),
  );
  if (token) {
    prefetchModule(() => import("@/app/(tabs)/profile"));
  }
}

export function runAggressiveWarm(opts: {
  token: string | null;
  phone?: string;
}): void {
  if (warmed) return;
  warmed = true;

  const { token, phone } = opts;

  if (__DEV__) {
    /** Metro + Redmi : pas de flood chunks / SQLite / réseau ici (voir eagerRoutes). */
    return;
  }

  warmJsModules(token);
  floodAllTabs(token);

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
      } catch {
        /* best effort */
      }
    })();
  }

  InteractionManager.runAfterInteractions(() => {
    if (token) {
      prefetchModuleThen(() => import("@/lib/api/client"), (m) =>
        m.ensureSessionFresh(),
      );
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
          } = await api.listMessages(token, c.id, { limit: 40 });
          const prev = cache.getMessagesSnapshot(token, c.id) ?? [];
          const { mergeRecentThreadPull } = await import(
            "@/lib/messages/mergeThreadPull"
          );
          cache.applyServerMessagesSnapshot(
            token,
            c.id,
            mergeRecentThreadPull(prev, msgs),
          );
          cache.setReceiptsSnapshot(c.id, {
            peerLastReadAt: peerLastReadAt ?? null,
            peerLastDeliveredAt: peerLastDeliveredAt ?? null,
          });
          const { markThreadMessagesPulled } = await import(
            "@/lib/messages/threadPullGate"
          );
          markThreadMessagesPulled(c.id);
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
