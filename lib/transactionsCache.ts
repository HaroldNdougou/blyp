import type { TransactionItem } from "@/lib/api/types";
import { clearHistoryUiCache, rememberHistoryUi } from "@/lib/history/historyUiCache";
import { getDb } from "@/lib/db/sqlite";
import { fallbackTxReference } from "@/lib/txReference";

function publishUi(phone: string, items: TransactionItem[]) {
  rememberHistoryUi(phone, items);
}

/** RAM — lecture sync après hydrate. Clé = phone. */
const byPhone = new Map<string, TransactionItem[]>();
const cursorByPhone = new Map<string, string | null>();
const hydratePromises = new Map<string, Promise<void>>();

function listsEqual(a: TransactionItem[], b: TransactionItem[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (
      x.id !== y.id ||
      x.amountFcfa !== y.amountFcfa ||
      x.type !== y.type ||
      x.createdAt !== y.createdAt
    ) {
      return false;
    }
  }
  return true;
}

function sortTx(items: TransactionItem[]): TransactionItem[] {
  return [...items].sort((a, b) =>
    String(b.createdAt).localeCompare(String(a.createdAt)),
  );
}

/** Merge delta dans le cache (plus récent en tête). */
export function mergeTransactionsDelta(
  phone: string,
  delta: TransactionItem[],
): TransactionItem[] {
  if (!phone) return [];
  const prev = byPhone.get(phone) ?? [];
  if (delta.length === 0) return prev;
  const map = new Map<string, TransactionItem>();
  for (const t of prev) map.set(t.id, t);
  for (const t of delta) map.set(t.id, t);
  const next = sortTx([...map.values()]).slice(0, 200);
  if (listsEqual(prev, next)) return prev;
  void persistPhone(phone, next);
  byPhone.set(phone, next);
  publishUi(phone, next);
  return next;
}

async function persistPhone(phone: string, items: TransactionItem[]) {
  const db = await getDb();
  if (!db) return;
  await db.withTransactionAsync(async () => {
    await db.runAsync(`DELETE FROM transactions WHERE phone = ?`, phone);
    for (const t of items) {
      await db.runAsync(
        `INSERT INTO transactions
          (phone, id, type, amountFcfa, counterpartyName, counterpartyPhone, createdAt, reference)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        phone,
        t.id,
        t.type,
        t.amountFcfa,
        t.counterpartyName,
        t.counterpartyPhone,
        t.createdAt,
        t.reference || fallbackTxReference(t.id),
      );
    }
  });
}

export function hydrateTransactionsCache(phone: string): Promise<void> {
  if (!phone) return Promise.resolve();
  const existing = hydratePromises.get(phone);
  if (existing) return existing;

  const p = (async () => {
    if (byPhone.has(phone)) return;
    const db = await getDb();
    if (!db) return;
    const rows = await db.getAllAsync<{
      id: string;
      type: string;
      amountFcfa: number;
      counterpartyName: string;
      counterpartyPhone: string | null;
      createdAt: string;
      reference: string | null;
    }>(
      `SELECT id, type, amountFcfa, counterpartyName, counterpartyPhone, createdAt, reference
       FROM transactions WHERE phone = ? ORDER BY createdAt DESC LIMIT 200`,
      phone,
    );
    if (!byPhone.has(phone) && rows.length > 0) {
      const items = rows.map((r) => ({
        id: r.id,
        reference: r.reference || fallbackTxReference(r.id),
        type: r.type as "sent" | "received",
        amountFcfa: r.amountFcfa,
        counterpartyName: r.counterpartyName,
        counterpartyPhone: r.counterpartyPhone,
        createdAt: r.createdAt,
      }));
      byPhone.set(phone, items);
      publishUi(phone, items);
    }
    const meta = await db.getFirstAsync<{ cursor: string | null }>(
      `SELECT cursor FROM sync_meta WHERE phone = ?`,
      phone,
    );
    if (meta?.cursor) cursorByPhone.set(phone, meta.cursor);
  })().finally(() => {
    hydratePromises.delete(phone);
  });

  hydratePromises.set(phone, p);
  return p;
}

export function setTransactionsSnapshot(
  phone: string,
  items: TransactionItem[],
) {
  if (!phone) return;
  const sorted = sortTx(items).slice(0, 200);
  const prev = byPhone.get(phone);
  if (prev && listsEqual(prev, sorted)) {
    publishUi(phone, prev);
    return;
  }
  byPhone.set(phone, sorted);
  publishUi(phone, sorted);
  void persistPhone(phone, sorted);
  const cursor = sorted[0]?.createdAt ?? null;
  if (cursor) void setSyncCursor(phone, cursor);
}

export function getTransactionsSnapshot(
  phone: string,
): TransactionItem[] | null {
  if (!phone) return null;
  const v = byPhone.get(phone);
  return v !== undefined ? v : null;
}

export function getSyncCursor(phone: string): string | null {
  if (!phone) return null;
  return cursorByPhone.get(phone) ?? null;
}

export async function setSyncCursor(
  phone: string,
  cursor: string | null,
): Promise<void> {
  if (!phone) return;
  cursorByPhone.set(phone, cursor);
  const db = await getDb();
  if (!db) return;
  if (cursor) {
    await db.runAsync(
      `INSERT OR REPLACE INTO sync_meta (phone, cursor) VALUES (?, ?)`,
      phone,
      cursor,
    );
  }
}

export function clearTransactionsSnapshot(phone: string) {
  byPhone.delete(phone);
  cursorByPhone.delete(phone);
  clearHistoryUiCache(phone);
  void (async () => {
    const db = await getDb();
    if (!db) return;
    await db.runAsync(`DELETE FROM transactions WHERE phone = ?`, phone);
    await db.runAsync(`DELETE FROM sync_meta WHERE phone = ?`, phone);
  })();
}

export function clearAllTransactionsSnapshots() {
  byPhone.clear();
  cursorByPhone.clear();
  clearHistoryUiCache();
  void (async () => {
    const db = await getDb();
    if (!db) return;
    await db.execAsync(`DELETE FROM transactions; DELETE FROM sync_meta;`);
  })();
}
