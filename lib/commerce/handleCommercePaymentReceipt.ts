import { ingestPayReceiptChunk } from "@/lib/ble/payReceiptChunkAssembler";
import type { PayReceiptChunkFrame } from "@/lib/ble/payReceiptChunkCodec";
import { shouldSkipVoiceAfterLocalAnnounce } from "@/lib/commerce/localPayAnnounceDedupe";
import { claimCommercePaymentReceiptBeforeAccept } from "@/lib/commerce/claimCommercePaymentReceipt";
import { enqueueReceiptEncash } from "@/lib/commerce/pendingReceiptEncashQueue";
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
  authToken?: string | null;
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

  const claim = await claimCommercePaymentReceiptBeforeAccept({
    receipt,
    commerceId: input.commerceId,
    token: input.authToken ?? null,
  });
  if (!claim.ok) return false;

  const row = await ingestFullPaymentReceipt({
    receipt,
    commerceId: input.commerceId,
  });
  if (!row) return false;

  if (!claim.registeredOnServer) {
    void enqueueReceiptEncash({
      commerceId: input.commerceId,
      receipt,
    });
  }

  const txKey = receipt.transactionId;
  const skipVoice = shouldSkipVoiceAfterLocalAnnounce({
    amountFcfa: row.amountFcfa,
    reference: receipt.reference,
    cashierSession: receipt.cashierSession,
  });
  if (Platform.OS === "android" && !skipVoice && !voicedTx.has(txKey)) {
    voicedTx.add(txKey);
    setTimeout(() => voicedTx.delete(txKey), 120_000);
    void import("@/lib/push/announceNative").then((m) => {
      void m.announcePaymentNative({
        amountFcfa: row.amountFcfa,
        txId: txKey,
        lang: resolveAppLanguage(),
        payerName: receipt.reference,
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
