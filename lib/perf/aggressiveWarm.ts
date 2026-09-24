/**
 * Prefetch : modules UI après parse ; hydrate SQLite tôt ;
 * client API / sync réseau seulement APRÈS le 1er frame (ne pas voler Pay).
 */
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
  if (token) {
    void import("@/app/(tabs)/profile");
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

  /** Cache tx RAM (SQLite) — léger, sert Historique ; ne parse pas api/client. */
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
    })();
  });
}

export function resetAggressiveWarm(): void {
  warmed = false;
}
