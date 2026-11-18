import {
  API_ERROR_PAYMENT_RECEIPT_ALREADY_ENCASHED,
  ApiError,
} from "@/lib/api/errors";
import { encashCommercePaymentReceipt } from "@/lib/api/client";
import { isOfflineCashierActiveForCommerce } from "@/lib/commerce/offlineCashierMode";
import {
  isReceiptTransactionEncashedLocally,
  rememberEncashedReceiptTransactionId,
} from "@/lib/commerce/encashedReceiptIdsCache";
import { fetchIsNetworkConnected } from "@/lib/network/fetchIsConnected";
import type { CommercePaymentReceipt } from "@/lib/pay/paymentReceipt";

/** Reçu trop vieux pour accepter en caisse sans net (anti rejeu BLE volé). */
export const OFFLINE_CASHIER_MAX_RECEIPT_AGE_MS = 25_000;

export type ClaimReceiptResult =
  | { ok: true; registeredOnServer: boolean }
  | { ok: false; reason: "duplicate" | "stale" | "network_duplicate" };

export async function claimCommercePaymentReceiptBeforeAccept(input: {
  receipt: CommercePaymentReceipt;
  commerceId: string;
  token: string | null;
}): Promise<ClaimReceiptResult> {
  const txId = input.receipt.transactionId.trim();
  if (!txId) return { ok: false, reason: "duplicate" };

  if (isReceiptTransactionEncashedLocally(txId)) {
    return { ok: false, reason: "duplicate" };
  }

  if (
    isOfflineCashierActiveForCommerce(input.commerceId) &&
    Date.now() - input.receipt.issuedAt > OFFLINE_CASHIER_MAX_RECEIPT_AGE_MS
  ) {
    return { ok: false, reason: "stale" };
  }

  const online = await fetchIsNetworkConnected();
  if (!online || !input.token) {
    return { ok: true, registeredOnServer: false };
  }

  try {
    await encashCommercePaymentReceipt(input.commerceId, input.token, {
      receipt: input.receipt,
    });
    await rememberEncashedReceiptTransactionId(txId);
    return { ok: true, registeredOnServer: true };
  } catch (e) {
    if (
      e instanceof ApiError &&
      (e.status === 409 ||
        e.code === API_ERROR_PAYMENT_RECEIPT_ALREADY_ENCASHED)
    ) {
      await rememberEncashedReceiptTransactionId(txId);
      return { ok: false, reason: "network_duplicate" };
    }
    if (e instanceof ApiError && e.status === 0) {
      return { ok: true, registeredOnServer: false };
    }
    throw e;
  }
}

export async function flushPendingReceiptEncashQueue(input: {
  commerceId: string;
  token: string;
}): Promise<void> {
  const { drainPendingReceiptEncashQueue } = await import(
    "@/lib/commerce/pendingReceiptEncashQueue"
  );
  await drainPendingReceiptEncashQueue(input);
}
