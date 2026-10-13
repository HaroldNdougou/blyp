/**
 * Catégorie commerce d’un pair (taxi / boutique / autre) — RAM + SQLite.
 * Lecture sync pour les puces Pay ; écriture lazy.
 */
import type { SpendCategory } from "@/lib/pay/spendCategory";
import { normalizeSpendCategory } from "@/lib/pay/spendCategory";
import { getDb, runDbWrite } from "@/lib/db/sqlite";
import { Platform } from "react-native";

const byAccount = new Map<string, SpendCategory>();
const byPhone = new Map<string, SpendCategory>();
let tableReady: Promise<void> | null = null;
let hydratedAll = false;

function normAccount(accountId: string): string {
  return String(accountId ?? "")
    .trim()
    .toUpperCase();
}

function normPhone(phone: string): string {
  return String(phone ?? "").replace(/\D/g, "").slice(-9);
}

async function ensureTable(): Promise<void> {
  if (Platform.OS === "web") return;
  if (!tableReady) {
    tableReady = (async () => {
      const db = await getDb();
      if (!db) return;
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS spend_categories (
          key TEXT PRIMARY KEY NOT NULL,
          category TEXT NOT NULL,
          updatedAt TEXT NOT NULL
        );
      `);
    })().catch(() => {
      tableReady = null;
    });
  }
  await tableReady;
}

function persist(key: string, category: SpendCategory): void {
  void (async () => {
    try {
      await ensureTable();
      await runDbWrite(async (db) => {
        await db.runAsync(
          `INSERT INTO spend_categories (key, category, updatedAt)
           VALUES (?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET
             category = excluded.category,
             updatedAt = excluded.updatedAt`,
          key,
          category,
          new Date().toISOString(),
        );
      });
    } catch {
      /* best effort */
    }
  })();
}

/** Charge toute la table une fois — 100 lignes max, hors 1er frame. */
export async function hydrateSpendCategories(): Promise<void> {
  if (hydratedAll || Platform.OS === "web") return;
  try {
    await ensureTable();
    const db = await getDb();
    if (!db) return;
    const rows = await db.getAllAsync<{ key: string; category: string }>(
      `SELECT key, category FROM spend_categories`,
    );
    for (const row of rows ?? []) {
      const cat = normalizeSpendCategory(row.category);
      if (!cat) continue;
      const k = String(row.key ?? "");
      if (k.startsWith("a:")) byAccount.set(k.slice(2), cat);
      else if (k.startsWith("p:")) byPhone.set(k.slice(2), cat);
    }
    hydratedAll = true;
  } catch {
    /* best effort */
  }
}

export function getPeerCategoryCached(accountId: string): SpendCategory | null {
  const id = normAccount(accountId);
  if (!id) return null;
  return byAccount.get(id) ?? null;
}

export function getCategoryByPhoneCached(phone: string): SpendCategory | null {
  const p = normPhone(phone);
  if (p.length !== 9) return null;
  return byPhone.get(p) ?? null;
}

export function rememberPeerCategory(
  accountId: string,
  category: SpendCategory | string | null | undefined,
  phone?: string | null,
): void {
  const cat = normalizeSpendCategory(category);
  if (!cat) return;
  const id = normAccount(accountId);
  if (id && byAccount.get(id) !== cat) {
    byAccount.set(id, cat);
    persist(`a:${id}`, cat);
  }
  const p = phone ? normPhone(phone) : "";
  if (p.length === 9 && byPhone.get(p) !== cat) {
    byPhone.set(p, cat);
    persist(`p:${p}`, cat);
  }
}
