import {
  resetTaxiBroadcastUiOnMount,
  stopTaxiBroadcastFromSystem,
} from "@/lib/ble/taxiBroadcastController";
import { subscribeBleForegroundStop } from "@/lib/ble/foregroundService";
import { useEffect } from "react";
import { InteractionManager, Platform } from "react-native";

/**
 * Écoute notif « Arrêter » + init état diffusion (jamais sur splash).
 */
export function BleBroadcastBootstrap() {
  useEffect(() => {
    if (Platform.OS === "web") return;

    const task = InteractionManager.runAfterInteractions(() => {
      resetTaxiBroadcastUiOnMount();
    });

    const unsubStop = subscribeBleForegroundStop(() => {
      stopTaxiBroadcastFromSystem();
    });

    return () => {
      task.cancel?.();
      unsubStop();
    };
  }, []);

  return null;
}
