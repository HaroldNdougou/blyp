import {
  DEV_BACKGROUND_BOOT_MS,
  DEV_METRO_LITE,
} from "@/lib/perf/devMetroLite";
import { useAuth } from "@/contexts/authContextBase";
import { useNetwork } from "@/contexts/NetworkContext";
import { useEffect, useRef } from "react";
import { AppState, InteractionManager, type AppStateStatus } from "react-native";

/** Filet sync solde / historique — pas le chemin pay (push + delta local d’abord). */
const POLL_MS = 180_000;
/** Juste après 1er frame Pay — sync fond sans délai « prudent ». */
const BOOT_DELAY_MS = DEV_BACKGROUND_BOOT_MS > 0 ? DEV_BACKGROUND_BOOT_MS : 120;

/**
 * Sync fond (filet) — le push couvre l’instantané « paiement reçu » :
 * - boot différé (après 1er frame Pay)
 * - retour foreground / reconnect (throttle global 3 min)
 * - poll rare app active
 */
export function RealtimeSync() {
  const { reconnectGeneration } = useNetwork();
  const { token, user, refreshUser } = useAuth();
  const phone = user?.phone ?? "";
  const lastReconnect = useRef(0);
  const appState = useRef(AppState.currentState);

  /** Purge pub BLE orpheline (reload natif) — une fois, pas à chaque Profil. */
  useEffect(() => {
    if (DEV_METRO_LITE) return;
    const task = InteractionManager.runAfterInteractions(() => {
      void import("@/lib/ble/advertise").then((m) => {
        m.purgeOrphanTaxiBroadcastOnce();
      });
    });
    return () => task.cancel?.();
  }, []);

  useEffect(() => {
    if (!token || !phone) return;

    let cancelled = false;

    const run = (reason: "boot" | "poll" | "foreground" | "reconnect") => {
      void (async () => {
        try {
          const { syncTransactionsFromNetwork } = await import(
            "@/lib/sync/transactionsSync"
          );
          if (cancelled) return;
          if (reason === "reconnect" || reason === "foreground") {
            await refreshUser();
          }
          if (cancelled) return;
          await syncTransactionsFromNetwork(token, phone, { reason });
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
      bootTask.cancel?.();
      sub.remove();
      clearInterval(poll);
    };
  }, [token, phone, reconnectGeneration, refreshUser]);

  return null;
}
