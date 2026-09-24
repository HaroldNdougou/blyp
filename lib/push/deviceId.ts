import * as SecureStore from "expo-secure-store";

const KEY = "blyp_push_device_id";

/** Identifiant stable par installation (SecureStore). */
export async function getOrCreatePushDeviceId(): Promise<string> {
  try {
    const existing = await SecureStore.getItemAsync(KEY);
    if (existing) return existing;
  } catch {
    /* ignore */
  }
  const id = `d_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  try {
    await SecureStore.setItemAsync(KEY, id);
  } catch {
    /* ignore */
  }
  return id;
}
