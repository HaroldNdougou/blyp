/**
 * Prefetch ULTRA agressif : modules JS tout de suite, réseau après 1er frame.
 */
import { InteractionManager } from "react-native";

let warmed = false;

function warmJsModules(token: string | null): void {
  void import("@/app/deposit");
  void import("@/app/(tabs)/history");
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

  /** Modules : immédiat (pas d’InteractionManager — trop tard si clic rapide). */
  warmJsModules(token);

  InteractionManager.runAfterInteractions(() => {
    if (!token || !phone) return;
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
