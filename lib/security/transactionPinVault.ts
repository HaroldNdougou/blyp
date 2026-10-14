/**
 * PIN transaction en SecureStore (chiffré OS), déverrouillé via biométrie / code appareil.
 * Jamais en SQLite ni AsyncStorage.
 */
import {
  authenticateForPayment,
  canUseDeviceAuth,
} from "@/lib/security/deviceAuth";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const VAULT_KEY = "blyp.vault.transactionPin.v1";
const VAULT_FLAG_KEY = "blyp.vault.transactionPin.configured";

/** Évite l’empreinte si aucun PIN n’a encore été enregistré dans le coffre. */
export async function hasTransactionPinVault(): Promise<boolean> {
  if (Platform.OS === "web") return false;
  try {
    return (await SecureStore.getItemAsync(VAULT_FLAG_KEY)) === "1";
  } catch {
    return false;
  }
}

export async function saveTransactionPinVault(pin: string): Promise<void> {
  if (Platform.OS === "web") return;
  const normalized = String(pin).replace(/\D/g, "");
  if (normalized.length !== 4) return;
  if (!(await canUseDeviceAuth())) return;
  try {
    await SecureStore.setItemAsync(VAULT_KEY, normalized);
    await SecureStore.setItemAsync(VAULT_FLAG_KEY, "1");
  } catch {
    /* stockage refusé */
  }
}

/**
 * Une seule invite biométrique, puis lecture du PIN — uniquement si coffre configuré.
 */
export async function tryUnlockTransactionPinVault(
  prompt: string,
): Promise<string | null> {
  if (Platform.OS === "web") return null;
  if (!(await canUseDeviceAuth())) return null;
  if (!(await hasTransactionPinVault())) return null;
  const auth = await authenticateForPayment(prompt);
  if (auth !== "success") return null;
  try {
    const raw = await SecureStore.getItemAsync(VAULT_KEY);
    const pin = String(raw ?? "").replace(/\D/g, "");
    if (pin.length === 4) {
      try {
        await SecureStore.setItemAsync(VAULT_FLAG_KEY, "1");
      } catch {
        /* ignore */
      }
      return pin;
    }
    return null;
  } catch {
    return null;
  }
}

export async function clearTransactionPinVault(): Promise<void> {
  if (Platform.OS === "web") return;
  try {
    await SecureStore.deleteItemAsync(VAULT_KEY);
    await SecureStore.deleteItemAsync(VAULT_FLAG_KEY);
  } catch {
    /* ignore */
  }
}
