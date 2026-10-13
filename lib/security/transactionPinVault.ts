/**
 * PIN transaction en SecureStore, lisible uniquement après auth appareil (TEE / Keychain).
 * Jamais en SQLite ni AsyncStorage.
 */
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

import { canUseDeviceAuth } from "@/lib/security/deviceAuth";

const VAULT_KEY = "blyp.vault.transactionPin.v1";

function vaultOptions(prompt: string): SecureStore.SecureStoreOptions {
  return {
    requireAuthentication: true,
    authenticationPrompt: prompt,
  };
}

export async function saveTransactionPinVault(pin: string): Promise<void> {
  if (Platform.OS === "web") return;
  const normalized = String(pin).replace(/\D/g, "");
  if (normalized.length !== 4) return;
  if (!(await canUseDeviceAuth())) return;
  try {
    await SecureStore.setItemAsync(
      VAULT_KEY,
      normalized,
      vaultOptions(""),
    );
  } catch {
    /* pas de biométrie / stockage refusé */
  }
}

/** Une invite système ; retourne le PIN si déverrouillage OK. */
export async function tryUnlockTransactionPinVault(
  prompt: string,
): Promise<string | null> {
  if (Platform.OS === "web") return null;
  if (!(await canUseDeviceAuth())) return null;
  try {
    const raw = await SecureStore.getItemAsync(VAULT_KEY, vaultOptions(prompt));
    const pin = String(raw ?? "").replace(/\D/g, "");
    return pin.length === 4 ? pin : null;
  } catch {
    return null;
  }
}

export async function clearTransactionPinVault(): Promise<void> {
  if (Platform.OS === "web") return;
  try {
    await SecureStore.deleteItemAsync(VAULT_KEY);
  } catch {
    /* ignore */
  }
}
