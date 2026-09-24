import { createCommerceHomeStyles } from "@/components/pay/commerceHomeStyles";
import { useAuth } from "@/contexts/authContextBase";
import { useTheme } from "@/contexts/ThemeContext";
import { useTaxiBroadcast } from "@/hooks/useTaxiBroadcast";
import { resolveBleBroadcastAccount } from "@/lib/ble/broadcastAccount";
import type { TransactionItem } from "@/lib/api/types";
import {
  formatTransactionDate,
  isTransactionJustNow,
  msUntilJustNowExpires,
} from "@/lib/format";
import { formatFcfa } from "@/lib/formatFcfa";
import {
  subscribeIncomingPaymentFlash,
  type IncomingPaymentFlash,
} from "@/lib/pay/incomingFlash";
import {
  getTransactionsSnapshot,
  subscribeTransactionsCache,
} from "@/lib/transactionsCache";
import { useFocusEffect } from "@react-navigation/native";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Switch,
  Text,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

const RECENT_RECEIVED_MAX = 5;
const RECEIVED_FLASH_MS = 10000;

function pickRecentReceived(
  items: TransactionItem[] | null,
): TransactionItem[] {
  if (!items?.length) return [];
  const out: TransactionItem[] = [];
  for (const tx of items) {
    if (tx.type !== "received") continue;
    out.push(tx);
    if (out.length >= RECENT_RECEIVED_MAX) break;
  }
  return out;
}

/**
 * Accueil mode pro : solde encaissé centré.
 * MAJ au focus (cache RAM) ; push « paiement reçu » hydrate via PushBootstrap.
 */
