import type { BleAdvertiseStatus } from "@/lib/ble/types";
import { openBleAppSettings } from "@/lib/ble/openBleSettings";
import { blypAlert } from "@/lib/ui/blypAlert";
import type { TFunction } from "i18next";

/** Message Alert pour échec diffusion (En ligne / Profil). */
export function broadcastFailureAlertMessage(
  t: TFunction,
  status: BleAdvertiseStatus,
  message?: string,
): string {
  if (status === "denied") return t("profile.broadcastDenied");
  if (status === "unavailable") return t("profile.broadcastUnavailable");
  if (status === "powered_off") return t("profile.broadcastOffBt");
  if (message === "INVALID_ACCOUNT") return t("profile.broadcastInvalidAccount");
  if (message === "TIMEOUT" || message === "BROADCAST_TIMEOUT") {
    return t("profile.broadcastTimeout");
  }
  if (message && __DEV__) {
    return `${t("profile.broadcastError")}\n${message}`;
  }
  return t("profile.broadcastError");
}

function shouldOfferSettings(status: BleAdvertiseStatus, message?: string): boolean {
  if (message === "INVALID_ACCOUNT") return false;
  return (
    status === "denied" ||
    status === "powered_off" ||
    status === "unavailable"
  );
}

/** Alerte après échec « En ligne » — bouton réglages si permissions / BT / GPS. */
export function showBroadcastFailureAlert(
  t: TFunction,
  title: string,
  status: BleAdvertiseStatus,
  message?: string,
): void {
  const body = broadcastFailureAlertMessage(t, status, message);
  if (!shouldOfferSettings(status, message)) {
    blypAlert(title, body);
    return;
  }
  blypAlert(title, body, [
    { text: t("common.cancel"), style: "cancel" },
    {
      text: t("messages.openAppSettings"),
      onPress: () => {
        void openBleAppSettings();
      },
    },
  ]);
}
