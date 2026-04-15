import type { TransactionItem } from "@/lib/api/types";

const byToken = new Map<string, TransactionItem[]>();

export function setTransactionsSnapshot(
  token: string,
  items: TransactionItem[],
) {
  if (!token) return;
  byToken.set(token, items);
}

export function getTransactionsSnapshot(
  token: string,
): TransactionItem[] | null {
  if (!token) return null;
  const v = byToken.get(token);
  return v !== undefined ? v : null;
}

export function clearTransactionsSnapshot(token: string) {
  byToken.delete(token);
}

export function clearAllTransactionsSnapshots() {
  byToken.clear();
}
