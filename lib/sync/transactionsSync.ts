import type { TransactionItem } from "@/lib/api/types";
import {
  getSyncCursor,
  getTransactionsSnapshot,
  mergeTransactionsDelta,
  setSyncCursor,
  setTransactionsSnapshot,
} from "@/lib/transactionsCache";
import { fallbackTxReference } from "@/lib/txReference";

function withReferences(items: TransactionItem[]): TransactionItem[] {
  return items.map((t) => ({
    ...t,
    reference: t.reference?.trim() || fallbackTxReference(t.id),
  }));
}

/**
 * Sync réseau → SQLite/RAM.
 * Avec curseur : delta only (point 1). Sans curseur / full : replace.
 */
export async function syncTransactionsFromNetwork(
  token: string,
  phone: string,
): Promise<TransactionItem[]> {
  try {
    const { listTransactions } = await import("@/lib/api/client");
    const cursor = getSyncCursor(phone);
    const cached = getTransactionsSnapshot(phone);

    if (cursor && cached && cached.length > 0) {
      const { items, cursor: nextCursor, delta } = await listTransactions(
        token,
        { since: cursor },
      );
      const normalized = withReferences(items);
      if (delta && normalized.length === 0) {
        return cached;
      }
      if (delta) {
        const merged = mergeTransactionsDelta(phone, normalized);
        if (nextCursor) await setSyncCursor(phone, nextCursor);
        else if (merged[0]?.createdAt) {
          await setSyncCursor(phone, merged[0].createdAt);
        }
        /** Même ref RAM si rien n’a changé — évite re-render onglet Transactions. */
        return getTransactionsSnapshot(phone) ?? merged;
      }
    }

    const { items, cursor: nextCursor } = await listTransactions(token);
    const normalized = withReferences(items);
    setTransactionsSnapshot(phone, normalized);
    if (nextCursor) await setSyncCursor(phone, nextCursor);
    else if (normalized[0]?.createdAt) {
      await setSyncCursor(phone, normalized[0].createdAt);
    }
    return getTransactionsSnapshot(phone) ?? normalized;
  } catch {
    return getTransactionsSnapshot(phone) ?? [];
  }
}
