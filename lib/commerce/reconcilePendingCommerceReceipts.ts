import type { TransactionItem } from "@/lib/api/types";
import {
  applyPendingReceiptStatuses,
  getPendingCommerceReceiptsSnapshot,
  prunePendingCommerceReceipts,
} from "@/lib/commerce/pendingCommerceReceipts";
import {
  paymentTxFingerprint,
  txIdMatchesFingerprint,
} from "@/lib/pay/paymentReceipt";

/**
 * Réconciliation stricte : pending BLE → ligne « received » du ledger sync.
 * Non confirmé à l’expiration = rejeté (anti-fraude).
 */
export async function reconcilePendingCommerceReceipts(input: {
  commerceId: string;
  transactions: TransactionItem[] | null;
}): Promise<{ confirmed: number; rejected: number }> {
  prunePendingCommerceReceipts();
  const pending = getPendingCommerceReceiptsSnapshot().filter(
    (r) => r.commerceId === input.commerceId && r.status === "pending",
  );
  if (!pending.length) return { confirmed: 0, rejected: 0 };

  const received = (input.transactions ?? []).filter(
    (t) => t.type === "received",
  );
  const updates: {
    id: string;
    status: "confirmed" | "rejected";
    transactionId?: string;
  }[] = [];
  let confirmed = 0;
  let rejected = 0;
  const now = Date.now();

  for (const row of pending) {
    const match = received.find((t) => {
      if (t.amountFcfa !== row.amountFcfa) return false;
      if (row.transactionId) return t.id === row.transactionId;
      return txIdMatchesFingerprint(t.id, row.txFp);
    });
    if (match) {
      updates.push({
        id: row.id,
        status: "confirmed",
        transactionId: match.id,
      });
      confirmed += 1;
      continue;
    }
    if (now > row.expiresAtMs) {
      updates.push({ id: row.id, status: "rejected" });
      rejected += 1;
    }
  }

  if (updates.length) await applyPendingReceiptStatuses(updates);
  return { confirmed, rejected };
}
