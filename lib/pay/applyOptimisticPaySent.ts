import type { QuickPayRecipient } from "@/lib/pay/quickPayRecipient";
import { fallbackTxReference } from "@/lib/txReference";

export function optimisticPayTxId(idempotencyKey: string): string {
  return `pending-pay-${idempotencyKey.slice(0, 48)}`;
}

export async function applyOptimisticPaySent(input: {
  phone: string;
  amountFcfa: number;
  to: Pick<QuickPayRecipient, "accountId" | "name" | "phoneDigits">;
  balanceBeforeFcfa: number;
  optimisticTxId: string;
  txKind?: string | null;
}): Promise<{ balanceAfterFcfa: number; paidAt: string }> {
  const amount = Math.floor(input.amountFcfa);
  const balanceAfterFcfa = Math.max(0, Math.floor(input.balanceBeforeFcfa) - amount);
  const paidAt = new Date().toISOString();
  const cache = await import("@/lib/transactionsCache");
  cache.mergeTransactionsDelta(input.phone, [
    {
      id: input.optimisticTxId,
      reference: fallbackTxReference(input.optimisticTxId),
      type: "sent",
      kind: input.txKind ?? "PAYMENT",
      amountFcfa: amount,
      counterpartyName: input.to.name,
      counterpartyPhone: input.to.phoneDigits,
      createdAt: paidAt,
    },
  ]);
  void cache.setSyncCursor(input.phone, paidAt).catch(() => {});
  return { balanceAfterFcfa, paidAt };
}

export async function finalizePaySentFromServer(input: {
  phone: string;
  amountFcfa: number;
  to: Pick<QuickPayRecipient, "name" | "phoneDigits">;
  optimisticTxId: string;
  transactionId: string;
  reference: string | null;
  paidAt: string;
  txKind?: string | null;
}): Promise<void> {
  const cache = await import("@/lib/transactionsCache");
  const reference =
    input.reference?.trim() || fallbackTxReference(input.transactionId);
  cache.mergeTransactionsDelta(input.phone, [
    {
      id: input.transactionId,
      reference,
      type: "sent",
      kind: input.txKind ?? "PAYMENT",
      amountFcfa: Math.floor(input.amountFcfa),
      counterpartyName: input.to.name,
      counterpartyPhone: input.to.phoneDigits,
      createdAt: input.paidAt,
    },
  ]);
  void cache.removeTransactionFromCache(input.phone, input.optimisticTxId);
}

export async function rollbackOptimisticPaySent(input: {
  phone: string;
  optimisticTxId: string;
}): Promise<void> {
  const cache = await import("@/lib/transactionsCache");
  cache.removeTransactionFromCache(input.phone, input.optimisticTxId);
}
