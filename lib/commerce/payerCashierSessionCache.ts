import type { ParsedCashierSessionAd } from "@/lib/ble/payReceiptChunkCodec";

const TTL_MS = 50_000;
const byAccount = new Map<
  string,
  { sessionId: number; seenAt: number }
>();

export function rememberCashierSession(ad: ParsedCashierSessionAd): void {
  byAccount.set(ad.accountId.toUpperCase(), {
    sessionId: ad.sessionId >>> 0,
    seenAt: Date.now(),
  });
}

export function getCashierSessionForAccount(
  accountId: string | null | undefined,
): number | null {
  const id = String(accountId ?? "").trim().toUpperCase();
  if (!id) return null;
  const row = byAccount.get(id);
  if (!row) return null;
  if (Date.now() - row.seenAt > TTL_MS) {
    byAccount.delete(id);
    return null;
  }
  return row.sessionId;
}
