import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { api } from "./api";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export async function ensurePushRegistered(): Promise<{ ok: boolean; reason?: string }> {
  if (!Device.isDevice) return { ok: false, reason: "simulator" };

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("admin_alerts", {
      name: "Alertes Blyp",
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 120, 250],
      lightColor: "#5dc705",
      sound: "default",
    });
  }

  const current = await Notifications.getPermissionsAsync();
  let status = current.status;
  if (status !== "granted") {
    const asked = await Notifications.requestPermissionsAsync();
    status = asked.status;
  }
  if (status !== "granted") return { ok: false, reason: "permission" };

  const tokenRes = await Notifications.getExpoPushTokenAsync();
  const token = tokenRes.data;
  await api("/api/device", {
    method: "POST",
    body: {
      token,
      platform: Platform.OS,
      deviceId: Device.modelId || Device.modelName || null,
    },
  });
  return { ok: true };
}

export async function unregisterPush(): Promise<void> {
  try {
    const tokenRes = await Notifications.getExpoPushTokenAsync();
    await api("/api/device", { method: "DELETE", body: { token: tokenRes.data } });
  } catch {
    /* ignore */
  }
}
