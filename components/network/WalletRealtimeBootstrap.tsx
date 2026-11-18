import { useAuth } from "@/contexts/authContextBase";
import {
  getOfflineCashierModeSnapshot,
  hydrateOfflineCashierModeOnce,
  subscribeOfflineCashierMode,
} from "@/lib/commerce/offlineCashierMode";
import { registerPaymentRealtimeHandler } from "@/lib/pay/paymentRealtimeBridge";
import type { PaymentReceivedPushData } from "@/lib/push/handleIncoming";
import { softHydrateAfterPaymentPush } from "@/lib/push/handleIncoming";
import { useEffect, useSyncExternalStore } from "react";
import { InteractionManager } from "react-native";

/**
 * Pont WS paiement commerçant (caisse / contexte commerce) + solde local.
 * FCM reste le secours (envoi direct côté Lambda pour le commerce).
 */
export function WalletRealtimeBootstrap() {
  const { token, user, refreshUser, applyIncomingPayment } = useAuth();
  const phone = user?.phone ?? "";

  hydrateOfflineCashierModeOnce();
  const offlineCashier = useSyncExternalStore(
    subscribeOfflineCashierMode,
    getOfflineCashierModeSnapshot,
    getOfflineCashierModeSnapshot,
  );

  const wantMerchantWs =
    !!token &&
    (user?.activeContext?.type === "commerce" || offlineCashier.active);

  useEffect(() => {
    registerPaymentRealtimeHandler((data: PaymentReceivedPushData) => {
      applyIncomingPayment(data);
      softHydrateAfterPaymentPush({ token, phone, refreshUser });
    });
    return () => registerPaymentRealtimeHandler(null);
  }, [token, phone, refreshUser, applyIncomingPayment]);

  useEffect(() => {
    let cancelled = false;
    let task: { cancel?: () => void } | null = null;
    if (!wantMerchantWs) {
      void import("@/lib/realtime/walletRealtimeLink").then((m) => {
        m.stopWalletRealtimeLink();
      });
      return () => {
        cancelled = true;
        task?.cancel?.();
      };
    }
    task = InteractionManager.runAfterInteractions(() => {
      if (cancelled) return;
      void import("@/lib/realtime/walletRealtimeLink").then((m) => {
        if (cancelled) return;
        m.ensureWalletRealtimeLink(token);
      });
    });
    return () => {
      cancelled = true;
      task?.cancel?.();
      void import("@/lib/realtime/walletRealtimeLink").then((m) => {
        m.stopWalletRealtimeLink();
      });
    };
  }, [token, wantMerchantWs]);

  return null;
}
