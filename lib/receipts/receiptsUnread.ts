import { getDb, runDbWrite } from "@/lib/db/sqlite";

const KV_KEY = "receipts_unread";
const unreadIdsByAccount = new Map<string, Set<string>>();
const hydrated = new Set<string>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const cb of listeners) cb();
}

function accountKey(accountId: string): string {
  return String(accountId ?? "").trim();
}

function idsFor(accountId: string): Set<string> {
  const id = accountKey(accountId);
  let set = unreadIdsByAccount.get(id);
  if (!set) {
    set = new Set();
    unreadIdsByAccount.set(id, set);
  }
  return set;
}

export function getReceiptsUnreadCount(accountId: string): number {
  const id = accountKey(accountId);
  if (!id) return 0;
  return unreadIdsByAccount.get(id)?.size ?? 0;
}

export function subscribeReceiptsUnread(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

async function persistUnread(accountId: string): Promise<void> {
  const id = accountKey(accountId);
  if (!id) return;
  const ids = [...(unreadIdsByAccount.get(id) ?? [])];
  await runDbWrite(async (db) => {
    await db.runAsync(
      `INSERT OR REPLACE INTO kv_cache (phone, key, json) VALUES (?, ?, ?)`,
      id,
      KV_KEY,
      JSON.stringify({ ids }),
    );
  });
}

export async function hydrateReceiptsUnread(accountId: string): Promise<void> {
  const id = accountKey(accountId);
  if (!id || hydrated.has(id)) return;
  hydrated.add(id);
  const db = await getDb();
  if (!db) return;
  try {
    const row = await db.getFirstAsync<{ json: string }>(
      `SELECT json FROM kv_cache WHERE phone = ? AND key = ?`,
      id,
      KV_KEY,
    );
    if (!row?.json) return;
    const parsed = JSON.parse(row.json) as { ids?: string[]; count?: number };
    const set = new Set<string>();
    if (Array.isArray(parsed.ids)) {
      for (const rid of parsed.ids) {
        const s = String(rid ?? "").trim();
        if (s) set.add(s);
      }
    }
    if (set.size === 0 && Number(parsed.count) > 0) {
      /* ancien format count seul — pas d’ids à surligner */
    }
    if (set.size > 0) unreadIdsByAccount.set(id, set);
  } catch {
    /* ignore */
  }
}

/** Nouveau reçu Blyp auto-enregistré (pas les imports manuels). */
export function bumpReceiptsUnread(accountId: string, receiptId: string): void {
  const id = accountKey(accountId);
  const rid = String(receiptId ?? "").trim();
  if (!id || !rid) return;
  const set = idsFor(id);
  if (set.has(rid)) return;
  set.add(rid);
  emit();
  void persistUnread(id);
}

/** Ouvre Mes reçus : retire la pastille, renvoie les ids à surligner. */
export function takeUnreadReceiptIds(accountId: string): ReadonlySet<string> {
  const id = accountKey(accountId);
  if (!id) return new Set();
  const set = unreadIdsByAccount.get(id);
  if (!set || set.size === 0) return new Set();
  const copy = new Set(set);
  set.clear();
  emit();
  void persistUnread(id);
  return copy;
}

/** @deprecated Utiliser takeUnreadReceiptIds à l’ouverture de l’écran. */
export function clearReceiptsUnread(accountId: string): void {
  takeUnreadReceiptIds(accountId);
}
