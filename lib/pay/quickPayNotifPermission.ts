import { Platform } from "react-native";

/** Android 13+ — sans accord, startForeground peut échouer silencieusement. */
export async function ensureQuickPayNotificationPermission(): Promise<boolean> {
  if (Platform.OS !== "android") return true;
  try {
    const Notifications = await import("expo-notifications");
    const current = await Notifications.getPermissionsAsync();
    if (current.granted || current.status === "granted") return true;
    const asked = await Notifications.requestPermissionsAsync();
    return asked.granted || asked.status === "granted";
  } catch {
    return false;
  }
}
