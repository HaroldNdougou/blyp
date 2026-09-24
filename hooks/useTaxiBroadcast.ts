import type { TaxiBroadcastAccount } from "@/lib/ble/taxiBroadcastController";
import {
  getTaxiBroadcastSnapshot,
  setTaxiBroadcastEnabled,
  subscribeTaxiBroadcast,
} from "@/lib/ble/taxiBroadcastController";
import type { BleAdvertiseStatus } from "@/lib/ble/types";
import { useCallback, useEffect, useState } from "react";

export type TaxiBroadcastSetResult = {
  status: BleAdvertiseStatus;
  message?: string;
};

/**
 * Interrupteur diffusion taxi / commerce — état global partagé (Commerce + Profil).
 * Arrière-plan : foreground service Android (notif « En ligne »).
 */
export function useTaxiBroadcast(account: TaxiBroadcastAccount) {
  const [snap, setSnap] = useState(getTaxiBroadcastSnapshot);

  useEffect(() => subscribeTaxiBroadcast(setSnap), []);

  const setEnabled = useCallback(
    (enabled: boolean): Promise<TaxiBroadcastSetResult> =>
      setTaxiBroadcastEnabled(enabled, account),
    [account.accountId, account.phone],
  );

  return { on: snap.on, status: snap.status, busy: snap.busy, setEnabled };
}
