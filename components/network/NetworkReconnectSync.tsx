import { useAuth } from "@/contexts/AuthContext";
import { useNetwork } from "@/contexts/NetworkContext";
import { setTransactionsSnapshot } from "@/lib/transactionsCache";
import { useEffect, useRef } from "react";

/** Refresh silencieux solde + historique au retour du réseau (best effort). */
export function NetworkReconnectSync() {
  const { reconnectGeneration } = useNetwork();
  const { token, refreshUser } = useAuth();
  const lastSyncedGen = useRef(0);

  useEffect(() => {
    if (reconnectGeneration <= 0 || reconnectGeneration === lastSyncedGen.current) {
      return;
    }
    if (!token) return;

    lastSyncedGen.current = reconnectGeneration;
    let cancelled = false;

    void (async () => {
      try {
        await refreshUser();
        if (cancelled) return;
        const { listTransactions } = await import("@/lib/api/client");
        const { items } = await listTransactions(token);
        if (!cancelled) setTransactionsSnapshot(token, items);
      } catch {
        /* best effort — pas de popup */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [reconnectGeneration, token, refreshUser]);

  return null;
}
