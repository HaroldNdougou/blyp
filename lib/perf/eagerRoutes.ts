/**
 * Side-effects : prefetch onglets + écrans fréquents (Pay = accueil).
 * En __DEV__ : rien ici — voir `devMetroLite` + `prefetchModule`.
 */
import { DEV_METRO_LITE } from "@/lib/perf/devMetroLite";
import { floodAllTabs } from "@/lib/perf/floodAllTabs";
import { prefetchModule, prefetchModuleThen } from "@/lib/perf/prefetchModule";

if (!DEV_METRO_LITE) {
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
  prefetchModule(() => import("@/lib/image/pickFromLibrary"));
  floodAllTabs(null);
}
