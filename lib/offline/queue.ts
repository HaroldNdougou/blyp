/**
 * File d’attente offline (point 4) — rejoue les ops à la reconnexion.
 * PIN pay : SecureStore uniquement (jamais en clair dans SQLite).
 */
import { getDb } from "@/lib/db/sqlite";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

export type OfflineOpType = "pay" | "deposit_refresh";

export type OfflineOp = {
  id: string;
  type: OfflineOpType;
  payload: Record<string, unknown>;
  createdAt: string;
  attempts: number;
};

function pinSecureKey(opId: string) {
  return `blyp.offline.pay.pin.${opId}`;
}

async function storePayPin(opId: string, pin: string): Promise<void> {
  if (Platform.OS === "web") return;
  try {
    await SecureStore.setItemAsync(pinSecureKey(opId), pin);
  } catch {
    /* best effort */
  }
}

export async function readPayPin(opId: string): Promise<string | null> {
  if (Platform.OS === "web") return null;
  try {
    return await SecureStore.getItemAsync(pinSecureKey(opId));
  } catch {
    return null;
  }
}

async function clearPayPin(opId: string): Promise<void> {
  if (Platform.OS === "web") return;
  try {
    await SecureStore.deleteItemAsync(pinSecureKey(opId));
  } catch {
    /* ignore */
  }
}

export async function enqueueOfflineOp(
  type: OfflineOpType,
  payload: Record<string, unknown>,
): Promise<string> {
  const db = await getDb();
  const id = `opq-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const createdAt = new Date().toISOString();
  const safePayload = { ...payload };
  if (type === "pay" && typeof safePayload.transactionPin === "string") {
    await storePayPin(id, safePayload.transactionPin);
    delete safePayload.transactionPin;
  }
  if (!db) return id;
  await db.runAsync(
    `INSERT INTO offline_queue (id, type, payload, createdAt, attempts)
     VALUES (?, ?, ?, ?, 0)`,
    id,
    type,
    JSON.stringify(safePayload),
    createdAt,
  );
  return id;
}

export async function listOfflineOps(): Promise<OfflineOp[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.getAllAsync<{
    id: string;
    type: string;
    payload: string;
    createdAt: string;
    attempts: number;
  }>(`SELECT * FROM offline_queue ORDER BY createdAt ASC LIMIT 50`);
  return rows.map((r) => ({
    id: r.id,
    type: r.type as OfflineOpType,
    payload: JSON.parse(r.payload) as Record<string, unknown>,
    createdAt: r.createdAt,
    attempts: r.attempts,
  }));
}

export async function removeOfflineOp(id: string): Promise<void> {
  const db = await getDb();
  await clearPayPin(id);
  if (!db) return;
  await db.runAsync(`DELETE FROM offline_queue WHERE id = ?`, id);
}

export async function bumpOfflineOpAttempt(id: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.runAsync(
    `UPDATE offline_queue SET attempts = attempts + 1 WHERE id = ?`,
    id,
  );
}
