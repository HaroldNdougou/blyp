import * as Notifications from "expo-notifications";
import { Platform, Vibration } from "react-native";

const VIBE = [0, 900, 200, 900, 200, 900, 200, 900, 200, 1200, 300, 1200, 300, 1600];

export function moneyLine(kind: "deposit" | "withdrawal", amount: number, phone: string) {
  const digits = phone.replace(/\D/g, "");
  const nine = digits.length > 9 ? digits.slice(-9) : digits;
  const shown =
    nine.length === 9 ? nine.replace(/(\d{3})(\d{2})(\d{2})(\d{2})/, "$1 $2 $3 $4") : phone;
  const label = kind === "deposit" ? "Recharge demandée" : "Retrait demandé";
  return shown ? `${label} ${amount}F · ${shown}` : `${label} ${amount}F`;
}

export async function ringMoney(title: string) {
  Vibration.vibrate(VIBE, false);
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("blyp_money_alarm", {
      name: "Demandes d'argent",
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: VIBE,
      enableVibrate: true,
      sound: "default",
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      bypassDnd: true,
    }).catch(() => {});
  }
  await Notifications.scheduleNotificationAsync({
    content: {
      title,
      body: title,
      sound: "default",
      vibrate: VIBE,
      priority: Notifications.AndroidNotificationPriority.MAX,
      sticky: true,
      data: { channelId: "blyp_money_alarm" },
    },
    trigger: null,
  }).catch(() => {});
}
