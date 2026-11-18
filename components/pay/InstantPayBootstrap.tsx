import { useAuth } from "@/contexts/authContextBase";
import { useNetwork } from "@/contexts/NetworkContext";
import {
  drainPendingInstantPayQueue,
  subscribeInstantPaySettlement,
} from "@/lib/pay/executeInstantCommercePay";
import { pendingInstantPayCount } from "@/lib/pay/pendingInstantPayQueue";
import { blypAlert } from "@/lib/ui/blypAlert";
import { useTranslation } from "react-i18next";
import { useEffect, useRef } from "react";
import { AppState, InteractionManager, type AppStateStatus } from "react-native";

/** Règlement HTTP en fond — file idempotente commerce (pay instant salle). */
export function InstantPayBootstrap() {
  const { t } = useTranslation();
  const { token, user, updateBalance, refreshUser } = useAuth();
  const { reconnectGeneration } = useNetwork();
  const phone = user?.phone ?? "";
  const lastDrain = useRef(0);

  useEffect(() => {
    if (!token || !phone) return;
    return subscribeInstantPaySettlement((ev) => {
      if (ev.ok || !ev.hardFailure) return;
      blypAlert(
        t("pay.paymentTitle"),
        ev.message ?? t("pay.instantSettlementFailed"),
      );
      void refreshUser();
    });
  }, [token, phone, t, refreshUser]);

  useEffect(() => {
    if (!token || !phone) return;

    const drain = (reason: string) => {
      const now = Date.now();
      if (now - lastDrain.current < 800) return;
      lastDrain.current = now;
      void pendingInstantPayCount().then((n) => {
        if (n <= 0) return;
        void drainPendingInstantPayQueue({
          token,
          phone,
          updateBalance,
        }).finally(() => {
          void import("@/lib/pay/pendingInstantPayQueue").then((m) =>
            m.notifyPendingInstantPayChanged(),
          );
        });
      });
    };

    const task = InteractionManager.runAfterInteractions(() => {
      drain("boot");
    });

    const sub = AppState.addEventListener("change", (s: AppStateStatus) => {
      if (s === "active") drain("foreground");
    });

    drain("reconnect");

    return () => {
      task.cancel?.();
      sub.remove();
    };
  }, [token, phone, updateBalance, reconnectGeneration]);

  return null;
}
