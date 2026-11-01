import type { BleAdvertiseStatus } from "@/lib/ble/types";
import { attemptTaxiBroadcastRecovery } from "@/lib/ble/taxiBroadcastController";
import { openBleAppSettings } from "@/lib/ble/openBleSettings";
import { blypAlert } from "@/lib/ui/blypAlert";
import type { TFunction } from "i18next";

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
    return `${t("profile.broadcastInterruptedBody")}\n${message}`;
  }
  return t("profile.broadcastInterruptedBody");
}

function shouldOfferSettings(status: BleAdvertiseStatus, message?: string): boolean {
  if (message === "INVALID_ACCOUNT") return false;
  return (
    status === "denied" ||
    status === "powered_off" ||
    status === "unavailable"
  );
}

export function showBroadcastFailureAlert(
  t: TFunction,
  title: string,
  status: BleAdvertiseStatus,
  message?: string,
): void {
  const body = broadcastFailureAlertMessage(t, status, message);
  const buttons = [
    { text: t("common.cancel"), style: "cancel" as const },
    ...(shouldOfferSettings(status, message)
      ? [
          {
            text: t("messages.openAppSettings"),
            onPress: () => {
              void openBleAppSettings();
            },
          },
        ]
      : []),
    {
      text: t("profile.broadcastReactivate"),
      onPress: () => {
        void attemptTaxiBroadcastRecovery({ forcePrompt: true });
      },
    },
  ];
  blypAlert(title, body, buttons);
}
