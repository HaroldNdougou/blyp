/**
 * Prefetch : modules UI après parse ; hydrate SQLite tôt ;
 * client API / sync réseau seulement APRÈS le 1er frame (ne pas voler Pay).
 */
import { DEV_METRO_LITE } from "@/lib/perf/devMetroLite";
import { floodAllTabs } from "@/lib/perf/floodAllTabs";
import { prefetchModule, prefetchModuleThen } from "@/lib/perf/prefetchModule";
import { InteractionManager } from "react-native";

let warmed = false;

function warmJsModules(token: string | null): void {
  prefetchModule(() => import("@/components/pay/PayRegisterOverlay"));
  prefetchModule(() => import("@/app/(tabs)/pay"));
  if (token) {
    prefetchModule(() => import("@/components/pay/CommerceHomeScreen"));
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
    return;
  }

  warmJsModules(token);
  floodAllTabs(token);
  if (!DEV_METRO_LITE) {
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
    prefetchModuleThen(() => import("@/lib/image/pickFromLibrary"), (m) =>
      m.warmImageLibraryPermission(),
    );
  }

  if (token && phone) {
    void import("@/lib/media/lruDiskCache").then((m) =>
      m.trimMediaDiskCacheIfNeeded(),
    );
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
        await syncTransactionsFromNetwork(token, phone, { reason: "warm" });
      } catch {
        /* best effort */
      }
    })();
  });
}

export function resetAggressiveWarm(): void {
  warmed = false;
}
