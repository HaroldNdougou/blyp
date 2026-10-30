import { useAuth } from "@/contexts/authContextBase";
import { waitForAppActive } from "@/lib/app/waitForAppActive";
import { formatFcfa } from "@/lib/formatFcfa";
import { executeStandardQuickPay } from "@/lib/pay/executeStandardQuickPay";
import { requestQuickPayFromNotif, subscribeQuickPayFlow } from "@/lib/pay/quickPayFlow";
import {
  loadQuickPayRecipient,
  type QuickPayRecipient,
} from "@/lib/pay/quickPayRecipient";
import { clearQuickPayNotifHighlight } from "@/lib/pay/quickPayNotifNative";
import { QUICK_PAY_AMOUNTS } from "@/lib/pay/syncQuickPayNotif";
import { USE_MOCK_API } from "@/lib/config";
import { canUseDeviceAuth } from "@/lib/security/deviceAuth";
import { useTranslation } from "react-i18next";
import React, { useCallback, useEffect, useRef } from "react";
import { showBlypActionFlash } from "@/lib/ui/blypActionFlash";
import { blypAlert } from "@/lib/ui/blypAlert";
import { InteractionManager, Platform } from "react-native";

export function QuickPayHost() {
  const { t, i18n } = useTranslation();
  const { token, user, updateBalance, refreshUser } = useAuth();
  const phone = user?.phone ?? "";
  const balance = user?.balanceFcfa ?? 0;
  const busyRef = useRef(false);

  const runPay = useCallback(
    async (amountFcfa: number, to: QuickPayRecipient, pin: string) => {
      if (!token || busyRef.current) return;
      busyRef.current = true;
      try {
        const res = await executeStandardQuickPay({
          token,
          phone,
          amountFcfa,
          to,
          pin,
          updateBalance,
        });
        if (res.ok) {
          showBlypActionFlash(t("common.paymentSentFlash"));
          void refreshUser();
          return;
        }
        if (res.reason === "PIN") {
          blypAlert(t("pay.paymentTitle"), t("pay.pinWrongLast"));
          return;
        }
        if (res.reason === "API") {
          blypAlert(
            t("pay.paymentTitle"),
            res.message ?? t("common.genericError"),
          );
        }
      } finally {
        busyRef.current = false;
        void clearQuickPayNotifHighlight();
      }
    },
    [token, phone, updateBalance, refreshUser, t, i18n.language],
  );

  const beginQuickPay = useCallback(
    async (amountFcfa: number) => {
      if (!QUICK_PAY_AMOUNTS.includes(amountFcfa as (typeof QUICK_PAY_AMOUNTS)[number])) {
        return;
      }
      if (!token) {
        requestQuickPayFromNotif(amountFcfa);
        return;
      }
      if (user?.needsOnboarding) {
        blypAlert(
          t("pay.onboardingRequiredTitle"),
          t("pay.onboardingRequiredMessage"),
        );
        void clearQuickPayNotifHighlight();
        return;
      }
      const to = await loadQuickPayRecipient();
      if (!to?.accountId) {
        void clearQuickPayNotifHighlight();
        blypAlert(
          t("profile.quickPayNotifTitle"),
          t("profile.quickPayNoRecipient"),
        );
        return;
      }
      if (amountFcfa > balance) {
        void clearQuickPayNotifHighlight();
        blypAlert(t("pay.paymentTitle"), t("pay.insufficientBalance"));
        return;
      }

      const active = await waitForAppActive();
      if (!active) {
        void clearQuickPayNotifHighlight();
        return;
      }
      await new Promise<void>((resolve) => {
        InteractionManager.runAfterInteractions(() => resolve());
      });

      if (!(await canUseDeviceAuth())) {
        void clearQuickPayNotifHighlight();
        blypAlert(
          t("profile.quickPayNotifTitle"),
          t("profile.quickPayDeviceAuthRequired"),
        );
        return;
      }

      const { hasTransactionPinVault, tryUnlockTransactionPinVault } =
        await import("@/lib/security/transactionPinVault");
      if (!(await hasTransactionPinVault())) {
        void clearQuickPayNotifHighlight();
        blypAlert(
          t("profile.quickPayNotifTitle"),
          t("profile.quickPayVaultRequired"),
        );
        return;
      }

      const vaulted = await tryUnlockTransactionPinVault(
        t("pay.deviceAuthPrompt"),
      );
      if (!vaulted) {
        void clearQuickPayNotifHighlight();
        return;
      }
      void runPay(amountFcfa, to, vaulted);
    },
    [token, user?.needsOnboarding, balance, t, runPay],
  );

  useEffect(() => {
    if (Platform.OS === "android" && !USE_MOCK_API) return () => {};
    return subscribeQuickPayFlow(beginQuickPay);
  }, [beginQuickPay]);

  return null;
}
