import type { QuickPayRecipient } from "@/lib/pay/quickPayRecipient";
import { ApiError, isTransactionPinInvalidError } from "@/lib/api/errors";
import i18n from "@/lib/i18n";
import { isLikelyOfflineNow } from "@/lib/network/isLikelyOffline";
import { fallbackTxReference } from "@/lib/txReference";

export type QuickPayExecuteResult =
  | { ok: true; balanceFcfa: number; transactionId: string | null }
  | { ok: false; reason: "NO_TOKEN" | "NO_RECIPIENT" | "PIN" | "API"; message?: string };

export async function executeStandardQuickPay(opts: {
  token: string;
  phone: string;
  amountFcfa: number;
  to: QuickPayRecipient;
  pin: string;
  updateBalance: (balanceFcfa: number) => void;
  network?: {
    isOffline: boolean;
    isConnected: boolean | null;
    isInternetReachable: boolean | null;
  };
}): Promise<QuickPayExecuteResult> {
  const amount = Math.floor(opts.amountFcfa);
  if (amount <= 0 || !opts.token) return { ok: false, reason: "NO_TOKEN" };
  if (!opts.to.accountId) return { ok: false, reason: "NO_RECIPIENT" };

  if (opts.network && isLikelyOfflineNow(opts.network)) {
    return {
      ok: false,
      reason: "API",
      message: i18n.t("network.requestFailed"),
    };
  }
  try {
    const api = await import("@/lib/api/client");
    const payRes = await api.pay(
      opts.token,
      amount,
      opts.to.name,
      opts.to.phoneDigits,
      opts.pin,
      opts.to.accountId,
      undefined,
      {
        cashierSession: (
          await import("@/lib/ble/deliverReceiptViaCashierGatt").then((m) =>
            m.readCashierSessionViaGatt(opts.to.accountId),
          )
        ),
      },
    );
    opts.updateBalance(payRes.balanceFcfa);
    const paidAt = new Date().toISOString();
    const reference =
      payRes.reference?.trim() ||
      (payRes.transactionId
        ? fallbackTxReference(payRes.transactionId)
        : fallbackTxReference(`pay-${Date.now()}`));
    if (opts.phone && payRes.transactionId) {
      const cache = await import("@/lib/transactionsCache");
      cache.mergeTransactionsDelta(opts.phone, [
        {
          id: payRes.transactionId,
          reference,
          type: "sent",
          kind: null,
          amountFcfa: amount,
          counterpartyName: opts.to.name,
          counterpartyPhone: opts.to.phoneDigits,
          createdAt: paidAt,
        },
      ]);
      await cache.setSyncCursor(opts.phone, paidAt);
    }
    void import("@/lib/peers/displayNameCache").then((m) => {
      m.rememberPeerDisplayName(opts.to.accountId, opts.to.name);
    });
    void import("@/lib/security/transactionPinVault").then((m) => {
      void m.saveTransactionPinVault(opts.pin);
    });
    void import("@/lib/pay/relayCommercePaymentReceiptBle").then((m) =>
      m.relayCommercePaymentReceiptBleDeferred({
        receipt: payRes.paymentReceipt,
        merchantAccountId: opts.to.accountId,
      }),
    );
    void import("@/lib/pay/syncQuickPayNativeSecrets").then((m) => {
      void m.syncQuickPayNativeRuntime({
        pin: opts.pin,
        balanceFcfa: payRes.balanceFcfa,
        phone: opts.phone,
      });
    });
    return {
      ok: true,
      balanceFcfa: payRes.balanceFcfa,
      transactionId: payRes.transactionId,
    };
  } catch (e) {
    if (isTransactionPinInvalidError(e)) {
      return { ok: false, reason: "PIN" };
    }
    return {
      ok: false,
      reason: "API",
      message: e instanceof ApiError ? e.message : undefined,
    };
  }
}
