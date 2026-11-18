import { ShellPayIslandBack } from "@/components/pay/ShellPayIslandBack";
import { PayAmountEntry } from "@/components/pay/PayAmountEntry";
import { createPayHomeStyles } from "@/components/pay/payHomeStyles";
import { useAuth } from "@/contexts/authContextBase";
import { useTheme } from "@/contexts/ThemeContext";
import { getUserSnapshot } from "@/lib/auth/authSession";
import { DEFAULT_QUICK_AMOUNTS } from "@/lib/pay/quickAmounts";
import {
  queuePayAmountFromShell,
  setShellPayDigits,
} from "@/lib/pay/payHomeHandoff";
import {
  consumeNativeBootPayHandoff,
  notifyNativePayInteractive,
} from "@/lib/pay/nativeColdStart";
import { useMarkRootShellReady } from "@/lib/rootShellReady";
import { useTranslation } from "react-i18next";
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

/**
 * Pay utilisable au 1er frame (pad + solde) pendant le chargement de PayHomeScreen.
 * Imports volontairement limités — pas de Ionicons, pas de modales lourdes.
 */
export function PayHomeInstantShell() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => createPayHomeStyles(colors), [colors]);
  const { user, token } = useAuth();
  const balance = user?.balanceFcfa ?? getUserSnapshot()?.balanceFcfa ?? 0;
  const resetKey = `${user?.personalAccountId ?? user?.phone ?? "anon"}-shell`;
  const [peerLabel, setPeerLabel] = useState<string | null>(null);
  const [bootDigits, setBootDigits] = useState("");

  useMarkRootShellReady();

  useLayoutEffect(() => {
    void consumeNativeBootPayHandoff().then(({ digits, pendingPayFcfa }) => {
      if (digits) {
        setShellPayDigits(digits);
        setBootDigits(digits);
      }
      if (pendingPayFcfa > 0) {
        queuePayAmountFromShell(pendingPayFcfa);
      }
      notifyNativePayInteractive();
    });
  }, []);

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      void import("@/lib/auth/authSession").then(({ getAccessToken }) => {
        void import("@/lib/perf/postPayBoot").then((m) => {
          m.markPayTabFirstPaint({
            token: getAccessToken(),
            phone: user?.phone ?? getUserSnapshot()?.phone ?? null,
          });
        });
      });
    });
    return () => cancelAnimationFrame(id);
  }, [user?.phone]);

  useEffect(() => {
    let unsubPeer = () => {};
    let cancelled = false;
    void import("@/lib/ble/scan").then((scan) => {
      if (cancelled) return;
      const apply = () => {
        const p = scan.getBleTaxiPeerSnapshot();
        setPeerLabel(p?.displayName?.trim() || null);
      };
      apply();
      unsubPeer = scan.subscribeBleTaxiPeer(() => apply());
      void scan.startTaxiScan();
    });
    void import("@/lib/ble/warmBroadcast").then((m) => {
      m.warmBleBroadcastRadio();
    });
    return () => {
      cancelled = true;
      unsubPeer();
    };
  }, []);

  const onPay = useCallback((amountFcfa: number) => {
    queuePayAmountFromShell(amountFcfa);
  }, []);

  const onAmountChange = useCallback((amount: number | null) => {
    if (amount == null) {
      setShellPayDigits("");
      return;
    }
    setShellPayDigits(String(Math.floor(amount)));
  }, []);

  const headerTitle = peerLabel ?? t("pay.searchingNearby");

  return (
    <SafeAreaView style={styles.safeArea} edges={["top"]}>
      <ShellPayIslandBack />
      <View style={styles.payScreenBody}>
        <View style={styles.payTopBlock}>
          <View style={styles.topBarRow}>
            <View style={styles.recipientRow}>
              <View style={styles.recipientThumb}>
                <Text style={styles.recipientThumbLetter}>
                  {peerLabel ? peerLabel.slice(0, 1).toUpperCase() : "?"}
                </Text>
              </View>
              <View style={styles.recipientTexts}>
                <Text style={styles.driverName} numberOfLines={1}>
                  {headerTitle}
                </Text>
                <Text style={styles.driverPhone} numberOfLines={1}>
                  {peerLabel ? t("pay.payKey") : "BLE"}
                </Text>
              </View>
            </View>
          </View>
        </View>
        <PayAmountEntry
          styles={styles}
          resetKey={`${resetKey}-${bootDigits}`}
          initialDigits={bootDigits || undefined}
          onPay={onPay}
          onAmountFcfaChange={onAmountChange}
          balanceFcfa={balance <= 1000 ? balance : null}
          quickAmounts={DEFAULT_QUICK_AMOUNTS}
          amountLabel={t("pay.amountLabel")}
        />
      </View>
    </SafeAreaView>
  );
}
