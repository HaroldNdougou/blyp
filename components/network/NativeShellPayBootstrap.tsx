import { useAuth } from "@/contexts/authContextBase";
import {
  consumePendingShellPayCompleted,
  subscribeShellPayCompleted,
  type ShellPayCompletedPayload,
} from "@/lib/nativeShell/shellPayEvents";
import { fallbackTxReference } from "@/lib/txReference";
import { useEffect } from "react";
import { Platform } from "react-native";

/** Solde + historique RAM quand un paiement natif (coque) réussit. */
export function NativeShellPayBootstrap() {
  const { token, user, updateBalance, refreshUser } = useAuth();
  const phone = user?.phone ?? "";

  useEffect(() => {
    if (Platform.OS !== "android" || !token) return;

    const apply = (payload: ShellPayCompletedPayload) => {
      if (payload.balanceFcfa >= 0) {
        updateBalance(payload.balanceFcfa);
      }
      const accountId = String(payload.recipientAccountId ?? "").trim();
      const name = String(payload.recipientName ?? "").trim();
      if (accountId && name) {
        void import("@/lib/pay/quickPayRecipient").then(({ rememberQuickPayRecipient }) =>
          rememberQuickPayRecipient({
            accountId,
            name,
            phoneDigits: payload.recipientPhone ?? null,
          }),
        );
      }
      const txId = String(payload.transactionId ?? "").trim();
      const txName = name || "—";
      if (phone && txId && payload.amountFcfa > 0) {
        const paidAt = new Date().toISOString();
        void import("@/lib/transactionsCache").then((cache) => {
          cache.mergeTransactionsDelta(phone, [
            {
              id: txId,
              reference: fallbackTxReference(txId),
              type: "sent",
              kind: "PAYMENT",
              amountFcfa: payload.amountFcfa,
              counterpartyName: txName,
              counterpartyPhone: payload.recipientPhone ?? null,
              createdAt: paidAt,
            },
          ]);
          void cache.setSyncCursor(phone, paidAt).catch(() => {});
        });
      }
      void refreshUser();
      void import("@/lib/pay/syncShellPayRuntime").then((m) =>
        m.syncShellPayRuntime(user),
      );
      const receiptRaw = String(payload.paymentReceiptJson ?? "").trim();
      if (receiptRaw && accountId) {
        void (async () => {
          try {
            const { verifyCommercePaymentReceiptSync } = await import(
              "@/lib/pay/paymentReceipt"
            );
            const parsed = JSON.parse(receiptRaw) as import("@/lib/pay/paymentReceipt").CommercePaymentReceipt;
            if (!verifyCommercePaymentReceiptSync(parsed)) return;
            const relay = await import("@/lib/pay/relayCommercePaymentReceiptBle");
            relay.relayCommercePaymentReceiptBleDeferred({
              receipt: parsed,
              merchantAccountId: accountId,
            });
          } catch {
            /* ignore */
          }
        })();
      }
    };

    void consumePendingShellPayCompleted().then((pending) => {
      if (pending) apply(pending);
    });

    const sub = subscribeShellPayCompleted(apply);
    return sub;
  }, [token, phone, updateBalance, refreshUser, user]);

  return null;
}
