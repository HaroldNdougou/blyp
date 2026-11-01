import i18n from "@/lib/i18n";
import * as Notifications from "expo-notifications";
import * as Speech from "expo-speech";
import { Platform } from "react-native";

const RECOVERY_CATEGORY = "BLYP_BROADCAST_RECOVERY";
const ANDROID_CHANNEL = "broadcast_recovery";
const RECOVERY_NOTIF_ID = "blyp-broadcast-recovery";

let categoryReady = false;
let lastSpokenGeneration = -1;
let lastNotifiedGeneration = -1;

async function ensureRecoveryCategory(): Promise<void> {
  if (categoryReady) return;
  categoryReady = true;
  await Notifications.setNotificationCategoryAsync(RECOVERY_CATEGORY, [
    {
      identifier: "REACTIVATE",
      buttonTitle: i18n.t("profile.broadcastReactivate"),
      options: { opensAppToForeground: true },
    },
  ]);
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL, {
      name: i18n.t("commerce.onlineLabel"),
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 220, 120, 220],
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    });
  }
}

function speechLocale(): string {
  return i18n.language === "fr" ? "fr-FR" : "en-US";
}

/** Alerte insistante quand la radio coupe alors que l’utilisateur reste « En ligne ». */
export async function notifyBroadcastInterrupted(generation: number): Promise<void> {
  if (generation <= lastNotifiedGeneration) return;
  lastNotifiedGeneration = generation;

  await ensureRecoveryCategory();

  if (generation > lastSpokenGeneration) {
    lastSpokenGeneration = generation;
    Speech.stop();
    Speech.speak(i18n.t("profile.broadcastInterruptedSpeech"), {
      language: speechLocale(),
    });
  }

  await Notifications.scheduleNotificationAsync({
    identifier: RECOVERY_NOTIF_ID,
    content: {
      title: i18n.t("profile.broadcastInterruptedTitle"),
      body: i18n.t("profile.broadcastInterruptedBody"),
      categoryIdentifier: RECOVERY_CATEGORY,
      data: { kind: "broadcast_recovery" },
      sticky: Platform.OS === "android",
      priority: Notifications.AndroidNotificationPriority.HIGH,
      ...(Platform.OS === "android" ? { channelId: ANDROID_CHANNEL } : {}),
    },
    trigger: null,
  });
}

export async function dismissBroadcastRecoveryNotification(): Promise<void> {
  try {
    await Notifications.dismissNotificationAsync(RECOVERY_NOTIF_ID);
  } catch {
    /* best effort */
  }
}

export function isBroadcastRecoveryNotificationResponse(
  response: Notifications.NotificationResponse,
): boolean {
  const data = response.notification.request.content.data as
    | { kind?: string }
    | undefined;
  if (data?.kind === "broadcast_recovery") return true;
  return response.actionIdentifier === "REACTIVATE";
}
