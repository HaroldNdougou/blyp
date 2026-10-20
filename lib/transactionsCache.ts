import type { TransactionItem } from "@/lib/api/types";
import { clearHistoryUiCache, rememberHistoryUi } from "@/lib/history/historyUiCache";
import { getDb, runDbWrite } from "@/lib/db/sqlite";
import { fallbackTxReference } from "@/lib/txReference";

type CacheListener = (phone: string, items: TransactionItem[]) => void;
const listeners = new Set<CacheListener>();

function publishUi(phone: string, items: TransactionItem[]) {
  rememberHistoryUi(phone, items);
  for (const l of listeners) l(phone, items);
}

/** RAM — lecture sync après hydrate. Clé = phone. */
const byPhone = new Map<string, TransactionItem[]>();
const cursorByPhone = new Map<string, string | null>();
const hydratePromises = new Map<string, Promise<void>>();

/** Historique / Pay : réagir au merge sans refetch (flash WhatsApp). */
export function subscribeTransactionsCache(listener: CacheListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function transactionSnapshotsEqual(
  a: TransactionItem[],
  b: TransactionItem[],
): boolean {
  return listsEqual(a, b);
}

function listsEqual(a: TransactionItem[], b: TransactionItem[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (
      x.id !== y.id ||
      x.amountFcfa !== y.amountFcfa ||
      x.type !== y.type ||
      (x.kind ?? null) !== (y.kind ?? null) ||
      x.createdAt !== y.createdAt
    ) {
      return false;
    }
  }
  return true;
}

/** Claim chat money : crédit du destinataire, comme un paiement reçu. */
function isClaimedMoneyLabel(name: string | null | undefined): boolean {
  return String(name ?? "").trim() === "Message Money";
}

const MONEY_REFUND_KINDS = new Set(["MONEY_RECALL", "MONEY_EXPIRE_REFUND"]);

/** Récupéré / expiré : l’argent revient au solde (vieux cache = libellé). */
function isMoneyRefund(t: TransactionItem): boolean {
  if (t.kind && MONEY_REFUND_KINDS.has(t.kind)) return true;
  return String(t.counterpartyName ?? "").trim().startsWith("Message Money (");
}

function coerceAmountFcfa(raw: unknown): number | null {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

/** SQLite exige `id` — certains vieux TX API n’en ont pas. */
function withStableTxId(t: TransactionItem): TransactionItem | null {
  const amountFcfa = coerceAmountFcfa(t.amountFcfa);
  if (amountFcfa === null) return null;
  const createdAt = String(t.createdAt ?? "").trim();
  if (!createdAt) return null;
  const id = String(t.id ?? "").trim();
  if (id) return { ...t, amountFcfa, createdAt };
  const ref = String(t.reference ?? "").trim();
  if (ref) return { ...t, id: ref, amountFcfa, createdAt };
  const type = t.type === "received" ? "received" : "sent";
  return {
    ...t,
    id: `tx-${createdAt}-${type}-${amountFcfa}`,
    amountFcfa,
    createdAt,
  };
}

function normalizeTransactionItem(t: TransactionItem): TransactionItem | null {
  const base = withStableTxId(t);
  if (!base) return null;
  const amountFcfa = coerceAmountFcfa(base.amountFcfa);
  if (amountFcfa === null) return null;
  const createdAt = String(base.createdAt ?? "").trim();
  if (!createdAt) return null;
  let type = base.type === "received" ? "received" : "sent";
  if (
    type === "sent" &&
    (isClaimedMoneyLabel(base.counterpartyName) || isMoneyRefund(base))
  ) {
    type = "received";
  }
  const counterpartyName = String(base.counterpartyName ?? "").trim() || "—";
  return {
    ...base,
    amountFcfa,
    createdAt,
    type,
    counterpartyName,
  };
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
  for (const t of prev) {
    const n = normalizeTransactionItem(t);
    if (n) map.set(n.id, n);
  }
  for (const t of delta) {
    const n = normalizeTransactionItem(t);
    if (n) map.set(n.id, n);
  }
  const next = sortTx([...map.values()]).slice(0, 200);
  if (listsEqual(prev, next)) return prev;
  byPhone.set(phone, next);
  const top = next[0]?.createdAt ?? null;
  if (top) {
    const cur = cursorByPhone.get(phone);
    if (!cur || top > cur) cursorByPhone.set(phone, top);
  }
  publishUi(phone, next);
  void persistPhone(phone, next);
  if (top) void setSyncCursor(phone, top);
  return next;
}

async function insertTxRow(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  phone: string,
  t: TransactionItem,
) {
  const id = String(t.id ?? "").trim();
  if (!id) return;
  const amountFcfa = coerceAmountFcfa(t.amountFcfa);
  if (amountFcfa === null) return;
  const createdAt = String(t.createdAt ?? "").trim();
  if (!createdAt) return;
  const type = t.type === "received" ? "received" : "sent";
  const counterpartyName = String(t.counterpartyName ?? "").trim() || "—";
  await db.runAsync(
    `INSERT INTO transactions
      (phone, id, type, amountFcfa, counterpartyName, counterpartyPhone, createdAt, reference, kind)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    phone,
    id,
    type,
    amountFcfa,
    counterpartyName,
    t.counterpartyPhone,
    createdAt,
    t.reference || fallbackTxReference(id),
    t.kind ?? null,
  );
}

async function persistPhone(phone: string, items: TransactionItem[]) {
  await runDbWrite(async (db) => {
    await db.withTransactionAsync(async () => {
      await db.runAsync(`DELETE FROM transactions WHERE phone = ?`, phone);
      for (const t of items) await insertTxRow(db, phone, t);
    });
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
      kind: string | null;
    }>(
      `SELECT id, type, amountFcfa, counterpartyName, counterpartyPhone, createdAt, reference, kind
       FROM transactions WHERE phone = ? ORDER BY createdAt DESC LIMIT 200`,
      phone,
    );
    if (!byPhone.has(phone) && rows.length > 0) {
      const items = rows
        .map((r) =>
          normalizeTransactionItem({
            id: r.id,
            reference: r.reference || fallbackTxReference(r.id),
            type: r.type as "sent" | "received",
            kind: r.kind ?? null,
            amountFcfa: r.amountFcfa,
            counterpartyName: r.counterpartyName,
            counterpartyPhone: r.counterpartyPhone,
            createdAt: r.createdAt,
          }),
        )
        .filter((x): x is TransactionItem => x !== null);
      byPhone.set(phone, items);
      publishUi(phone, items);
    }
    const meta = await db.getFirstAsync<{ cursor: string | null }>(
      `SELECT cursor FROM sync_meta WHERE phone = ?`,
      phone,
    );
    if (meta?.cursor) cursorByPhone.set(phone, meta.cursor);
  })()
    .catch(() => {
      /* SQLite indispo / verrou : le sync réseau remplit la RAM */
    })
    .finally(() => {
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
  const sorted = sortTx(
    items
      .map(normalizeTransactionItem)
      .filter((x): x is TransactionItem => x !== null),
  ).slice(0, 200);
  const prev = byPhone.get(phone);
  if (prev && listsEqual(prev, sorted)) {
    publishUi(phone, prev);
    return;
  }
  byPhone.set(phone, sorted);
  publishUi(phone, sorted);
  const cursor = sorted[0]?.createdAt ?? null;
  if (cursor) cursorByPhone.set(phone, cursor);
  /** Persist + curseur dans la même file (pas de course avec merge après pay). */
  void runDbWrite(async (db) => {
    await db.withTransactionAsync(async () => {
      await db.runAsync(`DELETE FROM transactions WHERE phone = ?`, phone);
      for (const t of sorted) await insertTxRow(db, phone, t);
      if (cursor) {
        await db.runAsync(
          `INSERT OR REPLACE INTO sync_meta (phone, cursor) VALUES (?, ?)`,
          phone,
          cursor,
        );
      }
    });
  });
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
  if (!cursor) return;
  await runDbWrite(async (db) => {
    await db.runAsync(
      `INSERT OR REPLACE INTO sync_meta (phone, cursor) VALUES (?, ?)`,
      phone,
      cursor,
    );
  });
}

export function clearTransactionsSnapshot(phone: string) {
  byPhone.delete(phone);
  cursorByPhone.delete(phone);
  clearHistoryUiCache(phone);
  void runDbWrite(async (db) => {
    await db.runAsync(`DELETE FROM transactions WHERE phone = ?`, phone);
    await db.runAsync(`DELETE FROM sync_meta WHERE phone = ?`, phone);
  });
}

export function clearAllTransactionsSnapshots() {
  byPhone.clear();
  cursorByPhone.clear();
  clearHistoryUiCache();
  void runDbWrite(async (db) => {
    await db.execAsync(`DELETE FROM transactions; DELETE FROM sync_meta;`);
  });
}
