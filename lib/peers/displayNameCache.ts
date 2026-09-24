/**
 * Noms d’affichage peers BLE (commerce / taxi) — cache RAM + SQLite.
 * Sync = instantané ; réseau en fond via resolvePeerDisplayName.
 */
import { getDb, runDbWrite } from "@/lib/db/sqlite";
import { Platform } from "react-native";

const ram = new Map<string, string>();
let tableReady: Promise<void> | null = null;

function normId(accountId: string): string {
  return String(accountId ?? "")
    .trim()
    .toUpperCase();
}

function normName(name: string): string {
  return String(name ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 48);
}

async function ensurePeerLabelsTable(): Promise<void> {
  if (Platform.OS === "web") return;
  if (!tableReady) {
    tableReady = (async () => {
      const db = await getDb();
      if (!db) return;
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS peer_labels (
          accountId TEXT PRIMARY KEY NOT NULL,
          displayName TEXT NOT NULL,
          updatedAt TEXT NOT NULL
        );
      `);
    })().catch(() => {
      tableReady = null;
    });
  }
  await tableReady;
}

/** Lecture sync RAM — 0 I/O. */
export function getPeerDisplayNameCached(accountId: string): string | null {
  const id = normId(accountId);
  if (!id) return null;
  return ram.get(id) ?? null;
}

/** Écrit RAM (+ SQLite lazy). Appelé après lookup réseau ou paiement. */
export function rememberPeerDisplayName(
  accountId: string,
  displayName: string,
): void {
  const id = normId(accountId);
  const name = normName(displayName);
  if (!id || name.length < 2) return;
  if (ram.get(id) === name) return;
  ram.set(id, name);
  void (async () => {
    try {
      await ensurePeerLabelsTable();
      await runDbWrite(async (db) => {
        await db.runAsync(
          `INSERT INTO peer_labels (accountId, displayName, updatedAt)
           VALUES (?, ?, ?)
           ON CONFLICT(accountId) DO UPDATE SET
             displayName = excluded.displayName,
             updatedAt = excluded.updatedAt`,
          id,
          name,
          new Date().toISOString(),
        );
      });
    } catch {
      /* best effort */
    }
  })();
}

/** Hydrate RAM depuis SQLite si besoin (1 Get). */
export async function hydratePeerDisplayName(
  accountId: string,
): Promise<string | null> {
  const id = normId(accountId);
  if (!id) return null;
  const hit = ram.get(id);
  if (hit) return hit;
  if (Platform.OS === "web") return null;
  try {
    await ensurePeerLabelsTable();
    const db = await getDb();
    if (!db) return null;
    const row = await db.getFirstAsync<{ displayName: string }>(
      `SELECT displayName FROM peer_labels WHERE accountId = ? LIMIT 1`,
      id,
    );
    const name = row?.displayName ? normName(row.displayName) : "";
    if (name.length < 2) return null;
    ram.set(id, name);
    return name;
  } catch {
    return null;
  }
}
