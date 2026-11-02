import { ingestPayReceiptChunk } from "@/lib/ble/payReceiptChunkAssembler";
import type { PayReceiptChunkFrame } from "@/lib/ble/payReceiptChunkCodec";
import { getMerchantClosedCashierSessionId } from "@/lib/commerce/closedCashierGattMerchant";
import { ingestFullPaymentReceipt } from "@/lib/commerce/pendingCommerceReceipts";
import type { CommercePaymentReceipt } from "@/lib/pay/paymentReceipt";
import { verifyCommercePaymentReceiptSync } from "@/lib/pay/paymentReceipt";
import { resolveAppLanguage } from "@/lib/i18n/locale";
import { notifyIncomingPaymentFlash } from "@/lib/pay/incomingFlash";
import { Platform } from "react-native";

const voicedTx = new Set<string>();

export async function handleCommercePaymentReceipt(input: {
  receipt: CommercePaymentReceipt;
  commerceId: string;
  merchantAccountId: string;
}): Promise<boolean> {
  const receipt = input.receipt;
  if (!verifyCommercePaymentReceiptSync(receipt)) return false;
  if (
    receipt.recipientAccountId.trim().toUpperCase() !==
    input.merchantAccountId.trim().toUpperCase()
  ) {
    return false;
  }
  if (receipt.commerceId && receipt.commerceId !== input.commerceId) {
    return false;
  }
  if (receipt.cashierSession == null) return false;
  if (receipt.cashierSession !== getMerchantClosedCashierSessionId()) {
    return false;
  }

  const row = await ingestFullPaymentReceipt({
    receipt,
    commerceId: input.commerceId,
  });
  if (!row) return false;

  const txKey = receipt.transactionId;
  if (Platform.OS === "android" && !voicedTx.has(txKey)) {
    voicedTx.add(txKey);
    setTimeout(() => voicedTx.delete(txKey), 120_000);
    void import("@/lib/push/announceNative").then((m) => {
      void m.announcePaymentNative({
        amountFcfa: row.amountFcfa,
        txId: txKey,
        lang: resolveAppLanguage(),
      });
    });
  }

  notifyIncomingPaymentFlash({
    amountFcfa: row.amountFcfa,
    contextType: "commerce",
    commerceId: input.commerceId,
    transactionId: txKey,
  });

  return true;
}

export function handleCommercePayReceiptChunk(input: {
  frame: PayReceiptChunkFrame;
  commerceId: string;
  merchantAccountId: string;
}): void {
  const receipt = ingestPayReceiptChunk(input.frame);
  if (!receipt) return;
  void handleCommercePaymentReceipt({
    receipt,
    commerceId: input.commerceId,
    merchantAccountId: input.merchantAccountId,
  });
}
