/**
 * Side-effects : tire Dépôt / Historique / Profil dans le même graphe que Pay.
 * Clic immédiat après reload — pas d’attente Metro/chunk (cœur business).
 * Ne bloque PAS le splash (import async void, après parse de ce module).
 */
void import("@/app/deposit");
void import("@/app/(tabs)/history");
void import("@/components/history/HistoryScreen");
void import("@/components/history/preloadHistory").then((m) => {
  void m.preloadHistoryScreen();
});
void import("@/app/(tabs)/profile");
void import("@/app/(tabs)/messages");
void import("@/components/messages/ConversationsScreen");
void import("@/app/chat/[id]");
void import("@/components/messages/ChatThreadScreen");
void import("@/lib/messages/chatSounds").then((m) => m.prefetchChatSounds());
void import("@/lib/messages/chatLongPressHaptic").then((m) =>
  m.prefetchChatLongPressHaptic(),
);
void import("@/lib/messages/chatSend").then((m) => m.prefetchChatMessaging());
void import("@/lib/image/pickFromLibrary");
import { floodAllTabs } from "@/lib/perf/floodAllTabs";

/** Tous les onglets dans le graphe au parse (token inconnu → routes publiques). */
floodAllTabs(null);
