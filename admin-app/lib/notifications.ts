import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { api } from "./api";

Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const data = (notification.request.content.data ?? {}) as Record<string, unknown>;
    const eventType = String(data.eventType ?? "");
    const money =
      eventType === "deposit" ||
      eventType === "withdrawal" ||
      data.alarm === "1" ||
      data.alarm === 1;
    return {
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
      shouldShowBanner: true,
      shouldShowList: true,
      priority: money
        ? Notifications.AndroidNotificationPriority.MAX
        : Notifications.AndroidNotificationPriority.HIGH,
    };
  },
});

/** Canaux Android (secours si le natif n’a pas encore tourné). */
export async function ensureAndroidChannels(): Promise<void> {
  if (Platform.OS !== "android") return;
  await Notifications.deleteNotificationChannelAsync("blyp_money_alarm").catch(() => {});
  await Notifications.setNotificationChannelAsync("blyp_money_alarm_v2", {
    name: "Demandes d'argent",
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 900, 200, 900, 200, 900, 200, 900, 200, 1200, 300, 1200, 300, 1600],
    enableVibrate: true,
    sound: "default",
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    bypassDnd: true,
  });
  await Notifications.setNotificationChannelAsync("admin_alerts", {
    name: "Alertes Blyp",
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 250, 120, 250],
    lightColor: "#5dc705",
    sound: "default",
  });
}

export async function ensurePushRegistered(): Promise<{ ok: boolean; reason?: string }> {
  if (!Device.isDevice) return { ok: false, reason: "simulator" };

  await ensureAndroidChannels();

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
