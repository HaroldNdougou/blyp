import type { ApiUser } from "@/lib/api/types";
import {
  ApiError,
  isSessionReplacedError,
  isSmallPayLimitPinRequiredError,
  isTransactionPinInvalidError,
} from "@/lib/api/errors";
import i18n from "@/lib/i18n";
import {
  applyOptimisticPaySent,
  finalizePaySentFromServer,
  optimisticPayTxId,
  rollbackOptimisticPaySent,
} from "@/lib/pay/applyOptimisticPaySent";
import { isRetryablePayFailure } from "@/lib/pay/isRetryablePayFailure";
import {
  evaluatePayEligibility,
  isCommercePayAccountId,
} from "@/lib/pay/payEligibility";
import {
  debitPayDossierOptimistic,
  setPayDossierBalance,
  userForPayFromDossier,
} from "@/lib/pay/payDossierCache";
import { newPayIdempotencyKey } from "@/lib/pay/payIdempotency";
import { readTransactionPinForNativeQuickPay } from "@/lib/security/transactionPinVault";
import type { QuickPayRecipient } from "@/lib/pay/quickPayRecipient";
import {
  buildPendingInstantPayRow,
  enqueuePendingInstantPay,
  notifyPendingInstantPayChanged,
  peekPendingInstantPay,
  shiftPendingInstantPay,
  type PendingInstantPayRow,
} from "@/lib/pay/pendingInstantPayQueue";
import {
  buildLocalCommercePayNotice,
  payerDisplayNameForLocalNotice,
} from "@/lib/pay/localCommercePayNotice";
import { relayLocalCommercePayNoticeBleDeferred } from "@/lib/pay/relayLocalCommercePayNoticeBle";

export type InstantCommercePayUiResult =
  | { ok: true; balanceFcfa: number; optimisticTxId: string }
  | {
      ok: false;
      reason:
        | "NO_TOKEN"
        | "NO_RECIPIENT"
        | "PIN"
        | "ELIGIBILITY"
        | "NOT_COMMERCE";
      message?: string;
    };

export type InstantPaySettlementListener = (input: {
  ok: boolean;
  hardFailure?: boolean;
  message?: string;
  row: PendingInstantPayRow;
}) => void;

let settlementListener: InstantPaySettlementListener | null = null;
let draining = false;

export function subscribeInstantPaySettlement(
  listener: InstantPaySettlementListener | null,
): void {
  settlementListener = listener;
}

export function shouldUseInstantCommercePay(input: {
  recipientAccountId: string | null | undefined;
  spendCategory: string | null;
}): boolean {
  if (input.spendCategory === "other") return false;
  return isCommercePayAccountId(input.recipientAccountId);
}

async function resolvePinForRow(row: PendingInstantPayRow): Promise<string | null> {
  if (row.smallPaySkipPin) return null;
  return readTransactionPinForNativeQuickPay();
}

async function settleOneRow(
  row: PendingInstantPayRow,
  opts: {
    token: string;
    phone: string;
    updateBalance: (balanceFcfa: number) => void;
    pinOverride?: string | null;
  },
): Promise<"done" | "retry" | "hard"> {
  const pin =
    opts.pinOverride !== undefined
      ? opts.pinOverride
      : await resolvePinForRow(row);
  if (!row.smallPaySkipPin && (!pin || pin.length !== 4)) {
    return "retry";
  }
  try {
    const api = await import("@/lib/api/client");
    const payRes = await api.pay(
      opts.token,
      row.amountFcfa,
      row.recipientName,
      row.recipientPhone,
      row.smallPaySkipPin ? null : pin,
      row.recipientAccountId,
      row.soaSeatNumber,
      {
        idempotencyKey: row.idempotencyKey,
        cashierSession: row.cashierSession,
      },
    );
    opts.updateBalance(payRes.balanceFcfa);
    setPayDossierBalance(payRes.balanceFcfa);
    const paidAt = new Date().toISOString();
    const txId =
      payRes.transactionId?.trim() ||
      row.optimisticTxId.replace(/^pending-pay-/, "idem-");
    await finalizePaySentFromServer({
      phone: opts.phone,
      amountFcfa: row.amountFcfa,
      to: {
        name: row.recipientName,
        phoneDigits: row.recipientPhone,
      },
      optimisticTxId: row.optimisticTxId,
      transactionId: txId,
      reference: payRes.reference,
      paidAt,
    });
    void import("@/lib/pay/relayCommercePaymentReceiptBle").then((m) =>
      m.relayCommercePaymentReceiptBleDeferred({
        receipt: payRes.paymentReceipt,
        merchantAccountId: row.recipientAccountId,
      }),
    );
    await shiftPendingInstantPay(row.idempotencyKey);
    settlementListener?.({ ok: true, row });
    return "done";
  } catch (e) {
    if (isTransactionPinInvalidError(e) || isSmallPayLimitPinRequiredError(e)) {
      await shiftPendingInstantPay(row.idempotencyKey);
      opts.updateBalance(row.balanceBeforeFcfa);
      setPayDossierBalance(row.balanceBeforeFcfa);
      await rollbackOptimisticPaySent({
        phone: opts.phone,
        optimisticTxId: row.optimisticTxId,
      });
      settlementListener?.({
        ok: false,
        hardFailure: true,
        message:
          e instanceof ApiError ? e.message : i18n.t("pay.pinWrongLast"),
        row,
      });
      return "hard";
    }
    if (isSessionReplacedError(e)) {
      await shiftPendingInstantPay(row.idempotencyKey);
      opts.updateBalance(row.balanceBeforeFcfa);
      setPayDossierBalance(row.balanceBeforeFcfa);
      await rollbackOptimisticPaySent({
        phone: opts.phone,
        optimisticTxId: row.optimisticTxId,
      });
      settlementListener?.({
        ok: false,
        hardFailure: true,
        message: e instanceof ApiError ? e.message : undefined,
        row,
      });
      return "hard";
    }
    if (isRetryablePayFailure(e)) {
      settlementListener?.({ ok: false, row });
      return "retry";
    }
    await shiftPendingInstantPay(row.idempotencyKey);
    opts.updateBalance(row.balanceBeforeFcfa);
    setPayDossierBalance(row.balanceBeforeFcfa);
    await rollbackOptimisticPaySent({
      phone: opts.phone,
      optimisticTxId: row.optimisticTxId,
    });
    settlementListener?.({
      ok: false,
      hardFailure: true,
      message: e instanceof ApiError ? e.message : i18n.t("common.genericError"),
      row,
    });
    return "hard";
  }
}