export function CommerceHomeScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createCommerceHomeStyles(colors), [colors]);
  const { user, token, refreshUser } = useAuth();
  const phone = user?.phone ?? "";
  const bleBroadcastAccount = useMemo(
    () => resolveBleBroadcastAccount(user),
    [user],
  );
  const broadcast = useTaxiBroadcast(bleBroadcastAccount);

  const [recentReceived, setRecentReceived] = useState<TransactionItem[]>(() =>
    phone ? pickRecentReceived(getTransactionsSnapshot(phone)) : [],
  );
  /** Bump léger pour quitter « Maintenant » sans poll. */
  const [justNowEpoch, setJustNowEpoch] = useState(0);
  const [receivedFlash, setReceivedFlash] =
    useState<IncomingPaymentFlash | null>(null);
  const focusedRef = useRef(false);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const viewingCommerceId =
    user?.activeContext?.type === "commerce"
      ? user.activeContext.commerceId
      : null;
  const viewingCommerceIdRef = useRef(viewingCommerceId);
  viewingCommerceIdRef.current = viewingCommerceId;

  const dismissReceivedFlash = useCallback(() => {
    if (flashTimerRef.current) {
      clearTimeout(flashTimerRef.current);
      flashTimerRef.current = null;
    }
    setReceivedFlash(null);
  }, []);

  const showReceivedFlash = useCallback(
    (event: IncomingPaymentFlash) => {
      if (flashTimerRef.current) {
        clearTimeout(flashTimerRef.current);
      }
      setReceivedFlash(event);
      flashTimerRef.current = setTimeout(() => {
        flashTimerRef.current = null;
        setReceivedFlash(null);
      }, RECEIVED_FLASH_MS);
      void import("expo-haptics")
        .then((H) => H.notificationAsync(H.NotificationFeedbackType.Success))
        .catch(() => {});
    },
    [],
  );

  const name =
    user?.activeContext?.type === "commerce"
      ? user.activeContext.name
      : user?.firstName?.trim() || t("common.account");
  const balance = user?.balanceFcfa ?? 0;

  const newestReceived = recentReceived[0];
  const newestIsJustNow = useMemo(() => {
    void justNowEpoch;
    return newestReceived
      ? isTransactionJustNow(newestReceived.createdAt)
      : false;
  }, [newestReceived, justNowEpoch]);

  useEffect(() => {
    if (!phone) {
      setRecentReceived([]);
      return;
    }
    setRecentReceived(pickRecentReceived(getTransactionsSnapshot(phone)));
    return subscribeTransactionsCache((p, items) => {
      if (p === phone) setRecentReceived(pickRecentReceived(items));
    });
  }, [phone]);

  // Un seul timeout jusqu’à expiration — zéro intervalle.
  useEffect(() => {
    if (!newestReceived) return;
    const wait = msUntilJustNowExpires(newestReceived.createdAt);
    if (wait == null) return;
    const id = setTimeout(() => setJustNowEpoch((n) => n + 1), wait + 32);
    return () => clearTimeout(id);
  }, [newestReceived?.id, newestReceived?.createdAt]);

  useEffect(() => {
    return subscribeIncomingPaymentFlash((event) => {
      if (!focusedRef.current) return;
      if (event.contextType !== "commerce") return;
      const viewingId = viewingCommerceIdRef.current;
      if (!viewingId) return;
      if (event.commerceId && event.commerceId !== viewingId) return;
      showReceivedFlash(event);
    });
  }, [showReceivedFlash]);

  useEffect(() => {
    return () => {
      if (flashTimerRef.current) {
        clearTimeout(flashTimerRef.current);
        flashTimerRef.current = null;
      }
    };
  }, []);

  useFocusEffect(
    useCallback(() => {
      focusedRef.current = true;
      // Re-évalue « Maintenant » au retour focus (pas de timer pendant l’onglet caché).
      setJustNowEpoch((n) => n + 1);
      if (!token) {
        return () => {
          focusedRef.current = false;
        };
      }
      void refreshUser().catch(() => {});
      void import("@/lib/sync/transactionsSync").then((m) => {
        if (phone) {
          void m.syncTransactionsFromNetwork(token, phone);
        }
      });
      return () => {
        focusedRef.current = false;
      };
    }, [token, refreshUser, phone]),
  );

  const onBroadcastToggle = useCallback(
    async (enabled: boolean) => {
      const { status, message } = await broadcast.setEnabled(enabled);
      if (!enabled || status === "broadcasting") return;
      const msg =
        status === "denied"
          ? t("profile.broadcastDenied")
          : status === "unavailable"
            ? t("profile.broadcastUnavailable")
            : status === "powered_off"
              ? t("profile.broadcastOffBt")
              : message === "INVALID_ACCOUNT"
                ? t("profile.broadcastInvalidAccount")
                : message && __DEV__
                  ? `${t("profile.broadcastError")}\n${message}`
                  : t("profile.broadcastError");
      Alert.alert(t("commerce.onlineLabel"), msg);
    },
    [broadcast.setEnabled, t],
  );

  return (
    <View style={[styles.safe, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.topBar,
          { paddingTop: Math.max(insets.top, 8) + 6 },
        ]}
        pointerEvents="box-none"
      >
        <Pressable
          style={styles.onlineRow}
          onPress={() => {
            if (broadcast.busy) return;
            void onBroadcastToggle(!broadcast.on);
          }}
          disabled={broadcast.busy}
          accessibilityRole="switch"
          accessibilityState={{ checked: broadcast.on, disabled: broadcast.busy }}
          accessibilityLabel={t("commerce.onlineLabel")}
          hitSlop={{ top: 8, bottom: 8, left: 12, right: 8 }}
        >
          <Text
            style={[styles.onlineLabel, broadcast.on && styles.onlineLabelOn]}
          >
            {broadcast.on ? t("commerce.onlineOn") : t("commerce.onlineOff")}
          </Text>
          {broadcast.busy ? (
            <ActivityIndicator color={colors.accent} size="small" />
          ) : (
            <View style={styles.onlineSwitchWrap} pointerEvents="none">
              <Switch
                value={broadcast.on}
                trackColor={{
                  false: colors.border,
                  true: colors.avatarBackground,
                }}
                thumbColor={
                  broadcast.on ? colors.accent : colors.textSecondary
                }
                ios_backgroundColor={colors.border}
              />
            </View>
          )}
        </Pressable>
      </View>

      <SafeAreaView style={styles.bodySafe} edges={["left", "right"]}>
        <View style={styles.body}>
          <View style={styles.center}>
            <View style={styles.balanceBlock}>
              <Text style={styles.balanceLabel}>
                {t("commerce.homeBalanceLabel")}
              </Text>
              <View style={styles.balanceCircle}>
                <View style={styles.balanceValueWrap}>
                  <Text
                    style={styles.balanceValue}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.28}
                    allowFontScaling={false}
                  >
                    {formatFcfa(balance)}
                  </Text>
                </View>
                <Text style={styles.balanceCurrency}>{t("common.fcfa")}</Text>
              </View>
            </View>

            {recentReceived.length > 0 ? (
              <View style={styles.recentCard}>
                <Text style={styles.recentLabel}>
                  {t("commerce.homeRecentReceived")}
                </Text>
                <ScrollView
                  style={styles.recentScroll}
                  contentContainerStyle={styles.recentScrollContent}
                  showsVerticalScrollIndicator={false}
                  nestedScrollEnabled
                  keyboardShouldPersistTaps="handled"
                >
                  {recentReceived.map((tx, index) => (
                    <View
                      key={tx.id}
                      style={[
                        styles.recentRow,
                        index < recentReceived.length - 1 &&
                          styles.recentRowBorder,
                      ]}
                    >
                      <Text style={styles.recentAmount} numberOfLines={1}>
                        +{formatFcfa(tx.amountFcfa)}
                      </Text>
                      <View style={styles.recentTexts}>
                        <Text style={styles.recentName} numberOfLines={1}>
                          {tx.counterpartyName}
                        </Text>
                        <Text
                          style={[
                            styles.recentDate,
                            index === 0 &&
                              newestIsJustNow &&
                              styles.recentDateJustNow,
                          ]}
                          numberOfLines={1}
                        >
                          {index === 0 && newestIsJustNow
                            ? t("dates.now")
                            : formatTransactionDate(tx.createdAt)}
                        </Text>
                      </View>
                    </View>
                  ))}
                </ScrollView>
              </View>
            ) : (
              <Text style={styles.lastTxEmpty}>
                {t("commerce.homeLastReceivedEmpty")}
              </Text>
            )}
          </View>

          <View style={styles.footerMeta}>
            <Text style={styles.footerLine} numberOfLines={1}>
              {t("commerce.homeEyebrow")}
              {" · "}
              {name}
            </Text>
          </View>
        </View>
      </SafeAreaView>

      {receivedFlash ? (
        <View
          style={styles.flashOverlay}
          accessibilityViewIsModal
          accessibilityLabel={t("commerce.receivedFlashA11y", {
            amount: formatFcfa(receivedFlash.amountFcfa),
          })}
        >
          <Pressable
            style={styles.flashBackdrop}
            onPress={dismissReceivedFlash}
            accessibilityRole="button"
            accessibilityLabel={t("common.close")}
          />
          <Pressable
            style={[
              styles.flashSheet,
              { paddingBottom: Math.max(insets.bottom, 16) + 10 },
            ]}
            onPress={dismissReceivedFlash}
          >
            <Text style={styles.flashTitle}>{t("pay.received")}</Text>
            <Text
              style={styles.flashAmount}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.35}
              allowFontScaling={false}
            >
              +{formatFcfa(receivedFlash.amountFcfa)}
            </Text>
            <Text style={styles.flashCurrency}>{t("common.fcfa")}</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}
