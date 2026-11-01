import { subscribeBleForegroundStop } from "@/lib/ble/foregroundService";
import {
  isBroadcastRecoveryNotificationResponse,
} from "@/lib/ble/broadcastRecoveryNotify";
import {
  DEV_BACKGROUND_BOOT_MS,
  runAfterDevBackgroundBoot,
} from "@/lib/perf/devMetroLite";
import { waitForAppActive } from "@/lib/app/waitForAppActive";
import * as Notifications from "expo-notifications";
import { useEffect } from "react";
import { AppState, InteractionManager, Platform } from "react-native";

/**
 * Écoute notif « Arrêter » + init état diffusion (jamais sur splash).
 * Relance auto si l’OS coupe la radio alors que l’utilisateur reste « En ligne ».
 */
export function BleBroadcastBootstrap() {
  useEffect(() => {
    if (Platform.OS === "web") return;

    const initBle = () => {
      void import("@/lib/ble/taxiBroadcastController").then((m) => {
        void m.bootstrapTaxiBroadcastState();
      });
    };

    const task = InteractionManager.runAfterInteractions(() => {
      if (DEV_BACKGROUND_BOOT_MS > 0) {
        runAfterDevBackgroundBoot(initBle);
      } else {
        initBle();
      }
    });

    const unsubStop = subscribeBleForegroundStop(() => {
      void import("@/lib/ble/taxiBroadcastController").then((m) => {
        m.stopTaxiBroadcastFromSystem();
      });
    });

    const retryIfWanted = () => {
      void import("@/lib/ble/taxiBroadcastController").then((m) => {
        const snap = m.getTaxiBroadcastSnapshot();
        if (snap.wantOn && !snap.on && !snap.busy) {
          void m.attemptTaxiBroadcastRecovery({ forcePrompt: false });
        }
      });
    };

    const appSub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        void waitForAppActive().then(retryIfWanted);
      }
    });

    const notifSub = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        if (!isBroadcastRecoveryNotificationResponse(response)) return;
        void import("@/lib/ble/taxiBroadcastController").then((m) => {
          void m.attemptTaxiBroadcastRecovery({ forcePrompt: true });
        });
      },
    );

    let btSub: { remove: () => void } | null = null;
    void (async () => {
      try {
        const { isBlePlxNativeAvailable } = await import(
          "@/lib/ble/nativeAvailable"
        );
        if (!isBlePlxNativeAvailable()) return;
        const { BleManager } = await import("react-native-ble-plx");
        const mgr = new BleManager();
        btSub = mgr.onStateChange((s) => {
          if (s === "PoweredOn") retryIfWanted();
        }, true);
      } catch {
        /* ignore */
      }
    })();

    return () => {
      task.cancel?.();
      unsubStop();
      appSub.remove();
      notifSub.remove();
      btSub?.remove();
    };
  }, []);

  return null;
}
