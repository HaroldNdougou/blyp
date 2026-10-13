/**
 * SQLite local (point 3) — source de vérité téléphone pour TX / queue / curseur sync.
 * Ouverture lazy : n’impacte pas le cold start Pay.
 * Écritures sérialisées : expo-sqlite refuse les transactions imbriquées / concurrentes.
 */
import { Platform } from "react-native";

type SqliteMod = typeof import("expo-sqlite");
export type Db = Awaited<ReturnType<SqliteMod["openDatabaseAsync"]>>;

let dbPromise: Promise<Db | null> | null = null;
/** File d’écritures — une seule withTransactionAsync à la fois. */
let writeChain: Promise<void> = Promise.resolve();

async function openDb(): Promise<Db | null> {
  if (Platform.OS === "web") return null;
  try {
    const SQLite = await import("expo-sqlite");
    const db = await SQLite.openDatabaseAsync("blyp.db");
    /** Connexion restée ouverte (reload Metro) / checkpoint WAL : attendre au lieu de « database is locked ». */
    await db.execAsync(`PRAGMA busy_timeout = 4000;`);
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
      CREATE TABLE IF NOT EXISTS conversations (
        phone TEXT NOT NULL,
        id TEXT NOT NULL,
        json TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        PRIMARY KEY (phone, id)
      );
      CREATE INDEX IF NOT EXISTS idx_conv_phone_upd
        ON conversations(phone, updatedAt DESC);
      CREATE TABLE IF NOT EXISTS chat_messages (
        phone TEXT NOT NULL,
        conversationId TEXT NOT NULL,
        json TEXT NOT NULL,
        PRIMARY KEY (phone, conversationId)
      );
      CREATE TABLE IF NOT EXISTS chat_receipts (
        phone TEXT NOT NULL,
        conversationId TEXT NOT NULL,
        peerLastReadAt TEXT,
        peerLastDeliveredAt TEXT,
        PRIMARY KEY (phone, conversationId)
      );
      CREATE TABLE IF NOT EXISTS kv_cache (
        phone TEXT NOT NULL,
        key TEXT NOT NULL,
        json TEXT NOT NULL,
        PRIMARY KEY (phone, key)
      );
    `);
    try {
      await db.execAsync(
        `ALTER TABLE transactions ADD COLUMN reference TEXT`,
      );
    } catch {
      /* colonne déjà présente */
    }
    try {
      await db.execAsync(`ALTER TABLE transactions ADD COLUMN kind TEXT`);
      /** Colonne neuve : vieux cache sans `kind` → prochain sync = full replace. */
      await db.execAsync(`DELETE FROM sync_meta`);
    } catch {
      /* colonne déjà présente */
    }
    const ver = await db.getFirstAsync<{ user_version: number }>(
      `PRAGMA user_version`,
    );
    if ((ver?.user_version ?? 0) < 1) {
      /** Données serveur migrées : resync tx complet + fils re-téléchargés. */
      await db.execAsync(`
        DELETE FROM sync_meta;
        DELETE FROM chat_messages;
        PRAGMA user_version = 1;
      `);
    }
    if ((ver?.user_version ?? 0) < 2) {
      await db.execAsync(`
        DELETE FROM sync_meta;
        PRAGMA user_version = 2;
      `);
    }
    if ((ver?.user_version ?? 0) < 3) {
      await db.execAsync(`
        DELETE FROM sync_meta;
        PRAGMA user_version = 3;
      `);
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

/**
 * Exécute `fn` hors concurrence avec les autres écritures DB.
 * À utiliser pour toute mutation (transaction ou runAsync).
 */
export function runDbWrite<T>(fn: (db: Db) => Promise<T>): Promise<T | null> {
  const task = writeChain.then(async () => {
    const db = await getDb();
    if (!db) return null;
    return fn(db);
  });
  writeChain = task.then(
    () => undefined,
    () => undefined,
  );
  return task;
}
