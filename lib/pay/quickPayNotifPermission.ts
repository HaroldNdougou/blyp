import { Platform } from "react-native";

export async function hasQuickPayNotificationPermission(): Promise<boolean> {
  if (Platform.OS !== "android") return true;
  try {
    const Notifications = await import("expo-notifications");
    const current = await Notifications.getPermissionsAsync();
    return current.granted || current.status === "granted";
  } catch {
    return false;
  }
}

/**
 * @param requestIfNeeded — `true` uniquement quand l’utilisateur active le switch Profil.
 */
export async function ensureQuickPayNotificationPermission(
  requestIfNeeded = true,
): Promise<boolean> {
  if (Platform.OS !== "android") return true;
  if (await hasQuickPayNotificationPermission()) return true;
  if (!requestIfNeeded) return false;
  try {
    const Notifications = await import("expo-notifications");
    const asked = await Notifications.requestPermissionsAsync();
    return asked.granted || asked.status === "granted";
  } catch {
    return false;
  }
}
