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
