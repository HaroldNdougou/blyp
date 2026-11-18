import { syncAnnouncePrefNative } from "@/lib/push/announceNative";
import { resolveAppLanguage } from "@/lib/i18n/locale";
import * as SecureStore from "expo-secure-store";

const KEY = "blyp_announce_payments_v1";

/** Cache RAM — lecture sync ultra-légère après 1er hydrate. */
let cached: boolean | null = null;
let hydratePromise: Promise<boolean> | null = null;

/**
 * Préférence « annoncer les paiements » — défaut ON.
 * SecureStore + RAM ; jamais sur le chemin splash.
 */
export function getAnnouncePaymentsCached(): boolean {
  return cached === true;
}

export async function hydrateAnnouncePaymentsPref(): Promise<boolean> {
  if (cached !== null) return cached;
  if (hydratePromise) return hydratePromise;
  hydratePromise = (async () => {
    try {
      const v = await SecureStore.getItemAsync(KEY);
      cached = v !== "0";
    } catch {
      cached = true;
    }
    void syncAnnouncePrefNative(cached === true, resolveAppLanguage());
    return cached;
  })();
  try {
    return await hydratePromise;
  } finally {
    hydratePromise = null;
  }
}

export async function setAnnouncePaymentsPref(enabled: boolean): Promise<void> {
  cached = enabled;
  try {
    await SecureStore.setItemAsync(KEY, enabled ? "1" : "0");
  } catch {
    /* best effort */
  }
  void syncAnnouncePrefNative(enabled, resolveAppLanguage());
}
