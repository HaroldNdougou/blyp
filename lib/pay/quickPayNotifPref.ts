import * as SecureStore from "expo-secure-store";

const KEY = "blyp_quick_pay_notif_v1";

let cached: boolean | null = null;

export function getQuickPayNotifCached(): boolean {
  return cached === true;
}

export async function hydrateQuickPayNotifPref(): Promise<boolean> {
  if (cached !== null) return cached;
  try {
    cached = (await SecureStore.getItemAsync(KEY)) === "1";
  } catch {
    cached = false;
  }
  return cached;
}

export async function setQuickPayNotifPref(enabled: boolean): Promise<void> {
  cached = enabled;
  try {
    if (enabled) await SecureStore.setItemAsync(KEY, "1");
    else await SecureStore.deleteItemAsync(KEY);
  } catch {
    /* best effort */
  }
}

export async function clearQuickPayNotifPref(): Promise<void> {
  cached = false;
  try {
    await SecureStore.deleteItemAsync(KEY);
  } catch {
    /* ignore */
  }
}
