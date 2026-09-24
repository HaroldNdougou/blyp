import { InteractionManager } from "react-native";
import type { Router } from "expo-router";

export type PaymentReceivedPushData = {
  type?: string;
  transactionId?: string;
  amountFcfa?: string;
  fromName?: string;
  contextType?: string;
  commerceId?: string;
};

/**
 * Soft WhatsApp-like : hydrate solde + historique en fond, sans bloquer le frame.
 */
export function softHydrateAfterPaymentPush(opts: {
  token: string | null;
  phone: string;
  refreshUser: () => Promise<unknown>;
}): void {
  const { token, phone, refreshUser } = opts;

  void refreshUser().catch(() => {});
  if (!token || !phone) return;
  InteractionManager.runAfterInteractions(() => {
    void (async () => {
      try {
        const { syncTransactionsFromNetwork } = await import(
          "@/lib/sync/transactionsSync"
        );
        await syncTransactionsFromNetwork(token, phone);
      } catch {
        /* ignore */
      }
    })();
  });
}

/** Tap notification → onglet Pay / commerce (accueil). */
export function openHomeFromPush(router: Router): void {
  try {
    router.navigate("/(tabs)");
  } catch {
    /* ignore */
  }
}

export function parsePushData(
  data: Record<string, unknown> | undefined | null,
): PaymentReceivedPushData | null {
  if (!data || typeof data !== "object") return null;
  if (data.type !== "payment_received") return null;
  return data as PaymentReceivedPushData;
}
