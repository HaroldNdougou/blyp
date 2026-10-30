/**
 * SQLite local (point 3) — source de vérité téléphone pour TX / queue / curseur sync.
 * Ouverture lazy : n’impacte pas le cold start Pay.
 * Écritures sérialisées : expo-sqlite refuse les transactions imbriquées / concurrentes.
 */
import { Platform } from "react-native";

type SqliteMod = typeof import("expo-sqlite");
export type Db = Awaited<ReturnType<SqliteMod["openDatabaseAsync"]>>;

let dbPromise: Promise<Db | null> | null = null;
/** Une seule opération SQLite à la fois (lecture ou écriture). */
let dbOpChain: Promise<unknown> = Promise.resolve();

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function withBusyRetry<T>(fn: () => Promise<T>): Promise<T> {
  const max = 6;
  for (let i = 0; i < max; i++) {
    try {
      return await fn();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!/database is locked|SQLITE_BUSY/i.test(msg) || i === max - 1) {
        throw e;
      }
      await sleep(35 * (i + 1));
    }
  }
  throw new Error("sqlite busy retry exhausted");
}

function enqueueDbOp<T>(fn: (db: Db) => Promise<T>): Promise<T | null> {
  const task = dbOpChain
    .then(async () => {
      const db = await getDb();
      if (!db) return null;
      return withBusyRetry(() => fn(db));
    })
    .catch((e) => {
      if (__DEV__) {
        console.warn("[sqlite]", e instanceof Error ? e.message : e);
      }
      return null;
    });
  dbOpChain = task.then(
    () => undefined,
    () => undefined,
  );
  return task;
}

async function openDb(): Promise<Db | null> {
  if (Platform.OS === "web") return null;
  try {
    const SQLite = await import("expo-sqlite");
    const db = await SQLite.openDatabaseAsync("blyp.db");
    /** Connexion restée ouverte (reload Metro) / checkpoint WAL : attendre au lieu de « database is locked ». */
    await db.execAsync(`PRAGMA busy_timeout = 15000;`);
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
      CREATE TABLE IF NOT EXISTS merchant_receipts (
        accountId TEXT NOT NULL,
        id TEXT NOT NULL,
        name TEXT NOT NULL,
        merchantName TEXT,
        category TEXT NOT NULL,
        localUri TEXT NOT NULL,
        contentType TEXT NOT NULL,
        sizeBytes INTEGER NOT NULL,
        createdAt TEXT NOT NULL,
        PRIMARY KEY (accountId, id)
      );
      CREATE INDEX IF NOT EXISTS idx_receipts_account_created
        ON merchant_receipts(accountId, createdAt DESC);
      CREATE TABLE IF NOT EXISTS media_disk_lru (
        path TEXT PRIMARY KEY,
        namespace TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        last_access INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_media_disk_lru_access
        ON media_disk_lru(last_access ASC);
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
 * Lecture SQLite — même file que les écritures (évite « database is locked »).
 */
export function runDbRead<T>(fn: (db: Db) => Promise<T>): Promise<T | null> {
  return enqueueDbOp(fn);
}

/**
 * Exécute `fn` hors concurrence avec les autres accès DB.
 * À utiliser pour toute mutation (transaction ou runAsync).
 */
export function runDbWrite<T>(fn: (db: Db) => Promise<T>): Promise<T | null> {
  return enqueueDbOp(fn);
}
