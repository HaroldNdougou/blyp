/**
 * Monte le JS de tous les onglets dès que possible — clic tab = pas d’attente chunk Metro.
 */
import { DEV_METRO_LITE } from "@/lib/perf/devMetroLite";
import { prefetchModule, prefetchModuleThen } from "@/lib/perf/prefetchModule";

export function floodAllTabs(_token: string | null): void {
  if (DEV_METRO_LITE) return;
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
}
