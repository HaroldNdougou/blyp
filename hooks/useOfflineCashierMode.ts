import {
  getOfflineCashierModeSnapshot,
  hydrateOfflineCashierModeOnce,
  isOfflineCashierActiveForCommerce,
  subscribeOfflineCashierMode,
} from "@/lib/commerce/offlineCashierMode";
import { useSyncExternalStore } from "react";

export function useOfflineCashierMode(commerceId: string | null): {
  active: boolean;
} {
  hydrateOfflineCashierModeOnce();

  const snap = useSyncExternalStore(
    subscribeOfflineCashierMode,
    getOfflineCashierModeSnapshot,
    getOfflineCashierModeSnapshot,
  );

  return {
    active: isOfflineCashierActiveForCommerce(commerceId) && snap.active,
  };
}
