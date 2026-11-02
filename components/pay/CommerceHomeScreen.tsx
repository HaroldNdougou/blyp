import { IncomingPaymentFlashSheet } from "@/components/pay/IncomingPaymentFlashSheet";
import { createCommerceHomeStyles } from "@/components/pay/commerceHomeStyles";
import { SoaCarCommerceHome } from "@/components/soa/SoaCarCommerceHome";
import { BlypDialog } from "@/components/ui/BlypDialog";
import { isSoaCarCategory } from "@/lib/soa/soaCar";
import { useAuth } from "@/contexts/authContextBase";
import { useNetwork } from "@/contexts/NetworkContext";
import { useTheme } from "@/contexts/ThemeContext";
import { useOfflineCashierMode } from "@/hooks/useOfflineCashierMode";
import { useTaxiBroadcast } from "@/hooks/useTaxiBroadcast";
import { warmBleBroadcastRadio } from "@/lib/ble/warmBroadcast";
import { resolveBleBroadcastAccount } from "@/lib/ble/broadcastAccount";
import { showBroadcastFailureAlert } from "@/lib/ble/broadcastAlertMessage";
import {
  disableOfflineCashierMode,
  enableOfflineCashierMode,
  runOfflineCashierBackgroundSync,
} from "@/lib/commerce/offlineCashierMode";
import { handleCommercePaymentReceipt } from "@/lib/commerce/handleCommercePaymentReceipt";
import {
  startMerchantClosedCashierGatt,
  stopMerchantClosedCashierGatt,
  subscribeMerchantClosedCashierReceipt,
} from "@/lib/commerce/closedCashierGattMerchant";
import type { CommercePaymentReceipt } from "@/lib/pay/paymentReceipt";
import {
  hydratePendingCommerceReceiptsOnce,
  sumPendingCommerceReceiptsFcfa,
  subscribePendingCommerceReceipts,
} from "@/lib/commerce/pendingCommerceReceipts";
import { reconcilePendingCommerceReceipts } from "@/lib/commerce/reconcilePendingCommerceReceipts";
import type { TransactionItem } from "@/lib/api/types";
import { fetchIsNetworkConnected } from "@/lib/network/fetchIsConnected";
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
  soaCommerceDayKey,
  soaCommerceDayKeyFromIso,
} from "@/lib/soa/soaDayKey";
import {
  getTransactionsSnapshot,
  subscribeTransactionsCache,
} from "@/lib/transactionsCache";
import { useFocusEffect } from "@react-navigation/native";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  InteractionManager,
  Pressable,
  ScrollView,
  Switch,
  Text,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

const RECENT_RECEIVED_MAX = 5;
const RECEIVED_FLASH_MS = 10000;

function pickRecentReceivedToday(
  items: TransactionItem[] | null,
): TransactionItem[] {
  if (!items?.length) return [];
  const todayKey = soaCommerceDayKey();
  const out: TransactionItem[] = [];
  for (const tx of items) {
    if (tx.type !== "received") continue;
    if (soaCommerceDayKeyFromIso(tx.createdAt) !== todayKey) continue;
    out.push(tx);
    if (out.length >= RECENT_RECEIVED_MAX) break;
  }
  return out;
}

function sumReceivedTodayFcfa(items: TransactionItem[] | null): number {
  if (!items?.length) return 0;
  const todayKey = soaCommerceDayKey();
  let sum = 0;
  for (const tx of items) {
    if (tx.type !== "received") continue;
    if (soaCommerceDayKeyFromIso(tx.createdAt) !== todayKey) continue;
    sum += tx.amountFcfa;
  }
  return sum;
}

