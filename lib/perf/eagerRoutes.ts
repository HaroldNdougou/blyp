/**
 * Side-effects : prefetch onglets + écrans fréquents (Messages = accueil).
 * En __DEV__ : graphe minimal — pas de rafale Metro au lancement USB.
 */
import { floodAllTabs } from "@/lib/perf/floodAllTabs";
import { prefetchModule, prefetchModuleThen } from "@/lib/perf/prefetchModule";
import { InteractionManager } from "react-native";

if (__DEV__) {
  /** Accueil = ConversationsScreen (import sync dans index). Fil chat après stabilisation. */
  InteractionManager.runAfterInteractions(() => {
    setTimeout(() => {
      prefetchModule(() => import("@/app/chat/[id]"));
      prefetchModule(() => import("@/components/messages/ChatThreadScreen"));
      prefetchModule(() => import("@/components/messages/ChatThreadScreenBody"));
    }, 3000);
  });
} else {
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
