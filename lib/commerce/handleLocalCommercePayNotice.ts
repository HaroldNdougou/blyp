import { markLocalPayAnnounced } from "@/lib/commerce/localPayAnnounceDedupe";
import { getMerchantClosedCashierSessionId } from "@/lib/commerce/closedCashierGattMerchant";
import type { LocalCommercePayNotice } from "@/lib/pay/localCommercePayNotice";
import { resolveAppLanguage } from "@/lib/i18n/locale";
import { notifyIncomingPaymentFlash } from "@/lib/pay/incomingFlash";
import { Platform } from "react-native";

const voicedLocal = new Set<string>();

export async function handleLocalCommercePayNotice(input: {
  notice: LocalCommercePayNotice;
  commerceId: string;
  merchantAccountId: string;
}): Promise<boolean> {
  const notice = input.notice;
  if (
    notice.recipientAccountId.trim().toUpperCase() !==
    input.merchantAccountId.trim().toUpperCase()
  ) {
    return false;
  }
  if (notice.commerceId && notice.commerceId !== input.commerceId) {
    return false;
  }
  if (notice.cashierSession !== getMerchantClosedCashierSessionId()) {
    return false;
  }
  if (Date.now() > notice.expiresAt) return false;
  const amount = Math.floor(notice.amountFcfa);
  if (amount <= 0) return false;

  const voiceKey = notice.idempotencyKey.trim() || notice.transactionId.trim();
  if (!voiceKey) return false;
  if (voicedLocal.has(voiceKey)) return true;
  voicedLocal.add(voiceKey);
  if (voicedLocal.size > 80) {
    voicedLocal.delete(voicedLocal.values().next().value!);
  }

  markLocalPayAnnounced({
    amountFcfa: amount,
    reference: notice.reference,
    cashierSession: notice.cashierSession,
  });

  if (Platform.OS === "android") {
    void import("@/lib/push/announceNative").then((m) => {
      void m.announcePaymentNative({
        amountFcfa: amount,
        txId: voiceKey,
        lang: resolveAppLanguage(),
        payerName: notice.reference,
      });
    });
  }

  notifyIncomingPaymentFlash({
    amountFcfa: amount,
    contextType: "commerce",
    commerceId: input.commerceId,
    transactionId: notice.transactionId,
  });

  return true;
}

export async function handleCommercePayPayloadFromGatt(input: {
  json: string;
  commerceId: string;
  merchantAccountId: string;
  authToken?: string | null;
}): Promise<void> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input.json);
  } catch {
    return;
  }
  const { isLocalCommercePayNotice } = await import(
    "@/lib/pay/localCommercePayNotice"
  );
  if (isLocalCommercePayNotice(parsed)) {
    await handleLocalCommercePayNotice({
      notice: parsed,
      commerceId: input.commerceId,
      merchantAccountId: input.merchantAccountId,
    });
    return;
  }
  const { handleCommercePaymentReceipt } = await import(
    "@/lib/commerce/handleCommercePaymentReceipt"
  );
  await handleCommercePaymentReceipt({
    receipt: parsed as import("@/lib/pay/paymentReceipt").CommercePaymentReceipt,
    commerceId: input.commerceId,
    merchantAccountId: input.merchantAccountId,
    authToken: input.authToken ?? null,
  });
}