/**
 * Accueil mode pro : recette du jour (Douala) centrée.
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
  const [onlineActivating, setOnlineActivating] = useState(false);
  const [offlineOfferVisible, setOfflineOfferVisible] = useState(false);
  const [offlineAlreadyVisible, setOfflineAlreadyVisible] = useState(false);
  const [offlineDisableBlockedVisible, setOfflineDisableBlockedVisible] =
    useState(false);
  const [offlineExitBusy, setOfflineExitBusy] = useState(false);
  const [receiptRejectAlertVisible, setReceiptRejectAlertVisible] =
    useState(false);
  const { reconnectGeneration } = useNetwork();

  const [recentReceived, setRecentReceived] = useState<TransactionItem[]>(() =>
    phone ? pickRecentReceivedToday(getTransactionsSnapshot(phone)) : [],
  );
  const [todayReceivedFcfa, setTodayReceivedFcfa] = useState(() =>
    phone ? sumReceivedTodayFcfa(getTransactionsSnapshot(phone)) : 0,
  );

  const applyTxSnapshot = useCallback((items: TransactionItem[] | null) => {
    setRecentReceived(pickRecentReceivedToday(items));
    setTodayReceivedFcfa(sumReceivedTodayFcfa(items));
  }, []);
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
  const { active: offlineCashierActive } =
    useOfflineCashierMode(viewingCommerceId);
  const [pendingReceiptsFcfa, setPendingReceiptsFcfa] = useState(0);
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
  const activeCommerceCategory = useMemo(() => {
    if (user?.activeContext?.type !== "commerce") return null;
    const ctx = user.activeContext;
    return (
      ctx.category ??
      user.commerces?.find((c) => c.id === ctx.commerceId)?.category ??
      null
    );
  }, [user?.activeContext, user?.commerces]);

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
      setTodayReceivedFcfa(0);
      return;
    }
    applyTxSnapshot(getTransactionsSnapshot(phone));
    return subscribeTransactionsCache((p, items) => {
      if (p === phone) applyTxSnapshot(items);
    });
  }, [phone, applyTxSnapshot]);

  useEffect(() => {
    if (!viewingCommerceId) {
      setPendingReceiptsFcfa(0);
      return;
    }
    hydratePendingCommerceReceiptsOnce();
    const bump = () => {
      setPendingReceiptsFcfa(
        sumPendingCommerceReceiptsFcfa(viewingCommerceId),
      );
    };
    bump();
    return subscribePendingCommerceReceipts(bump);
  }, [viewingCommerceId]);

  useEffect(() => {
    if (!offlineCashierActive || !viewingCommerceId || !phone) return;
    const run = () => {
      void reconcilePendingCommerceReceipts({
        commerceId: viewingCommerceId,
        transactions: getTransactionsSnapshot(phone),
      }).then((r) => {
        if (r.rejected > 0) setReceiptRejectAlertVisible(true);
      });
    };
    run();
    return subscribeTransactionsCache((p, items) => {
      if (p === phone) run();
    });
  }, [offlineCashierActive, viewingCommerceId, phone]);

  useEffect(() => {
    if (
      !offlineCashierActive ||
      !viewingCommerceId ||
      !bleBroadcastAccount?.accountId
    ) {
      return;
    }
    const merchantAccountId = bleBroadcastAccount.accountId;
    let alive = true;
    void startMerchantClosedCashierGatt(merchantAccountId);
    const unsubNative = subscribeMerchantClosedCashierReceipt((json) => {
      if (!alive) return;
      try {
        const receipt = JSON.parse(json) as CommercePaymentReceipt;
        void handleCommercePaymentReceipt({
          receipt,
          commerceId: viewingCommerceId,
          merchantAccountId,
        });
      } catch {
        /* ignore */
      }
    });
    return () => {
      alive = false;
      unsubNative();
      void stopMerchantClosedCashierGatt();
    };
  }, [
    offlineCashierActive,
    viewingCommerceId,
    bleBroadcastAccount?.accountId,
  ]);

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
          void m.syncTransactionsFromNetwork(token, phone, {
            reason: "commerce_focus",
          });
        }
      });
      const warm = InteractionManager.runAfterInteractions(() => {
        warmBleBroadcastRadio();
      });
      return () => {
        focusedRef.current = false;
        warm.cancel?.();
      };
    }, [token, refreshUser, phone]),
  );

  const lastReconnectGenRef = useRef(0);
  useEffect(() => {
    if (!offlineCashierActive || !token || !phone) return;
    if (reconnectGeneration <= lastReconnectGenRef.current) return;
    lastReconnectGenRef.current = reconnectGeneration;
    void runOfflineCashierBackgroundSync({
      token,
      phone,
      commerceId: viewingCommerceId ?? "",
      refreshUser,
    });
  }, [
    offlineCashierActive,
    reconnectGeneration,
    token,
    phone,
    refreshUser,
    viewingCommerceId,
  ]);

  const enableOnlineBroadcast = useCallback(
    async (enabled: boolean) => {
      setOnlineActivating(true);
      try {
        void import("expo-haptics")
          .then((H) => H.impactAsync(H.ImpactFeedbackStyle.Light))
          .catch(() => {});
        const { status, message } = await broadcast.setEnabled(enabled);
        if (!enabled || status === "broadcasting") return;
        showBroadcastFailureAlert(
          t,
          t("commerce.onlineLabel"),
          status,
          message,
        );
      } finally {
        setOnlineActivating(false);
      }
    },
    [broadcast.setEnabled, t],
  );

  const onBroadcastToggle = useCallback(
    async (enabled: boolean) => {
      if (enabled) {
        const connected = await fetchIsNetworkConnected();
        if (!connected) {
          if (offlineCashierActive) {
            setOfflineAlreadyVisible(true);
          } else {
            setOfflineOfferVisible(true);
          }
          return;
        }
      }
      await enableOnlineBroadcast(enabled);
    },
    [enableOnlineBroadcast, offlineCashierActive],
  );

  const onConfirmOfflineCashierMode = useCallback(async () => {
    setOfflineOfferVisible(false);
    if (!viewingCommerceId) return;
    await enableOfflineCashierMode(viewingCommerceId);
    if (broadcast.wantOn) {
      await enableOnlineBroadcast(false);
    }
  }, [viewingCommerceId, broadcast.wantOn, enableOnlineBroadcast]);

  const onRequestExitOfflineCashier = useCallback(async () => {
    if (offlineExitBusy) return;
    setOfflineExitBusy(true);
    try {
      const connected = await fetchIsNetworkConnected();
      if (!connected) {
        setOfflineDisableBlockedVisible(true);
        return;
      }
      await disableOfflineCashierMode();
      if (token && phone) {
        void runOfflineCashierBackgroundSync({
          token,
          phone,
          commerceId: viewingCommerceId ?? "",
          refreshUser,
        });
      }
    } finally {
      setOfflineExitBusy(false);
    }
  }, [offlineExitBusy, token, phone, refreshUser]);

  if (
    viewingCommerceId &&
    isSoaCarCategory(activeCommerceCategory) &&
    user?.activeContext?.type === "commerce"
  ) {
    return (
      <SoaCarCommerceHome
        commerceId={viewingCommerceId}
        commerceName={user.activeContext.name}
      />
    );
  }

  return (
    <View
      style={[
        styles.safe,
        offlineCashierActive && styles.offlineShell,
        {
          backgroundColor: offlineCashierActive
            ? colors.offlineCashierShellBackground
            : colors.background,
        },
      ]}
    >
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
            if (onlineActivating) return;
            void onBroadcastToggle(!broadcast.wantOn);
          }}
          disabled={onlineActivating}
          accessibilityRole="switch"
          accessibilityState={{
            checked: broadcast.wantOn,
            busy: onlineActivating || broadcast.busy,
          }}
          accessibilityLabel={t("commerce.onlineLabel")}
          hitSlop={{ top: 8, bottom: 8, left: 12, right: 8 }}
        >
          <Text
            style={[
              styles.onlineLabel,
              broadcast.wantOn && styles.onlineLabelOn,
            ]}
          >
            {broadcast.busy
              ? t("commerce.onlineReconnecting")
              : broadcast.wantOn
                ? broadcast.on
                  ? t("commerce.onlineOn")
                  : t("commerce.onlineReconnecting")
                : t("commerce.onlineOff")}
          </Text>
          <View style={styles.onlineSwitchWrap} pointerEvents="none">
            <Switch
              value={broadcast.wantOn}
              trackColor={{
                false: colors.switchTrackOff,
                true: colors.switchTrackOn,
              }}
              thumbColor={
                broadcast.wantOn ? colors.switchThumbOn : colors.switchThumbOff
              }
              ios_backgroundColor={colors.switchTrackOff}
            />
          </View>
        </Pressable>
      </View>

      <SafeAreaView style={styles.bodySafe} edges={["left", "right"]}>
        <View style={styles.body}>
          {offlineCashierActive ? (
            <View style={styles.offlineBanner}>
              <Text style={styles.offlineBannerTitle}>
                {t("commerce.offlineCashierBanner")}
              </Text>
              <Text style={styles.offlineBannerHint}>
                {t("commerce.offlineCashierBannerHint")}
              </Text>
            </View>
          ) : null}
          <View style={styles.center}>
            <View style={styles.balanceBlock}>
              <Text style={styles.balanceLabel}>{t("dates.today")}</Text>
              <View
                style={[
                  styles.balanceCircle,
                  offlineCashierActive && styles.offlineBalanceCircle,
                ]}
              >
                <View style={styles.balanceValueWrap}>
                  <Text
                    style={styles.balanceValue}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.28}
                    allowFontScaling={false}
                  >
                    {formatFcfa(todayReceivedFcfa)}
                  </Text>
                </View>
                {offlineCashierActive && pendingReceiptsFcfa > 0 ? (
                  <Text style={styles.balancePendingHint}>
                    {t("commerce.offlineCashierPendingBadge", {
                      amount: formatFcfa(pendingReceiptsFcfa),
                    })}
                  </Text>
                ) : null}
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

          {offlineCashierActive ? (
            <View style={styles.offlineExitWrap}>
              <Pressable
                style={({ pressed }) => [
                  styles.offlineExitBtn,
                  pressed && styles.offlineExitBtnPressed,
                ]}
                onPress={() => void onRequestExitOfflineCashier()}
                disabled={offlineExitBusy}
                accessibilityRole="button"
                accessibilityLabel={t("commerce.offlineCashierExitA11y")}
              >
                <Text style={styles.offlineExitBtnText}>
                  {t("commerce.offlineCashierExitCta")}
                </Text>
              </Pressable>
            </View>
          ) : null}

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
        <IncomingPaymentFlashSheet
          amountFcfa={receivedFlash.amountFcfa}
          onDismiss={dismissReceivedFlash}
        />
      ) : null}

      <BlypDialog
        visible={offlineOfferVisible}
        title={t("commerce.offlineCashierOfferTitle")}
        message={t("commerce.offlineCashierOfferMessage")}
        icon="cloud-offline-outline"
        iconColor={colors.offlineCashierShellBorder}
        cancelable
        onBackdropPress={() => setOfflineOfferVisible(false)}
        buttons={[
          {
            text: t("commerce.offlineCashierOfferCancel"),
            onPress: () => setOfflineOfferVisible(false),
          },
          {
            text: t("commerce.offlineCashierOfferPrimary"),
            variant: "primary",
            onPress: () => void onConfirmOfflineCashierMode(),
          },
        ]}
      />

      <BlypDialog
        visible={offlineAlreadyVisible}
        title={t("commerce.offlineCashierAlreadyTitle")}
        message={t("commerce.offlineCashierAlreadyMessage")}
        icon="information-circle-outline"
        iconColor={colors.offlineCashierShellBorder}
        cancelable
        onBackdropPress={() => setOfflineAlreadyVisible(false)}
        buttons={[
          {
            text: t("commerce.offlineCashierDisableBlockedOk"),
            variant: "primary",
            onPress: () => setOfflineAlreadyVisible(false),
          },
        ]}
      />

      <BlypDialog
        visible={offlineDisableBlockedVisible}
        title={t("commerce.offlineCashierDisableBlockedTitle")}
        message={t("commerce.offlineCashierDisableBlockedMessage")}
        icon="warning-outline"
        iconColor={colors.destructive}
        cancelable
        onBackdropPress={() => setOfflineDisableBlockedVisible(false)}
        buttons={[
          {
            text: t("commerce.offlineCashierDisableBlockedOk"),
            variant: "primary",
            onPress: () => setOfflineDisableBlockedVisible(false),
          },
        ]}
      />

      <BlypDialog
        visible={receiptRejectAlertVisible}
        title={t("commerce.offlineCashierRejectTitle")}
        message={t("commerce.offlineCashierRejectMessage")}
        icon="shield-outline"
        iconColor={colors.destructive}
        cancelable
        onBackdropPress={() => setReceiptRejectAlertVisible(false)}
        buttons={[
          {
            text: t("commerce.offlineCashierDisableBlockedOk"),
            variant: "primary",
            onPress: () => setReceiptRejectAlertVisible(false),
          },
        ]}
      />
    </View>
  );
}
