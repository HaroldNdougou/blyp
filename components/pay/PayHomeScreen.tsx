import "@/lib/perf/eagerRoutes";
import { DepositOpenChrome } from "@/components/deposit/DepositOpenChrome";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { MAX_AMOUNT_DIGITS, parseAmountFcfa } from "@/lib/amountLimits";
import { ApiError, isTransactionPinInvalidError } from "@/lib/api/errors";
import { formatCameroonPhoneDisplay } from "@/lib/format";
import { formatFcfa } from "@/lib/formatFcfa";
import i18n, { getNumberLocale, type AppLanguage } from "@/lib/i18n";
import { openDepositRoute } from "@/lib/nav/openDeposit";
import { runAggressiveWarm } from "@/lib/perf/aggressiveWarm";
import { perfMarkEnd, perfMarkStart } from "@/lib/perf/marks";
import { useMarkRootShellReady } from "@/lib/rootShellReady";
import { fallbackTxReference } from "@/lib/txReference";
import { useFocusEffect } from "@react-navigation/native";
import { router, Stack } from "expo-router";
import React, {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  BackHandler,
  Image,
  InteractionManager,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";

import { AmountNumericKeypad } from "@/components/pay/AmountNumericKeypad";
import { MaskedPinInput } from "@/components/pay/MaskedPinInput";
import { CheckGlyph } from "@/components/pay/PayGlyphs";
import { createPayHomeStyles } from "@/components/pay/payHomeStyles";
import { PayRegisterOverlayFallback } from "@/components/pay/PayRegisterOverlayFallback";
import { useTranslation } from "react-i18next";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";

/** Même cible que `lazy` : le préchargement remplit le cache avant le 1er « Connexion rapide ». */
const importPayRegisterOverlay = () => import("./PayRegisterOverlay");
const PayRegisterOverlay = lazy(importPayRegisterOverlay);

const ONBOARDING_PIN_LEN = 4;

/** Limite côté app (l’API doit appliquer sa propre politique). */
const PAY_PIN_MAX_ATTEMPTS = 5;
/** Blocage temporaire après épuisement des tentatives (ms). */
const PAY_PIN_LOCKOUT_MS = 2 * 60 * 1000;

/**
 * Si true : ouverture auto du sheet inscription (compte manquant / onboarding).
 * Sans le bouton « Créer un compte », passe à true si tu n’as pas d’autre entrée vers l’inscription.
 */
const AUTO_OPEN_REGISTER_SHEET_ON_LAUNCH = false;

/** Bénéficiaire démo (écran paiement) — référence stable pour les hooks. */
const DEMO_DRIVER = {
  name: "Taxi Mohamadou",
  phone: "698 25 68 96",
  avatar: null,
};

type PaymentReceipt = {
  amountFcfa: number;
  recipientName: string;
  recipientPhone: string;
  paidAt: string;
  balanceFcfa: number;
  reference: string;
};

function formatReceiptDateTime(iso: string): string {
  const d = new Date(iso);
  const lang: AppLanguage = i18n.language === "fr" ? "fr" : "en";
  const locale = getNumberLocale(lang);
  const date = d.toLocaleDateString(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const time = d.toLocaleTimeString(locale, {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${date} · ${time}`;
}

export default function PayHomeScreen() {
  useMarkRootShellReady();
  useEffect(() => {
    perfMarkStart("pay_home_open");
    const id = requestAnimationFrame(() => {
      perfMarkEnd("pay_home_open");
    });
    return () => cancelAnimationFrame(id);
  }, []);
  const [depositChrome, setDepositChrome] = useState(false);
  const openDepositInstant = useCallback(() => {
    setDepositChrome(true);
    openDepositRoute();
  }, []);
  useFocusEffect(
    useCallback(() => {
      setDepositChrome(false);
    }, []),
  );
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => createPayHomeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const successSlideX = useRef(new Animated.Value(0)).current;
  const { user, token, isLoading: authLoading, refreshUser } = useAuth();
  const userPhone = user?.phone ?? "";
  const [amount, setAmount] = useState("");
  const [paymentStatus, setPaymentStatus] = useState<'IDLE' | 'SENDING' | 'SUCCESS'>('IDLE');
  /** Feedback PIN : spinner → coche succès → écran Payé. */
  const [payPinUi, setPayPinUi] = useState<"idle" | "sending" | "success">(
    "idle",
  );
  const [payPinModalVisible, setPayPinModalVisible] = useState(false);
  const [payPinDraft, setPayPinDraft] = useState("");
  /** Contrôle ponctuel du curseur après refocus (Android + secureTextEntry). */
  const [payPinSelection, setPayPinSelection] = useState<
    { start: number; end: number } | undefined
  >(undefined);
  const [payPinErrorLine, setPayPinErrorLine] = useState<string | null>(null);
  const [payPinLockoutUntil, setPayPinLockoutUntil] = useState<number | null>(
    null,
  );
  const [payPendingAmount, setPayPendingAmount] = useState(0);
  const [paymentReceipt, setPaymentReceipt] = useState<PaymentReceipt | null>(
    null,
  );
  const payPinFailedRef = useRef(0);
  const balance = user?.balanceFcfa ?? 0;
  const [registerInviteVisible, setRegisterInviteVisible] = useState(false);
  /** null = fermé ; même UI que la connexion rapide, message selon le contexte. */
  const [connexionPromptKind, setConnexionPromptKind] = useState<
    null | "pay" | "recharge"
  >(null);
  const [insufficientBalanceVisible, setInsufficientBalanceVisible] =
    useState(false);
  const inviteBootstrapped = useRef(false);
  const prevUserRef = useRef(user);
  const payPinInputRef = useRef<TextInput>(null);
  const payPinFocusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Une seule rafale de focus auto par ouverture du sheet. */
  const payPinOpenFocusGenRef = useRef(0);
  /** Remount TextInput → autoFocus fiable (Modal RN cassait le clavier). */
  const [payPinInputKey, setPayPinInputKey] = useState(0);
  /** Soulève le sheet PIN au-dessus du clavier (Android overlay). */
  const [payPinKeyboardLift, setPayPinKeyboardLift] = useState(0);

  const showRegisterOverlay =
    registerInviteVisible && (!user || Boolean(user.needsOnboarding));

  useEffect(() => {
    if (prevUserRef.current && !user) {
      inviteBootstrapped.current = false;
    }
    prevUserRef.current = user;
  }, [user]);

  useEffect(() => {
    if (authLoading) return;
    if (!inviteBootstrapped.current) {
      inviteBootstrapped.current = true;
      if (AUTO_OPEN_REGISTER_SHEET_ON_LAUNCH) {
        if (!user || user.needsOnboarding) {
          setRegisterInviteVisible(true);
        }
      }
    }
  }, [authLoading, user]);

  useEffect(() => {
    if (user && !user.needsOnboarding) {
      setRegisterInviteVisible(false);
    }
  }, [user]);

  useEffect(() => {
    if (!token) setAmount("");
  }, [token]);

  /**
   * Splash sacré → puis flood prefetch (mémoire) : onglets, dépôt, register, cache.
   * Zéro concession latence clic.
   */
  useEffect(() => {
    if (authLoading) return;
    runAggressiveWarm({ token, phone: user?.phone });
    if (!token) void importPayRegisterOverlay();
  }, [authLoading, token, user?.phone]);

  /**
   * Ne pas lier le cleanup du timer à payPinModalVisible : au passage false→true,
   * React exécute le cleanup de l’effet précédent et annulait le focus programmé par onShow
   * → clavier qui ne s’ouvrait pas.
   */
  useEffect(() => {
    return () => {
      if (payPinFocusTimerRef.current) {
        clearTimeout(payPinFocusTimerRef.current);
        payPinFocusTimerRef.current = null;
      }
    };
  }, []);

  /**
   * Clavier PIN : overlay in-tree + remount TextInput (autoFocus).
   * Les retries couvrent MIUI / IME lent.
   */
  const schedulePayPinFieldFocus = useCallback(
    (opts?: { afterWrongPin?: boolean }) => {
      const afterWrong = opts?.afterWrongPin ?? false;
      const gen = payPinOpenFocusGenRef.current;
      if (payPinFocusTimerRef.current) {
        clearTimeout(payPinFocusTimerRef.current);
        payPinFocusTimerRef.current = null;
      }

      const tryFocus = (attempt: number) => {
        if (gen !== payPinOpenFocusGenRef.current) return;
        const input = payPinInputRef.current;
        if (!input) {
          if (attempt < 20) {
            payPinFocusTimerRef.current = setTimeout(
              () => tryFocus(attempt + 1),
              40,
            );
          }
          return;
        }
        setPayPinSelection(undefined);
        input.focus();
        if (Platform.OS === "android" && attempt < 6) {
          payPinFocusTimerRef.current = setTimeout(
            () => tryFocus(attempt + 1),
            80,
          );
        } else {
          payPinFocusTimerRef.current = null;
        }
      };

      if (afterWrong && Platform.OS === "android") {
        setPayPinSelection(undefined);
        payPinInputRef.current?.blur();
        payPinFocusTimerRef.current = setTimeout(() => {
          InteractionManager.runAfterInteractions(() => {
            requestAnimationFrame(() => {
              setPayPinInputKey((k) => k + 1);
              payPinFocusTimerRef.current = setTimeout(() => tryFocus(0), 50);
            });
          });
        }, 120);
        return;
      }

      payPinFocusTimerRef.current = setTimeout(() => {
        InteractionManager.runAfterInteractions(() => {
          requestAnimationFrame(() => tryFocus(0));
        });
      }, Platform.OS === "android" ? 50 : 16);
    },
    [],
  );

  useEffect(() => {
    if (!payPinModalVisible) return;
    schedulePayPinFieldFocus();
    return () => {
      if (payPinFocusTimerRef.current) {
        clearTimeout(payPinFocusTimerRef.current);
        payPinFocusTimerRef.current = null;
      }
    };
  }, [payPinModalVisible, schedulePayPinFieldFocus, payPinInputKey]);

  const AMOUNT_MAX_LEN = MAX_AMOUNT_DIGITS;

  const onAmountDigit = useCallback((digit: string) => {
    setAmount((prev) => {
      const d = digit.replace(/\D/g, "");
      if (!d) return prev;
      if (prev.length >= AMOUNT_MAX_LEN) return prev;
      if (prev === "" && d === "0") return prev;
      if (prev === "0") return d;
      return prev + d;
    });
  }, []);

  const onAmountBackspace = useCallback(() => {
    setAmount((prev) => prev.slice(0, -1));
  }, []);

  const handlePay = () => {
    const n = parseAmountFcfa(amount);
    if (n == null || paymentStatus === "SENDING") return;
    if (!token) {
      Keyboard.dismiss();
      void importPayRegisterOverlay();
      setConnexionPromptKind("pay");
      return;
    }
    if (user?.needsOnboarding) {
      Alert.alert(
        t("pay.onboardingRequiredTitle"),
        t("pay.onboardingRequiredMessage"),
      );
      return;
    }
    /**
     * Contrôle local instantané (même solde qu’en haut à droite). L’API reste
     * la seule autorité : un solde obsolète côté app ne permet pas de payer en excédent.
     */
    if (user != null && n > balance) {
      Keyboard.dismiss();
      setInsufficientBalanceVisible(true);
      return;
    }
    const now = Date.now();
    const lockUntil = payPinLockoutUntil;
    if (lockUntil != null && now >= lockUntil) {
      setPayPinLockoutUntil(null);
    }
    const stillLocked = lockUntil != null && now < lockUntil;
    if (stillLocked) {
      const sec = Math.ceil((lockUntil - now) / 1000);
      const min = Math.floor(sec / 60);
      const s = sec % 60;
      Alert.alert(
        t("pay.securePaymentTitle"),
        min > 0
          ? t("pay.retryInMinSec", { min, sec: s })
          : t("pay.retryInSec", { sec: s }),
      );
      return;
    }
    // Ne pas Keyboard.dismiss() ici : ça empêche souvent l’IME de se rouvrir juste après.
    payPinFailedRef.current = 0;
    setPayPinErrorLine(null);
    setPayPinSelection(undefined);
    setPayPinUi("idle");
    setPayPendingAmount(n);
    setPayPinDraft("");
    payPinOpenFocusGenRef.current += 1;
    setPayPinInputKey((k) => k + 1);
    setPayPinModalVisible(true);
  };

  const cancelPayPin = useCallback(() => {
    if (payPinUi === "sending" || payPinUi === "success") return;
    payPinOpenFocusGenRef.current += 1;
    if (payPinFocusTimerRef.current) {
      clearTimeout(payPinFocusTimerRef.current);
      payPinFocusTimerRef.current = null;
    }
    payPinInputRef.current?.blur();
    Keyboard.dismiss();
    setPayPinModalVisible(false);
    setPayPinDraft("");
    setPayPinErrorLine(null);
    setPayPinSelection(undefined);
    setPayPinUi("idle");
    payPinFailedRef.current = 0;
  }, [payPinUi]);

  useEffect(() => {
    if (!payPinModalVisible) return;
    const back = BackHandler.addEventListener("hardwareBackPress", () => {
      if (paymentStatus === "SENDING") return true;
      cancelPayPin();
      return true;
    });
    return () => back.remove();
  }, [payPinModalVisible, paymentStatus, cancelPayPin]);

  useEffect(() => {
    if (!payPinModalVisible) {
      setPayPinKeyboardLift(0);
      return;
    }
    const showEvt =
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvt =
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const onShow = Keyboard.addListener(showEvt, (e) => {
      setPayPinKeyboardLift(e.endCoordinates?.height ?? 0);
    });
    const onHide = Keyboard.addListener(hideEvt, () => {
      setPayPinKeyboardLift(0);
    });
    return () => {
      onShow.remove();
      onHide.remove();
    };
  }, [payPinModalVisible]);

  const confirmPayWithPin = useCallback(async (pinRaw?: string) => {
    const pin = (pinRaw ?? payPinDraft).replace(/\D/g, "");
    if (pin.length !== ONBOARDING_PIN_LEN || !token) return;
    if (paymentStatus === "SENDING" || payPinUi !== "idle") return;
    setPayPinErrorLine(null);
    setPaymentStatus("SENDING");
    setPayPinUi("sending");
    try {
      const { pay } = await import("@/lib/api/client");
      const payRes = await pay(
        token,
        payPendingAmount,
        DEMO_DRIVER.name,
        DEMO_DRIVER.phone.replace(/\s/g, "") || null,
        pin,
      );
      if (payPinFocusTimerRef.current) {
        clearTimeout(payPinFocusTimerRef.current);
        payPinFocusTimerRef.current = null;
      }
      payPinInputRef.current?.blur();
      Keyboard.dismiss();
      payPinFailedRef.current = 0;
      setPaymentReceipt({
        amountFcfa: payPendingAmount,
        recipientName: DEMO_DRIVER.name,
        recipientPhone: DEMO_DRIVER.phone.replace(/\s/g, ""),
        paidAt: new Date().toISOString(),
        balanceFcfa: payRes.balanceFcfa,
        reference:
          payRes.reference?.trim() ||
          (payRes.transactionId
            ? fallbackTxReference(payRes.transactionId)
            : fallbackTxReference(`pay-${Date.now()}`)),
      });
      setPayPinUi("success");
      await new Promise<void>((r) => setTimeout(r, 500));
      setPayPinModalVisible(false);
      setPayPinDraft("");
      setPayPinSelection(undefined);
      setPayPinUi("idle");
      void refreshUser();
      if (userPhone) {
        void import("@/lib/sync/transactionsSync").then((m) => {
          void m.syncTransactionsFromNetwork(token, userPhone);
        });
      }
      setPaymentStatus("SUCCESS");
    } catch (e) {
      setPaymentStatus("IDLE");
      setPayPinUi("idle");
      if (isTransactionPinInvalidError(e)) {
        payPinFailedRef.current += 1;
        const fails = payPinFailedRef.current;
        setPayPinDraft("");
        if (fails >= PAY_PIN_MAX_ATTEMPTS) {
          if (payPinFocusTimerRef.current) {
            clearTimeout(payPinFocusTimerRef.current);
            payPinFocusTimerRef.current = null;
          }
          payPinInputRef.current?.blur();
          Keyboard.dismiss();
          setPayPinModalVisible(false);
          setPayPinErrorLine(null);
          setPayPinSelection(undefined);
          payPinFailedRef.current = 0;
          setPayPinLockoutUntil(Date.now() + PAY_PIN_LOCKOUT_MS);
          const lockMin = Math.max(1, Math.round(PAY_PIN_LOCKOUT_MS / 60000));
          Alert.alert(
            t("pay.securityTitle"),
            t("pay.lockoutMinutes", { count: lockMin }),
          );
        } else {
          const left = PAY_PIN_MAX_ATTEMPTS - fails;
          setPayPinErrorLine(
            left === 1
              ? t("pay.pinWrongLast")
              : t("pay.pinWrongRemaining", { count: left }),
          );
          schedulePayPinFieldFocus({ afterWrongPin: true });
        }
      } else {
        if (payPinFocusTimerRef.current) {
          clearTimeout(payPinFocusTimerRef.current);
          payPinFocusTimerRef.current = null;
        }
        payPinInputRef.current?.blur();
        Keyboard.dismiss();
        setPayPinModalVisible(false);
        setPayPinDraft("");
        payPinFailedRef.current = 0;
        setPayPinErrorLine(null);
        setPayPinSelection(undefined);
        // Réseau down → file offline (rejeu au reconnect)
        if (e instanceof ApiError && e.status === 0) {
          void import("@/lib/offline/queue").then((m) => {
            void m.enqueueOfflineOp("pay", {
              amountFcfa: payPendingAmount,
              recipientName: DEMO_DRIVER.name,
              recipientPhone: DEMO_DRIVER.phone.replace(/\s/g, "") || null,
              transactionPin: pin,
            });
          });
        }
        Alert.alert(
          t("pay.paymentTitle"),
          e instanceof ApiError ? e.message : t("common.genericError"),
        );
      }
    }
  }, [
    payPinDraft,
    payPinUi,
    paymentStatus,
    token,
    payPendingAmount,
    refreshUser,
    schedulePayPinFieldFocus,
    t,
    userPhone,
  ]);

  const payAmountFcfa = parseAmountFcfa(amount);
  const canPayAmount = payAmountFcfa != null;

  const payAmountDisplayText =
    amount === "" ? "0" : formatFcfa(payAmountFcfa ?? 0);

  useLayoutEffect(() => {
    if (paymentStatus !== "SUCCESS") return;
    successSlideX.setValue(windowWidth);
    Animated.timing(successSlideX, {
      toValue: 0,
      duration: 280,
      useNativeDriver: true,
    }).start();
  }, [paymentStatus, windowWidth, successSlideX]);

  if (paymentStatus === "SUCCESS" && paymentReceipt) {
    const phoneDisplay = formatCameroonPhoneDisplay(
      paymentReceipt.recipientPhone,
    );
    return (
      <View style={styles.successSafe}>
      <Animated.View
        style={[
          styles.successSafe,
          { transform: [{ translateX: successSlideX }] },
        ]}
      >
      <SafeAreaView style={styles.successSafe} edges={["top", "left", "right"]}>
        <ScrollView
          style={styles.successScroll}
          contentContainerStyle={styles.successScrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          bounces
        >
          <View style={styles.successTop}>
            <View
              style={styles.successIconWrap}
              accessibilityLabel={t("pay.receiptStatusOk")}
            >
              <CheckGlyph color={colors.accent} size={40} />
            </View>
            <Text style={styles.successTitle}>{t("pay.paid")}</Text>
            <Text style={styles.successSubtitle}>{t("pay.successSubtitle")}</Text>
            <Text style={styles.successAmount}>
              −{formatFcfa(paymentReceipt.amountFcfa)}
            </Text>
            <Text style={styles.successAmountCurrency}>{t("common.fcfa")}</Text>

            <View style={styles.successReceipt}>
              <View style={[styles.successRow, styles.successRowBorder]}>
                <Text style={styles.successRowLabel}>{t("pay.receiptTo")}</Text>
                <Text style={styles.successRowValue}>
                  {paymentReceipt.recipientName}
                </Text>
              </View>
              {phoneDisplay ? (
                <View style={[styles.successRow, styles.successRowBorder]}>
                  <Text style={styles.successRowLabel}>
                    {t("pay.receiptPhone")}
                  </Text>
                  <Text
                    style={[styles.successRowValue, styles.successRowValueMuted]}
                  >
                    +237 {phoneDisplay}
                  </Text>
                </View>
              ) : null}
              <View style={[styles.successRow, styles.successRowBorder]}>
                <Text style={styles.successRowLabel}>{t("pay.receiptDate")}</Text>
                <Text
                  style={[styles.successRowValue, styles.successRowValueMuted]}
                >
                  {formatReceiptDateTime(paymentReceipt.paidAt)}
                </Text>
              </View>
              <View style={[styles.successRow, styles.successRowBorder]}>
                <Text style={styles.successRowLabel}>
                  {t("pay.receiptStatus")}
                </Text>
                <Text style={[styles.successRowValue, styles.successStatusOk]}>
                  {t("pay.receiptStatusOk")}
                </Text>
              </View>
              <View style={[styles.successRow, styles.successRowBorder]}>
                <Text style={styles.successRowLabel}>
                  {t("pay.receiptBalance")}
                </Text>
                <Text style={styles.successRowValue}>
                  {formatFcfa(paymentReceipt.balanceFcfa)} {t("common.fcfa")}
                </Text>
              </View>
              <View style={styles.successRow}>
                <Text style={styles.successRowLabel}>{t("pay.receiptRef")}</Text>
                <Text
                  style={[styles.successRowValue, styles.successRowValueMuted]}
                  numberOfLines={1}
                >
                  {paymentReceipt.reference}
                </Text>
              </View>
            </View>

            <Pressable
              style={({ pressed }) => [
                styles.successSecondaryBtn,
                styles.successHistoryInScroll,
                pressed && styles.successSecondaryBtnPressed,
              ]}
              onPress={() => {
                setAmount("");
                setPaymentReceipt(null);
                setPaymentStatus("IDLE");
                router.push("/(tabs)/history");
              }}
              accessibilityRole="button"
              accessibilityLabel={t("pay.viewHistory")}
            >
              <Text style={styles.successSecondaryBtnText}>
                {t("pay.viewHistory")}
              </Text>
            </Pressable>
          </View>
        </ScrollView>

        <View style={styles.successActions}>
          <Pressable
            style={({ pressed }) => [
              styles.successPrimaryBtn,
              pressed && styles.successPrimaryBtnPressed,
            ]}
            onPress={() => {
              setAmount("");
              setPaymentReceipt(null);
              setPaymentStatus("IDLE");
            }}
            accessibilityRole="button"
            accessibilityLabel={t("pay.newTransaction")}
          >
            <Text style={styles.successPrimaryBtnText}>
              {t("pay.newTransaction")}
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>
      </Animated.View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={{ flex: 1 }}>
        <Stack.Screen options={{ headerShown: false }} />
          <SafeAreaView
            style={styles.safeArea}
            edges={["top", "left", "right"]}
          >
            <View style={styles.payScreenBody}>
              <View style={styles.payTopBlock}>
                <View style={styles.topBarRow}>
                  <View style={styles.recipientRow}>
                    {!DEMO_DRIVER.avatar ? (
                      <View style={styles.recipientThumb}>
                        <Text style={styles.recipientThumbLetter}>
                          {DEMO_DRIVER.name.charAt(0)}
                        </Text>
                      </View>
                    ) : (
                      <Image
                        source={DEMO_DRIVER.avatar}
                        style={styles.recipientThumbImage}
                      />
                    )}
                    <View style={styles.recipientTexts}>
                      <Text
                        style={styles.driverName}
                        numberOfLines={1}
                        ellipsizeMode="tail"
                      >
                        {DEMO_DRIVER.name}
                      </Text>
                      <Text style={styles.driverPhone}>{DEMO_DRIVER.phone}</Text>
                    </View>
                  </View>
                  <Pressable
                    style={({ pressed }) => [
                      styles.balanceAddBtn,
                      pressed && styles.balanceAddBtnPressed,
                    ]}
                      onPressIn={() => {
                        if (token) void import("@/app/deposit");
                      }}
                      onPress={() => {
                        if (!token) {
                          Keyboard.dismiss();
                          void importPayRegisterOverlay();
                          setConnexionPromptKind("recharge");
                          return;
                        }
                        openDepositInstant();
                      }}
                    accessibilityRole="button"
                    accessibilityLabel={t("common.topUpAccount")}
                    hitSlop={10}
                  >
                    <Text style={styles.balanceAddIcon}>+</Text>
                  </Pressable>
                </View>

                <View style={styles.inputSection}>
                  <Text style={styles.inputLabel}>{t("pay.amountLabel")}</Text>
                  <View style={styles.inputWrapper}>
                    <View style={styles.amountDisplayWrap}>
                      <Text
                        style={styles.amountDisplay}
                        numberOfLines={1}
                        accessibilityRole="text"
                        accessibilityLabel={t("a11y.amountLabel", {
                          amount: payAmountDisplayText,
                        })}
                      >
                        {payAmountDisplayText}
                      </Text>
                    </View>
                    <Text style={styles.currency}>{t("common.fcfa")}</Text>
                  </View>
                </View>
              </View>

              <View style={styles.payContentSpacer} />

              <View style={styles.payBottomBlock}>
                <AmountNumericKeypad
                  onDigit={onAmountDigit}
                  onBackspace={onAmountBackspace}
                  disabled={
                    paymentStatus === "SENDING" || showRegisterOverlay
                  }
                />
                <View style={styles.actionSection}>
                  <Pressable
                    style={({ pressed }) => [
                      styles.payButton,
                      (pressed || paymentStatus === 'SENDING') && styles.payButtonPressed,
                      (!canPayAmount || paymentStatus === 'SENDING') && styles.payButtonDisabled,
                    ]}
                    onPress={handlePay}
                    disabled={!canPayAmount || paymentStatus === 'SENDING'}
                  >
                    {paymentStatus === 'SENDING' ? (
                      <ActivityIndicator color={colors.accentOn} size="small" />
                    ) : (
                      <Text style={styles.payButtonText}>{t("pay.payNow")}</Text>
                    )}
                  </Pressable>
                </View>
              </View>
            </View>
          </SafeAreaView>

          {showRegisterOverlay ? (
            <Suspense
              fallback={
                <PayRegisterOverlayFallback
                  onClose={() => setRegisterInviteVisible(false)}
                />
              }
            >
              <PayRegisterOverlay
                onComplete={() => setRegisterInviteVisible(false)}
              />
            </Suspense>
          ) : null}

          {connexionPromptKind != null ? (
            <Modal
              visible
              transparent
              animationType="fade"
              onRequestClose={() => setConnexionPromptKind(null)}
            >
              <View style={styles.connexionModalRoot} pointerEvents="box-none">
                <Pressable
                  style={styles.connexionModalBackdrop}
                  onPress={() => setConnexionPromptKind(null)}
                  accessibilityLabel={t("common.close")}
                />
                <View style={styles.connexionModalCard}>
                  <Text style={styles.connexionModalTitle}>
                    {t("common.connection")}
                  </Text>
                  <Text style={styles.connexionModalMessage}>
                    {connexionPromptKind === "recharge"
                      ? t("pay.signInToTopUp")
                      : t("pay.signInToPay")}
                  </Text>
                  <View style={styles.connexionModalActions}>
                    <Pressable
                      style={({ pressed }) => [
                        styles.connexionModalBtnHit,
                        pressed && styles.connexionModalBtnPressed,
                      ]}
                      onPress={() => setConnexionPromptKind(null)}
                      accessibilityRole="button"
                      accessibilityLabel={t("common.cancel")}
                    >
                      <Text style={styles.connexionModalBtnAnnuler}>
                        {t("common.cancel")}
                      </Text>
                    </Pressable>
                    <Pressable
                      style={({ pressed }) => [
                        styles.connexionModalBtnHit,
                        pressed && styles.connexionModalBtnPressed,
                      ]}
                      onPress={() => {
                        void importPayRegisterOverlay();
                        setConnexionPromptKind(null);
                        setRegisterInviteVisible(true);
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={t("common.quickSignIn")}
                    >
                      <Text style={styles.connexionModalBtnConnexion}>
                        {t("common.quickSignIn")}
                      </Text>
                    </Pressable>
                  </View>
                </View>
              </View>
            </Modal>
          ) : null}

          {insufficientBalanceVisible ? (
            <Modal
              visible
              transparent
              animationType="fade"
              onRequestClose={() => setInsufficientBalanceVisible(false)}
            >
              <View style={styles.connexionModalRoot} pointerEvents="box-none">
                <Pressable
                  style={styles.connexionModalBackdrop}
                  onPress={() => setInsufficientBalanceVisible(false)}
                  accessibilityLabel={t("common.close")}
                />
                <View style={styles.connexionModalCard}>
                  <Text style={styles.connexionModalTitle}>
                    {t("pay.insufficientBalanceTitle")}
                  </Text>
                  <Text style={styles.connexionModalMessage}>
                    {t("pay.insufficientBalanceMessage", {
                      balance: formatFcfa(balance),
                      amount: formatFcfa(parseInt(amount, 10) || 0),
                    })}
                  </Text>
                  <View style={styles.connexionModalActions}>
                    <Pressable
                      style={({ pressed }) => [
                        styles.connexionModalBtnHit,
                        pressed && styles.connexionModalBtnPressed,
                      ]}
                      onPress={() => setInsufficientBalanceVisible(false)}
                      accessibilityRole="button"
                      accessibilityLabel={t("common.cancel")}
                    >
                      <Text style={styles.connexionModalBtnAnnuler}>
                        {t("common.cancel")}
                      </Text>
                    </Pressable>
                    <Pressable
                      style={({ pressed }) => [
                        styles.connexionModalBtnHit,
                        pressed && styles.connexionModalBtnPressed,
                      ]}
                      onPress={() => {
                        setInsufficientBalanceVisible(false);
                        openDepositInstant();
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={t("common.topUpAccount")}
                    >
                      <Text style={styles.connexionModalBtnConnexion}>
                        {t("common.topUp")}
                      </Text>
                    </Pressable>
                  </View>
                </View>
              </View>
            </Modal>
          ) : null}

          {payPinModalVisible ? (
            <View style={styles.payPinOverlay} accessibilityViewIsModal>
              <Pressable
                style={styles.payPinModalBackdrop}
                onPress={() => {
                  if (payPinUi === "idle") cancelPayPin();
                }}
                disabled={payPinUi !== "idle"}
                accessibilityLabel={t("common.close")}
              />
              <View
                style={[
                  styles.payPinSheet,
                  payPinKeyboardLift > 0 && styles.payPinSheetKeyboardFlush,
                  {
                    /** Collage exact : bas du sheet = haut du clavier. */
                    bottom:
                      payPinKeyboardLift > 0
                        ? Math.max(
                            0,
                            payPinKeyboardLift -
                              (Platform.OS === "android" ? insets.bottom : 0),
                          )
                        : 0,
                    paddingBottom:
                      payPinKeyboardLift > 0
                        ? 12
                        : Math.max(insets.bottom, 16) + 8,
                  },
                ]}
              >
                <View style={styles.payPinSheetHandle} />
                <Text style={styles.payPinModalTitle}>{t("pay.pinTitle")}</Text>
                <Text style={styles.payPinModalSub}>
                  {t("pay.pinConfirmPayment", {
                    amount: formatFcfa(payPendingAmount),
                    name: DEMO_DRIVER.name,
                  })}
                </Text>
                {payPinErrorLine ? (
                  <Text
                    style={styles.payPinModalError}
                    accessibilityLiveRegion="polite"
                  >
                    {payPinErrorLine}
                  </Text>
                ) : null}
                <MaskedPinInput
                  key={payPinInputKey}
                  ref={payPinInputRef}
                  variant="circles"
                  error={Boolean(payPinErrorLine)}
                  style={styles.payPinModalInput}
                  accessibilityLabel={t("pay.pinTitle")}
                  digits={payPinDraft}
                  maxLength={ONBOARDING_PIN_LEN}
                  selection={payPinSelection}
                  onSelectionChange={() => {
                    setPayPinSelection((prev) =>
                      prev !== undefined ? undefined : prev,
                    );
                  }}
                  onDigitsChange={(next) => {
                    setPayPinErrorLine(null);
                    setPayPinDraft(next);
                    if (next.length === ONBOARDING_PIN_LEN) {
                      void confirmPayWithPin(next);
                    }
                  }}
                  autoFocus
                  showSoftInputOnFocus
                  blurOnSubmit={false}
                  editable={payPinUi === "idle"}
                />
                {payPinUi === "sending" ? (
                  <View style={styles.payPinFeedback}>
                    <ActivityIndicator color={colors.accent} size="small" />
                  </View>
                ) : payPinUi === "success" ? (
                  <View
                    style={styles.payPinFeedback}
                    accessibilityLabel={t("pay.paid")}
                  >
                    <CheckGlyph color={colors.accent} size={36} />
                  </View>
                ) : null}
              </View>
            </View>
          ) : null}

          {depositChrome ? (
            <DepositOpenChrome
              onClose={() => {
                setDepositChrome(false);
                if (router.canGoBack()) router.back();
              }}
            />
          ) : null}
      </View>
    </View>
  );
}
