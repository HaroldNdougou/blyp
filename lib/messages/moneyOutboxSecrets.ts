/**
 * Credentials pour renvoi 💰 / fruit money hors ligne — SecureStore uniquement.
 */
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

export type MoneyOutboxMeta = {
  idempotencyKey: string;
  replyToMessageId?: string | null;
  caption?: string | null;
  moneyFruitEmoji?: string | null;
  receiptRequired?: boolean;
};

function pinKey(clientId: string) {
  return `blyp.money.outbox.pin.${clientId}`;
}

function metaKey(clientId: string) {
  return `blyp.money.outbox.meta.${clientId}`;
}

export async function storeMoneyOutboxSecrets(
  clientId: string,
  pin: string,
  meta: MoneyOutboxMeta,
): Promise<void> {
  const id = String(clientId ?? "").trim();
  if (!id || Platform.OS === "web") return;
  try {
    await SecureStore.setItemAsync(pinKey(id), pin);
    await SecureStore.setItemAsync(metaKey(id), JSON.stringify(meta));
  } catch {
    /* best effort */
  }
}

export async function readMoneyOutboxSecrets(
  clientId: string,
): Promise<{ pin: string; meta: MoneyOutboxMeta } | null> {
  const id = String(clientId ?? "").trim();
  if (!id || Platform.OS === "web") return null;
  try {
    const pin = await SecureStore.getItemAsync(pinKey(id));
    const raw = await SecureStore.getItemAsync(metaKey(id));
    if (!pin || !raw) return null;
    const meta = JSON.parse(raw) as MoneyOutboxMeta;
    if (!meta?.idempotencyKey?.trim()) return null;
    return { pin, meta };
  } catch {
    return null;
  }
}

export async function clearMoneyOutboxSecrets(clientId: string): Promise<void> {
  const id = String(clientId ?? "").trim();
  if (!id || Platform.OS === "web") return;
  try {
    await SecureStore.deleteItemAsync(pinKey(id));
    await SecureStore.deleteItemAsync(metaKey(id));
  } catch {
    /* ignore */
  }
}
