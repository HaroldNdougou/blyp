/**
 * Side-effects : prefetch onglets + écrans fréquents (Messages = accueil).
 * En __DEV__ : rien ici — voir `devMetroLite` + `prefetchModule`.
 */
import { DEV_METRO_LITE } from "@/lib/perf/devMetroLite";
import { floodAllTabs } from "@/lib/perf/floodAllTabs";
import { prefetchModule, prefetchModuleThen } from "@/lib/perf/prefetchModule";

if (!DEV_METRO_LITE) {
  prefetchModule(() => import("@/app/(tabs)/index"));
  prefetchModule(() => import("@/components/messages/ConversationsScreen"));
  prefetchModule(() => import("@/app/(tabs)/pay"));
  prefetchModule(() => import("@/components/pay/PayHomeScreen"));
  prefetchModule(() => import("@/app/deposit"));
  prefetchModule(() => import("@/app/(tabs)/history"));
  prefetchModule(() => import("@/components/history/HistoryScreen"));
  prefetchModuleThen(
    () => import("@/components/history/preloadHistory"),
    (m) => {
      void m.preloadHistoryScreen();
    },
  );
  prefetchModule(() => import("@/app/(tabs)/profile"));
  prefetchModule(() => import("@/app/actus"));
  prefetchModule(() => import("@/components/status/ActusScreen"));
  prefetchModule(() => import("@/app/chat/[id]"));
  prefetchModule(() => import("@/components/messages/ChatThreadScreen"));
  prefetchModule(() => import("@/components/messages/ChatThreadScreenBody"));
  prefetchModuleThen(() => import("@/lib/messages/chatSounds"), (m) =>
    m.prefetchChatSounds(),
  );
  prefetchModuleThen(
    () => import("@/lib/messages/chatLongPressHaptic"),
    (m) => m.prefetchChatLongPressHaptic(),
  );
  prefetchModuleThen(() => import("@/lib/messages/chatSend"), (m) =>
    m.prefetchChatMessaging(),
  );
  prefetchModule(() => import("@/lib/messages/chatRealtimeLink"));
  prefetchModule(() => import("@/lib/image/pickFromLibrary"));
  prefetchModule(() => import("@/app/status/create"));
  prefetchModule(() => import("@/app/status/view"));
  floodAllTabs(null);
}
