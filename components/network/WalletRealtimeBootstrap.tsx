import { useAuth } from "@/contexts/authContextBase";
import { registerPaymentRealtimeHandler } from "@/lib/pay/paymentRealtimeBridge";
import type { PaymentReceivedPushData } from "@/lib/push/handleIncoming";
import { softHydrateAfterPaymentPush } from "@/lib/push/handleIncoming";
import { useEffect } from "react";

/**
 * Connexion temps réel wallet (caisse) + pont vers solde / historique local.
 */
export function WalletRealtimeBootstrap() {
  const { token, user, refreshUser, applyIncomingPayment } = useAuth();
  const phone = user?.phone ?? "";

  useEffect(() => {
    registerPaymentRealtimeHandler((data: PaymentReceivedPushData) => {
      applyIncomingPayment(data);
      softHydrateAfterPaymentPush({ token, phone, refreshUser });
    });
    return () => registerPaymentRealtimeHandler(null);
  }, [token, phone, refreshUser, applyIncomingPayment]);

  useEffect(() => {
    void import("@/lib/realtime/walletRealtimeLink").then((m) => {
      m.ensureWalletRealtimeLink(token);
    });
    return () => {
      void import("@/lib/realtime/walletRealtimeLink").then((m) => {
        m.stopWalletRealtimeLink();
      });
    };
  }, [token]);

  return null;
}
