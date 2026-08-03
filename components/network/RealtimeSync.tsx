import { useAuth } from "@/contexts/AuthContext";
import { useNetwork } from "@/contexts/NetworkContext";
import { useEffect, useRef } from "react";
import { AppState, InteractionManager, type AppStateStatus } from "react-native";

const POLL_MS = 45_000;
/** Juste après 1er frame Pay — sync fond sans délai « prudent ». */
const BOOT_DELAY_MS = 120;

/**
 * Sync « push-like » sans FCM pour l’instant :
 * - boot différé (après 1er frame Pay)
 * - retour foreground
 * - reconnect réseau
 * - poll léger app active
 * + drain file offline.
 */
export function RealtimeSync() {
  const { reconnectGeneration } = useNetwork();
  const { token, user, refreshUser } = useAuth();
  const phone = user?.phone ?? "";
  const lastReconnect = useRef(0);
  const appState = useRef(AppState.currentState);

  useEffect(() => {
    if (!token || !phone) return;

    let cancelled = false;

    const run = (reason: string) => {
      void (async () => {
        try {
          const [{ syncTransactionsFromNetwork }, { drainOfflineQueue }] =
            await Promise.all([
              import("@/lib/sync/transactionsSync"),
              import("@/lib/offline/drainQueue"),
            ]);
          if (cancelled) return;
          if (reason === "reconnect" || reason === "foreground") {
            await refreshUser();
          }
          if (cancelled) return;
          await syncTransactionsFromNetwork(token, phone);
          if (cancelled) return;
          await drainOfflineQueue({ token, phone });
        } catch {
          /* silencieux */
        }
      })();
    };

    const bootTask = InteractionManager.runAfterInteractions(() => {
      setTimeout(() => {
        if (!cancelled) run("boot");
      }, BOOT_DELAY_MS);
    });

    if (
      reconnectGeneration > 0 &&
      reconnectGeneration !== lastReconnect.current
    ) {
      lastReconnect.current = reconnectGeneration;
      run("reconnect");
    }

    const onApp = (next: AppStateStatus) => {
      if (
        appState.current.match(/inactive|background/) &&
        next === "active"
      ) {
        run("foreground");
      }
      appState.current = next;
    };
    const sub = AppState.addEventListener("change", onApp);

    const poll = setInterval(() => {
      if (AppState.currentState === "active") run("poll");
    }, POLL_MS);

    return () => {
      cancelled = true;
      bootTask.cancel();
      sub.remove();
      clearInterval(poll);
    };
  }, [token, phone, reconnectGeneration, refreshUser]);

  return null;
}
