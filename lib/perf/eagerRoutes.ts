/**
 * Side-effects : prefetch onglets + écrans fréquents (Messages = accueil).
 * En __DEV__ : graphe minimal au bundle Metro (évite EMFILE Windows).
 */
import { floodAllTabs } from "@/lib/perf/floodAllTabs";

if (__DEV__) {
  void import("@/app/(tabs)/index");
  void import("@/components/messages/ConversationsScreen");
} else {
  void import("@/app/(tabs)/index");
  void import("@/components/messages/ConversationsScreen");
  void import("@/app/(tabs)/pay");
  void import("@/components/pay/PayHomeScreen");
  void import("@/app/deposit");
  void import("@/app/(tabs)/history");
  void import("@/components/history/HistoryScreen");
  void import("@/components/history/preloadHistory").then((m) => {
    void m.preloadHistoryScreen();
  });
  void import("@/app/(tabs)/profile");
  void import("@/app/chat/[id]");
  void import("@/components/messages/ChatThreadScreen");
  void import("@/lib/messages/chatSounds").then((m) => m.prefetchChatSounds());
  void import("@/lib/messages/chatLongPressHaptic").then((m) =>
    m.prefetchChatLongPressHaptic(),
  );
  void import("@/lib/messages/chatSend").then((m) => m.prefetchChatMessaging());
  void import("@/lib/image/pickFromLibrary");
  floodAllTabs(null);
}
