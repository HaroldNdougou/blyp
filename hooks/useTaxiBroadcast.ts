import type { TaxiBroadcastAccount } from "@/lib/ble/taxiBroadcastController";
import {
  attemptTaxiBroadcastRecovery,
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
 * `wantOn` = intent utilisateur (reste actif sauf coupure manuelle).
 */
export function useTaxiBroadcast(account: TaxiBroadcastAccount) {
  const [snap, setSnap] = useState(getTaxiBroadcastSnapshot);

  useEffect(() => subscribeTaxiBroadcast(setSnap), []);

  const setEnabled = useCallback(
    (enabled: boolean): Promise<TaxiBroadcastSetResult> =>
      setTaxiBroadcastEnabled(enabled, account),
    [account.accountId, account.phone, account.category],
  );

  const retryRecovery = useCallback(
    (): Promise<TaxiBroadcastSetResult> =>
      attemptTaxiBroadcastRecovery({ forcePrompt: true }),
    [],
  );

  return {
    on: snap.on,
    wantOn: snap.wantOn,
    interrupted: snap.interrupted,
    status: snap.status,
    busy: snap.busy,
    setEnabled,
    retryRecovery,
  };
}
