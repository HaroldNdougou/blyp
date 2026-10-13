/**
 * Monte le JS de tous les onglets dès que possible — clic tab = pas d’attente chunk Metro.
 * Mémoire OK (règle produit) ; réseau / SQLite reste dans aggressiveWarm.
 */
export function floodAllTabs(token: string | null): void {
  void import("@/app/(tabs)/history");
  void import("@/app/(tabs)/messages");
  void import("@/app/(tabs)/profile");
  void import("@/app/deposit");
  void import("@/components/history/HistoryScreen");
  void import("@/components/history/preloadHistory").then((m) => {
    void m.preloadHistoryScreen();
  });
  void import("@/components/messages/ConversationsScreen");
  void import("@/components/messages/ChatThreadScreen");
  void import("@/app/chat/[id]");
  void import("@/components/pay/CommerceHomeScreen");
  void import("@/lib/messages/prefetchChatThread");
  void import("@/lib/messages/chatSend").then((m) => m.prefetchChatMessaging());
  if (token) {
    void import("@/app/pocket/[id]");
  }
}
