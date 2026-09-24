import Constants from "expo-constants";
import { Platform } from "react-native";
import { getOrCreatePushDeviceId } from "@/lib/push/deviceId";
import { lightColors } from "@/lib/theme/colors";

let lastRegisteredToken: string | null = null;

function projectId(): string | null {
  return (
    Constants.easConfig?.projectId ??
    (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)
      ?.eas?.projectId ??
    null
  );
}

function devWarn(msg: string, extra?: unknown): void {
  if (!__DEV__) return;
  if (extra !== undefined) console.warn(`[push] ${msg}`, extra);
  else console.warn(`[push] ${msg}`);
}

/**
 * Enregistre le token Expo côté API — après 1er frame Pay, best-effort.
 * Ne bloque jamais l’UI ; silence si permission refusée / Expo Go limité.
 * @returns true si un token a été enregistré (ou déjà à jour)
 */
export async function registerPushToken(accessToken: string): Promise<boolean> {
  if (Platform.OS === "web") return false;

  try {
    const Notifications = await import("expo-notifications");

    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("payments", {
        name: "Paiements",
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 100, 80, 100],
        lightColor: lightColors.accent,
        sound: "default",
      });
      await Notifications.setNotificationChannelAsync("messages", {
        name: "Messages",
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 80],
        lightColor: lightColors.accent,
        sound: "default",
      });
    }

    const current = await Notifications.getPermissionsAsync();
    let status = current.status;
    if (status !== "granted") {
      const asked = await Notifications.requestPermissionsAsync();
      status = asked.status;
    }
    if (status !== "granted") {
      devWarn("permission refusée", status);
      return false;
    }

    const pid = projectId();
    if (!pid) {
      devWarn("projectId EAS manquant");
      return false;
    }

    let expoToken: string;
    try {
      const res = await Notifications.getExpoPushTokenAsync({
        projectId: pid,
      });
      expoToken = res.data;
    } catch (e) {
      devWarn(
        "getExpoPushTokenAsync échoué — souvent FCM V1 manquant sur EAS",
        e,
      );
      return false;
    }
    if (!expoToken) {
      devWarn("token Expo vide");
      return false;
    }
    const deviceId = await getOrCreatePushDeviceId();
    const { registerDeviceToken } = await import("@/lib/api/client");
    await registerDeviceToken(accessToken, {
      token: expoToken,
      platform: Platform.OS,
      deviceId,
    });
    lastRegisteredToken = expoToken;
    devWarn("token enregistré", { platform: Platform.OS, deviceId });
    return true;
  } catch (e) {
    devWarn("registerPushToken error", e);
    return false;
  }
}

export async function unregisterPushToken(accessToken: string | null): Promise<void> {
  if (!accessToken || Platform.OS === "web") {
    lastRegisteredToken = null;
    return;
  }
  try {
    const deviceId = await getOrCreatePushDeviceId();
    const { unregisterDeviceToken } = await import("@/lib/api/client");
    await unregisterDeviceToken(accessToken, {
      token: lastRegisteredToken ?? undefined,
      deviceId,
    });
  } catch {
    /* best effort */
  } finally {
    lastRegisteredToken = null;
  }
}

export function resetPushRegistrationState(): void {
  lastRegisteredToken = null;
}
