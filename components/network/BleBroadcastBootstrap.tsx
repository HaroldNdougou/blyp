import { subscribeBleForegroundStop } from "@/lib/ble/foregroundService";
import {
  DEV_BACKGROUND_BOOT_MS,
  runAfterDevBackgroundBoot,
} from "@/lib/perf/devMetroLite";
import { useEffect } from "react";
import { InteractionManager, Platform } from "react-native";

/**
 * Écoute notif « Arrêter » + init état diffusion (jamais sur splash).
 * BLE chargé en dynamic import (évite bundle `advertise` au cold start dev).
 */
export function BleBroadcastBootstrap() {
  useEffect(() => {
    if (Platform.OS === "web") return;

    const initBle = () => {
      void import("@/lib/ble/taxiBroadcastController").then((m) => {
        m.resetTaxiBroadcastUiOnMount();
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

    return () => {
      task.cancel?.();
      unsubStop();
    };
  }, []);

  return null;
}
