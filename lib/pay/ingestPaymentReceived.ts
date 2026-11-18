import { resolveAppLanguage } from "@/lib/i18n/locale";
import {
  merchantPayRx,
  merchantPayVoiceDone,
} from "@/lib/perf/merchantPayTrace";
import type { MerchantPayRxSource } from "@/lib/perf/merchantPayTrace.types";
import { dispatchPaymentReceived } from "@/lib/pay/paymentRealtimeBridge";
import type { PaymentReceivedPushData } from "@/lib/push/handleIncoming";
import { Platform } from "react-native";

function parsePayload(raw: Record<string, unknown>): PaymentReceivedPushData | null {
  if (String(raw.type ?? "") !== "payment_received") return null;
  return raw as PaymentReceivedPushData;
}

/**
 * Paiement reçu (WS ou push) — solde + historique local + voix commerçant (Android natif).
 */
export function ingestPaymentReceivedEvent(raw: unknown): boolean {
  if (!raw || typeof raw !== "object") return false;
  const data = parsePayload(raw as Record<string, unknown>);
  if (!data) return false;

  dispatchPaymentReceived(data);

  if (Platform.OS === "android") {
    const amount = Math.floor(Number(data.amountFcfa) || 0);
    if (amount > 0) {
      void import("@/lib/push/announceNative").then((m) => {
        void m.announcePaymentNative({
          amountFcfa: amount,
          txId: String(data.transactionId ?? "").trim() || undefined,
          lang: resolveAppLanguage(),
        });
      });
    }
  }
  return true;
}
