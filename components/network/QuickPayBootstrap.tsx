import { requestQuickPayFromNotif } from "@/lib/pay/quickPayFlow";
import {
  consumePendingQuickPayNative,
  subscribeQuickPayCompleted,
  subscribeQuickPayRequested,
} from "@/lib/pay/quickPayNotifNative";
import { bindQuickPayNearbyCommerceWatcher } from "@/lib/pay/quickPayNearbyWatcher";
import { syncQuickPayNativeRuntime } from "@/lib/pay/syncQuickPayNativeSecrets";
import { syncQuickPayNotif } from "@/lib/pay/syncQuickPayNotif";
import { useAuth } from "@/contexts/authContextBase";
import { useEffect, useRef } from "react";
import { AppState, InteractionManager, Platform } from "react-native";

function drainNativeQuickPayPending(): void {
  void consumePendingQuickPayNative().then((amountFcfa) => {
    if (amountFcfa > 0) requestQuickPayFromNotif(amountFcfa);
  });
}

/** Notif persistante + sync secrets natifs (Android). */
export function QuickPayBootstrap() {
  const { token, user, updateBalance, refreshUser } = useAuth();
  const notifRestoredForTokenRef = useRef<string | null>(null);

  useEffect(() => {
    if (Platform.OS === "web") return;
    if (!token) {
      notifRestoredForTokenRef.current = null;
      void import("@/lib/pay/syncQuickPayNotif").then((m) =>
        m.stopQuickPayNotifIfNeeded(),
      );
      return;
    }
    if (notifRestoredForTokenRef.current === token) return;
    notifRestoredForTokenRef.current = token;
    const task = InteractionManager.runAfterInteractions(() => {
      void syncQuickPayNotif({ interactive: false });
    });
    return () => task.cancel?.();
  }, [token]);

  useEffect(() => {
    if (Platform.OS === "web" || !token) return;
    void syncQuickPayNativeRuntime({
      balanceFcfa: user?.balanceFcfa,
      phone: user?.phone,
    });
  }, [token, user?.balanceFcfa, user?.phone]);

  useEffect(() => {
    if (Platform.OS === "web" || !token) return () => {};
    return bindQuickPayNearbyCommerceWatcher(user);
  }, [token, user]);

  useEffect(() => {
    if (Platform.OS === "web") return () => {};
    drainNativeQuickPayPending();
    const appSub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        drainNativeQuickPayPending();
        if (token) {
          void syncQuickPayNativeRuntime({
            balanceFcfa: user?.balanceFcfa,
            phone: user?.phone,
          });
        }
      }
    });
    const unsubReq = subscribeQuickPayRequested((amountFcfa) => {
      requestQuickPayFromNotif(amountFcfa);
    });
    const unsubDone = subscribeQuickPayCompleted(
      ({ balanceFcfa, amountFcfa }) => {
        if (balanceFcfa > 0) updateBalance(balanceFcfa);
        void refreshUser();
        void syncQuickPayNativeRuntime({
          balanceFcfa: balanceFcfa > 0 ? balanceFcfa : user?.balanceFcfa,
          phone: user?.phone,
        });
        if (__DEV__ && amountFcfa > 0) {
          console.log("[quickPay] native ok", amountFcfa);
        }
      },
    );
    return () => {
      appSub.remove();
      unsubReq();
      unsubDone();
    };
  }, [token, user?.balanceFcfa, user?.phone, updateBalance, refreshUser]);

  return null;
}