export async function drainPendingInstantPayQueue(opts: {
  token: string;
  phone: string;
  updateBalance: (balanceFcfa: number) => void;
}): Promise<void> {
  if (!opts.token?.trim() || !opts.phone?.trim()) return;
  if (draining) return;
  draining = true;
  try {
    for (;;) {
      const head = await peekPendingInstantPay();
      if (!head) break;
      const outcome = await settleOneRow(head, opts);
      if (outcome === "retry") break;
    }
  } finally {
    draining = false;
  }
}

export async function executeInstantCommercePay(input: {
  token: string;
  phone: string;
  user: ApiUser;
  amountFcfa: number;
  to: QuickPayRecipient;
  pin: string;
  smallPaySkipPin: boolean;
  soaSeatNumber?: number | null;
  cashierSession?: number | null;
  updateBalance: (balanceFcfa: number) => void;
}): Promise<InstantCommercePayUiResult> {
  const amount = Math.floor(input.amountFcfa);
  if (!isCommercePayAccountId(input.to.accountId)) {
    return { ok: false, reason: "NOT_COMMERCE" };
  }
  const payUser = userForPayFromDossier(input.user) ?? input.user;
  const eligibility = evaluatePayEligibility({
    token: input.token,
    user: payUser,
    amountFcfa: amount,
    recipientAccountId: input.to.accountId,
  });
  if (!eligibility.ok) {
    return {
      ok: false,
      reason: "ELIGIBILITY",
      message: eligibility.message,
    };
  }
  if (!input.smallPaySkipPin && input.pin.replace(/\D/g, "").length !== 4) {
    return { ok: false, reason: "PIN" };
  }

  const idempotencyKey = newPayIdempotencyKey();
  const optimisticTxId = optimisticPayTxId(idempotencyKey);
  const { balanceAfterFcfa, paidAt } = await applyOptimisticPaySent({
    phone: input.phone,
    amountFcfa: amount,
    to: input.to,
    balanceBeforeFcfa: payUser.balanceFcfa,
    optimisticTxId,
  });
  input.updateBalance(balanceAfterFcfa);
  debitPayDossierOptimistic(amount);

  const row = buildPendingInstantPayRow({
    amountFcfa: amount,
    to: input.to,
    user: payUser,
    smallPaySkipPin: input.smallPaySkipPin,
    soaSeatNumber:
      input.soaSeatNumber != null && Number.isFinite(input.soaSeatNumber)
        ? Math.floor(input.soaSeatNumber)
        : null,
    cashierSession:
      input.cashierSession != null && Number.isFinite(input.cashierSession)
        ? Math.floor(input.cashierSession) >>> 0
        : null,
    optimisticTxId,
    idempotencyKey,
  });
  await enqueuePendingInstantPay(row);
  notifyPendingInstantPayChanged();

  const payerName = payerDisplayNameForLocalNotice(input.user, input.phone);
  const localNotice = buildLocalCommercePayNotice({
    idempotencyKey,
    optimisticTxId,
    amountFcfa: amount,
    recipientAccountId: input.to.accountId,
    commerceId: null,
    cashierSession: row.cashierSession,
    payerName,
    payerPhone: input.phone,
  });
  if (localNotice) {
    relayLocalCommercePayNoticeBleDeferred({
      notice: localNotice,
      merchantAccountId: input.to.accountId,
    });
  }

  void import("@/lib/peers/displayNameCache").then((m) => {
    m.rememberPeerDisplayName(input.to.accountId, input.to.name);
  });
  void import("@/lib/security/transactionPinVault").then((m) => {
    if (input.pin.length === 4) void m.saveTransactionPinVault(input.pin);
  });
  void import("@/lib/pay/rememberPayRecipientForNativeShell").then((m) =>
    m.rememberPayRecipientForNativeShell(input.to, input.user),
  );

  void drainPendingInstantPayQueue({
    token: input.token,
    phone: input.phone,
    updateBalance: input.updateBalance,
  }).catch(() => {});

  if (input.phone) {
    void import("@/lib/sync/transactionsSync").then((m) => {
      void m.syncTransactionsFromNetwork(input.token, input.phone, {
        reason: "pay_instant",
      });
    });
  }

  return {
    ok: true,
    balanceFcfa: balanceAfterFcfa,
    optimisticTxId,
  };
}

export async function retryInstantCommercePaySettlement(input: {
  token: string;
  phone: string;
  updateBalance: (balanceFcfa: number) => void;
  pin?: string | null;
}): Promise<void> {
  const head = await peekPendingInstantPay();
  if (!head) return;
  if (input.pin != null) {
    await settleOneRow(head, {
      token: input.token,
      phone: input.phone,
      updateBalance: input.updateBalance,
      pinOverride: input.pin,
    });
    return;
  }
  await drainPendingInstantPayQueue(input);
}
