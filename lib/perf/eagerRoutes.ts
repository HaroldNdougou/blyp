/**
 * Cold start : Pay seulement. Historique / profil / dépôt → après 1er frame (aggressiveWarm).
 */
import { DEV_METRO_LITE } from "@/lib/perf/devMetroLite";
import { prefetchModule } from "@/lib/perf/prefetchModule";

if (!DEV_METRO_LITE) {
  prefetchModule(() => import("@/app/(tabs)/pay"));
  prefetchModule(() => import("@/components/pay/PayHomeScreen"));
  prefetchModule(() => import("@/components/pay/CommerceHomeScreen"));
}
