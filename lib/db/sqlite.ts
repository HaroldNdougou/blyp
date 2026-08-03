/**
 * SQLite local (point 3) — source de vérité téléphone pour TX / queue / curseur sync.
 * Ouverture lazy : n’impacte pas le cold start Pay.
 */
import { Platform } from "react-native";

type SqliteMod = typeof import("expo-sqlite");
type Db = Awaited<ReturnType<SqliteMod["openDatabaseAsync"]>>;

let dbPromise: Promise<Db | null> | null = null;

async function openDb(): Promise<Db | null> {
  if (Platform.OS === "web") return null;
  try {
    const SQLite = await import("expo-sqlite");
    const db = await SQLite.openDatabaseAsync("blyp.db");
    await db.execAsync(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS transactions (
        phone TEXT NOT NULL,
        id TEXT NOT NULL,
        type TEXT NOT NULL,
        amountFcfa INTEGER NOT NULL,
        counterpartyName TEXT NOT NULL,
        counterpartyPhone TEXT,
        createdAt TEXT NOT NULL,
        reference TEXT,
        PRIMARY KEY (phone, id)
      );
      CREATE INDEX IF NOT EXISTS idx_tx_phone_created
        ON transactions(phone, createdAt DESC);
      CREATE TABLE IF NOT EXISTS sync_meta (
        phone TEXT PRIMARY KEY,
        cursor TEXT
      );
      CREATE TABLE IF NOT EXISTS offline_queue (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        payload TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0
      );
    `);
    try {
      await db.execAsync(
        `ALTER TABLE transactions ADD COLUMN reference TEXT`,
      );
    } catch {
      /* colonne déjà présente */
    }
    return db;
  } catch {
    return null;
  }
}

export function getDb(): Promise<Db | null> {
  if (!dbPromise) dbPromise = openDb();
  return dbPromise;
}
