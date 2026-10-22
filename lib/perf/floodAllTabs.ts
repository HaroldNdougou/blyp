/**
 * Monte le JS de tous les onglets dès que possible — clic tab = pas d’attente chunk Metro.
 * Mémoire OK (règle produit) ; réseau / SQLite reste dans aggressiveWarm.
 */
import { prefetchModule, prefetchModuleThen } from "@/lib/perf/prefetchModule";

export function floodAllTabs(_token: string | null): void {
  prefetchModule(() => import("@/app/(tabs)/index"));
  prefetchModule(() => import("@/app/(tabs)/pay"));
  prefetchModule(() => import("@/components/pay/PayHomeScreen"));
  prefetchModule(() => import("@/components/pay/CommerceHomeScreen"));
  prefetchModule(() => import("@/app/(tabs)/history"));
  prefetchModule(() => import("@/app/(tabs)/profile"));
  prefetchModule(() => import("@/app/deposit"));
  prefetchModule(() => import("@/components/history/HistoryScreen"));
  prefetchModuleThen(
    () => import("@/components/history/preloadHistory"),
    (m) => {
      void m.preloadHistoryScreen();
    },
  );
  prefetchModule(() => import("@/components/messages/ConversationsScreen"));
  prefetchModule(() => import("@/app/actus"));
  prefetchModule(() => import("@/components/status/ActusScreen"));
  prefetchModule(() => import("@/components/messages/ChatThreadScreen"));
  prefetchModule(() => import("@/components/messages/ChatThreadScreenBody"));
  prefetchModule(() => import("@/app/chat/[id]"));
  prefetchModule(() => import("@/lib/messages/prefetchChatThread"));
  prefetchModuleThen(() => import("@/lib/messages/chatSend"), (m) =>
    m.prefetchChatMessaging(),
  );
}
