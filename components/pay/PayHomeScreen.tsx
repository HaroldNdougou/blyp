import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { MAX_AMOUNT_DIGITS, parseAmountFcfa } from "@/lib/amountLimits";
import { ApiError, isTransactionPinInvalidError } from "@/lib/api/errors";
import { formatFcfa } from "@/lib/formatFcfa";
import { consumePendingDepositAmountForPayHome } from "@/lib/pendingDepositForPayHome";
import { useMarkRootShellReady } from "@/lib/rootShellReady";
import { setTransactionsSnapshot } from "@/lib/transactionsCache";
import { Ionicons } from "@expo/vector-icons";
import { router, Stack } from "expo-router";
import React, {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  InteractionManager,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";

import { AmountNumericKeypad } from "@/components/pay/AmountNumericKeypad";
import { createPayHomeStyles } from "@/components/pay/payHomeStyles";
import { useFocusEffect } from "@react-navigation/native";
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

export default function PayHomeScreen() {
  useMarkRootShellReady();
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => createPayHomeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const { user, token, isLoading: authLoading, refreshUser } = useAuth();
  const [amount, setAmount] = useState("");
  const [paymentStatus, setPaymentStatus] = useState<'IDLE' | 'SENDING' | 'SUCCESS'>('IDLE');
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
   * Release : après l’accueil, précharge espacé (temps morts).
   * Dev : **aucun** préchargement — sinon Metro enchaîne 4–5 gros bundles et le log
   * ressemble à un cold start de 10 s alors que l’UI peut déjà être là.
   */
  useEffect(() => {
    if (authLoading) return;
    if (__DEV__) return;
    let cancelled = false;
    const gap = (ms: number) =>
      new Promise<void>((r) => setTimeout(r, ms));

    void (async () => {
      await new Promise<void>((r) =>
        InteractionManager.runAfterInteractions(() => r()),
      );
      if (cancelled) return;
      await gap(400);
      if (cancelled) return;

      void import("@/app/deposit");
      await gap(120);
      if (cancelled) return;
      void import("@/components/history/HistoryScreen");
      await gap(120);
      if (cancelled) return;
      void import("@/app/(tabs)/profile");
      await gap(120);
      if (cancelled) return;
      void importPayRegisterOverlay();

      if (!token) return;
      await gap(200);
      if (cancelled) return;
      try {
        const { listTransactions } = await import("@/lib/api/client");
        if (cancelled) return;
        const { items } = await listTransactions(token);
        if (!cancelled) setTransactionsSnapshot(token, items);
      } catch {
        /* best effort */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [authLoading, token]);

  useFocusEffect(
    useCallback(() => {
      const deposited = consumePendingDepositAmountForPayHome();
      if (deposited != null) {
        setAmount(String(deposited));
      }
    }, []),
  );

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

  /** Après un PIN incorrect, Android garde souvent le clavier sans caret : reset IME + sélection explicite. */
  const schedulePayPinFieldFocus = useCallback(
    (opts?: { afterWrongPin?: boolean }) => {
      const afterWrong = opts?.afterWrongPin ?? false;
      if (payPinFocusTimerRef.current) {
        clearTimeout(payPinFocusTimerRef.current);
        payPinFocusTimerRef.current = null;
      }
      const lead =
        afterWrong && Platform.OS === "android"
          ? 0
          : Platform.OS === "android"
            ? 220
            : 80;
      payPinFocusTimerRef.current = setTimeout(() => {
        payPinFocusTimerRef.current = null;
        const input = payPinInputRef.current;
        if (!input) return;
        /** Ouverture normale : pas de selection contrôlée (évite curseur à droite avec textAlign center + secure). */
        const focusOpen = () => {
          setPayPinSelection(undefined);
          input.focus();
        };
        if (afterWrong && Platform.OS === "android") {
          setPayPinSelection(undefined);
          input.blur();
          Keyboard.dismiss();
          setTimeout(() => {
            InteractionManager.runAfterInteractions(() => {
              requestAnimationFrame(() => {
                input.focus();
                setPayPinSelection({ start: 0, end: 0 });
                setTimeout(() => {
                  payPinInputRef.current?.focus();
                  setPayPinSelection({ start: 0, end: 0 });
                }, 140);
              });
            });
          }, 200);
        } else {
          InteractionManager.runAfterInteractions(() => {
            requestAnimationFrame(focusOpen);
          });
        }
      }, lead);
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
  }, [payPinModalVisible, schedulePayPinFieldFocus]);

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
    Keyboard.dismiss();
    payPinFailedRef.current = 0;
    setPayPinErrorLine(null);
    setPayPinSelection(undefined);
    setPayPendingAmount(n);
    setPayPinDraft("");
    setPayPinModalVisible(true);
  };

  const cancelPayPin = useCallback(() => {
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
    payPinFailedRef.current = 0;
  }, []);

  const confirmPayWithPin = useCallback(async () => {
    const pin = payPinDraft.replace(/\D/g, "");
    if (pin.length !== ONBOARDING_PIN_LEN || !token) return;
    setPayPinErrorLine(null);
    setPaymentStatus("SENDING");
    try {
      const { pay } = await import("@/lib/api/client");
      await pay(
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
      setPayPinModalVisible(false);
      setPayPinDraft("");
      setPayPinSelection(undefined);
      payPinFailedRef.current = 0;
      await refreshUser();
      setPaymentStatus("SUCCESS");
    } catch (e) {
      setPaymentStatus("IDLE");
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
        Alert.alert(
          t("pay.paymentTitle"),
          e instanceof ApiError ? e.message : t("common.genericError"),
        );
      }
    }
  }, [payPinDraft, token, payPendingAmount, refreshUser, schedulePayPinFieldFocus, t]);

  const payAmountFcfa = parseAmountFcfa(amount);
  const canPayAmount = payAmountFcfa != null;

  const payAmountDisplayText =
    amount === "" ? "0" : formatFcfa(payAmountFcfa ?? 0);

  if (paymentStatus === 'SUCCESS') {
    return (
      <View style={styles.successContainer}>
        <Text style={styles.successEmoji}>✅</Text>
        <Text style={styles.successText}>{t("pay.paid")}</Text>
        <Text style={styles.successSub}>
          {t("pay.paidTo", {
            amount: formatFcfa(parseInt(amount, 10) || 0),
            name: DEMO_DRIVER.name,
          })}
        </Text>
        <Pressable
          style={styles.resetButton}
          onPress={() => setPaymentStatus("IDLE")}
        >
          <Text style={styles.resetButtonText}>{t("pay.newTransaction")}</Text>
        </Pressable>
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
                  <View style={styles.balanceValueGroup}>
                    <Text style={styles.balanceAmountNum}>
                      {formatFcfa(balance)}
                    </Text>
                    <Text style={styles.balanceCurrency}>{t("common.fcfa")}</Text>
                    <Pressable
                      style={({ pressed }) => [
                        styles.balanceAddBtn,
                        pressed && styles.balanceAddBtnPressed,
                      ]}
                      onPress={() => {
                        if (!token) {
                          Keyboard.dismiss();
                          setConnexionPromptKind("recharge");
                          return;
                        }
                        router.push("/deposit");
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={t("common.topUpAccount")}
                      hitSlop={10}
                    >
                      <Ionicons name="add" size={21} color={colors.accent} />
                    </Pressable>
                  </View>
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
            <Suspense fallback={null}>
              <PayRegisterOverlay
                onComplete={() => setRegisterInviteVisible(false)}
              />
            </Suspense>
          ) : null}

          <Modal
            visible={connexionPromptKind != null}
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
                <Text style={styles.connexionModalTitle}>{t("common.connection")}</Text>
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
                    <Text style={styles.connexionModalBtnAnnuler}>{t("common.cancel")}</Text>
                  </Pressable>
                  <Pressable
                    style={({ pressed }) => [
                      styles.connexionModalBtnHit,
                      pressed && styles.connexionModalBtnPressed,
                    ]}
                    onPress={() => {
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

          <Modal
            visible={insufficientBalanceVisible}
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
                    <Text style={styles.connexionModalBtnAnnuler}>{t("common.cancel")}</Text>
                  </Pressable>
                  <Pressable
                    style={({ pressed }) => [
                      styles.connexionModalBtnHit,
                      pressed && styles.connexionModalBtnPressed,
                    ]}
                    onPress={() => {
                      setInsufficientBalanceVisible(false);
                      router.push("/deposit");
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

          <Modal
            visible={payPinModalVisible}
            transparent
            animationType="fade"
            onRequestClose={() => {
              if (paymentStatus !== "SENDING") cancelPayPin();
            }}
          >
            <KeyboardAvoidingView
              style={styles.payPinModalKeyboardWrap}
              behavior={Platform.OS === "ios" ? "padding" : "height"}
            >
              <View
                style={[
                  styles.payPinModalRoot,
                  { paddingTop: insets.top + 28 },
                ]}
                pointerEvents="box-none"
              >
                <Pressable
                  style={styles.payPinModalBackdrop}
                  onPress={cancelPayPin}
                  disabled={paymentStatus === "SENDING"}
                  accessibilityLabel={t("common.close")}
                />
                <View style={styles.payPinModalCard}>
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
                  <TextInput
                    ref={payPinInputRef}
                    style={[
                      styles.payPinModalInput,
                      payPinErrorLine ? styles.payPinModalInputError : null,
                    ]}
                    placeholder={t("common.pinPlaceholder")}
                    placeholderTextColor={colors.placeholder}
                    keyboardType="number-pad"
                    secureTextEntry
                    maxLength={ONBOARDING_PIN_LEN}
                    value={payPinDraft}
                    selection={payPinSelection}
                    onSelectionChange={() => {
                      setPayPinSelection((prev) =>
                        prev !== undefined ? undefined : prev,
                      );
                    }}
                    onChangeText={(t) => {
                      setPayPinErrorLine(null);
                      setPayPinDraft(
                        t.replace(/\D/g, "").slice(0, ONBOARDING_PIN_LEN),
                      );
                    }}
                    autoFocus
                    showSoftInputOnFocus
                    editable={paymentStatus !== "SENDING"}
                  />
                  <View style={styles.payPinModalActions}>
                    <Pressable
                      style={styles.payPinModalCancelBtn}
                      onPress={cancelPayPin}
                      disabled={paymentStatus === "SENDING"}
                    >
                      <Text style={styles.payPinModalCancelText}>{t("common.cancel")}</Text>
                    </Pressable>
                    <Pressable
                      style={({ pressed }) => [
                        styles.payPinModalOkBtn,
                        (payPinDraft.replace(/\D/g, "").length !== ONBOARDING_PIN_LEN ||
                          paymentStatus === "SENDING") &&
                          styles.payPinModalOkBtnDisabled,
                        pressed &&
                          payPinDraft.replace(/\D/g, "").length === ONBOARDING_PIN_LEN &&
                          paymentStatus !== "SENDING" &&
                          styles.payPinModalOkBtnPressed,
                      ]}
                      disabled={
                        payPinDraft.replace(/\D/g, "").length !== ONBOARDING_PIN_LEN ||
                        paymentStatus === "SENDING"
                      }
                      onPress={() => void confirmPayWithPin()}
                    >
                      {paymentStatus === "SENDING" ? (
                        <ActivityIndicator color={colors.accentOn} size="small" />
                      ) : (
                        <Text style={styles.payPinModalOkText}>{t("common.pay")}</Text>
                      )}
                    </Pressable>
                  </View>
                </View>
              </View>
            </KeyboardAvoidingView>
          </Modal>
      </View>
    </View>
  );
}
