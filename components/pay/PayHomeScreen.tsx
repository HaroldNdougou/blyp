import { useAuth } from "@/contexts/AuthContext";
import {
  ApiError,
  isTransactionPinInvalidError,
  pay as apiPay,
} from "@/lib/api/client";
import { formatFcfa } from "@/lib/format";
import { consumePendingDepositAmountForPayHome } from "@/lib/pendingDepositForPayHome";
import { Ionicons } from "@expo/vector-icons";
import { router, Stack } from "expo-router";
import React, {
  lazy,
  Suspense,
  useCallback,
  useEffect,
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
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { AmountNumericKeypad } from "@/components/pay/AmountNumericKeypad";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/** Même cible que `lazy` : le préchargement remplit le cache avant le 1er « Connexion rapide ». */
const importPayRegisterOverlay = () => import("./PayRegisterOverlay");
const PayRegisterOverlay = lazy(importPayRegisterOverlay);

/** Vert identité Blyp */
const BLYP_GREEN = "#5dc705";
const ACCENT = BLYP_GREEN;

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

  /** Précharge la route recharge pour un tap plus réactif (évite le coût du 1er import). */
  useEffect(() => {
    void import("@/app/deposit");
  }, []);

  /**
   * Inscription / connexion rapide : chunk hors bundle initial (accueil plus léger),
   * préchargé après le 1er paint puis en temps mort (fin des interactions / anim).
   */
  useEffect(() => {
    let cancelled = false;
    const warm = () => {
      if (!cancelled) void importPayRegisterOverlay();
    };
    const raf = requestAnimationFrame(warm);
    const task = InteractionManager.runAfterInteractions(warm);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      task.cancel();
    };
  }, []);

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

  const AMOUNT_MAX_LEN = 7;

  const onAmountDigit = useCallback((digit: string) => {
    setAmount((prev) => {
      const d = digit.replace(/\D/g, "");
      if (!d) return prev;
      if (prev.length >= AMOUNT_MAX_LEN) return prev;
      if (prev === "0") return d === "0" ? "0" : d;
      return prev + d;
    });
  }, []);

  const onAmountBackspace = useCallback(() => {
    setAmount((prev) => prev.slice(0, -1));
  }, []);

  const handlePay = () => {
    const n = parseInt(amount, 10);
    if (!amount || !Number.isFinite(n) || n <= 0 || paymentStatus === "SENDING")
      return;
    if (!token) {
      Keyboard.dismiss();
      setConnexionPromptKind("pay");
      return;
    }
    if (user?.needsOnboarding) {
      Alert.alert(
        "Inscription",
        "Terminez la création de votre compte (PIN et profil) avant de payer.",
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
        "Paiement sécurisé",
        min > 0
          ? `Réessayez dans ${min} min ${s} s.`
          : `Réessayez dans ${s} s.`,
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
      await apiPay(
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
            "Sécurité",
            `Trop de codes PIN erronés. Nouvelle tentative possible dans environ ${lockMin} minute${lockMin > 1 ? "s" : ""}.`,
          );
        } else {
          const left = PAY_PIN_MAX_ATTEMPTS - fails;
          setPayPinErrorLine(
            left === 1
              ? "Code PIN incorrect. Dernière tentative autorisée."
              : `Code PIN incorrect. ${left} tentative${left > 1 ? "s" : ""} restante${left > 1 ? "s" : ""}.`,
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
          "Paiement",
          e instanceof ApiError ? e.message : "Une erreur est survenue.",
        );
      }
    }
  }, [payPinDraft, token, payPendingAmount, refreshUser, schedulePayPinFieldFocus]);

  const payAmountDisplayText =
    amount === "" ? "0" : formatFcfa(parseInt(amount, 10) || 0);

  if (paymentStatus === 'SUCCESS') {
    return (
      <View style={styles.successContainer}>
        <Text style={styles.successEmoji}>✅</Text>
        <Text style={styles.successText}>Payé !</Text>
        <Text style={styles.successSub}>
          {formatFcfa(parseInt(amount, 10) || 0)} FCFA versé à {DEMO_DRIVER.name}
        </Text>
        <Pressable
          style={styles.resetButton}
          onPress={() => setPaymentStatus("IDLE")}
        >
          <Text style={styles.resetButtonText}>Nouvelle transaction</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: "#ffffff" }}>
      <View style={{ flex: 1 }}>
        <Stack.Screen options={{ headerShown: false }} />
          <SafeAreaView style={styles.safeArea}>
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
                    <Text style={styles.balanceCurrency}>FCFA</Text>
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
                      accessibilityLabel="Recharger le compte"
                      hitSlop={10}
                    >
                      <Ionicons name="add" size={21} color={ACCENT} />
                    </Pressable>
                  </View>
                </View>

                <View style={styles.inputSection}>
                  <Text style={styles.inputLabel}>Entrer montant à payer</Text>
                  <View style={styles.inputWrapper}>
                    <View style={styles.amountDisplayWrap}>
                      <Text
                        style={styles.amountDisplay}
                        numberOfLines={1}
                        accessibilityRole="text"
                        accessibilityLabel={`Montant ${payAmountDisplayText} F C F A`}
                      >
                        {payAmountDisplayText}
                      </Text>
                    </View>
                    <Text style={styles.currency}>FCFA</Text>
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
                      (!amount || paymentStatus === 'SENDING') && styles.payButtonDisabled,
                    ]}
                    onPress={handlePay}
                    disabled={!amount || paymentStatus === 'SENDING'}
                  >
                    {paymentStatus === 'SENDING' ? (
                      <ActivityIndicator color="#ffffff" size="small" />
                    ) : (
                      <Text style={styles.payButtonText}>Payer maintenant</Text>
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
                accessibilityLabel="Fermer"
              />
              <View style={styles.connexionModalCard}>
                <Text style={styles.connexionModalTitle}>Connexion</Text>
                <Text style={styles.connexionModalMessage}>
                  {connexionPromptKind === "recharge"
                    ? "Créez un compte ou connectez-vous pour recharger votre solde."
                    : "Créez un compte ou connectez-vous pour payer."}
                </Text>
                <View style={styles.connexionModalActions}>
                  <Pressable
                    style={({ pressed }) => [
                      styles.connexionModalBtnHit,
                      pressed && styles.connexionModalBtnPressed,
                    ]}
                    onPress={() => setConnexionPromptKind(null)}
                    accessibilityRole="button"
                    accessibilityLabel="Annuler"
                  >
                    <Text style={styles.connexionModalBtnAnnuler}>Annuler</Text>
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
                    accessibilityLabel="Connexion rapide"
                  >
                    <Text style={styles.connexionModalBtnConnexion}>
                      Connexion rapide
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
                accessibilityLabel="Fermer"
              />
              <View style={styles.connexionModalCard}>
                <Text style={styles.connexionModalTitle}>Solde insuffisant</Text>
                <Text style={styles.connexionModalMessage}>
                  Votre solde ({formatFcfa(balance)} FCFA) ne couvre pas ce
                  paiement de{" "}
                  {formatFcfa(parseInt(amount, 10) || 0)} FCFA. Rechargez votre
                  compte pour continuer.
                </Text>
                <View style={styles.connexionModalActions}>
                  <Pressable
                    style={({ pressed }) => [
                      styles.connexionModalBtnHit,
                      pressed && styles.connexionModalBtnPressed,
                    ]}
                    onPress={() => setInsufficientBalanceVisible(false)}
                    accessibilityRole="button"
                    accessibilityLabel="Annuler"
                  >
                    <Text style={styles.connexionModalBtnAnnuler}>Annuler</Text>
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
                    accessibilityLabel="Recharger le compte"
                  >
                    <Text style={styles.connexionModalBtnConnexion}>
                      Recharger
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
                  accessibilityLabel="Fermer"
                />
                <View style={styles.payPinModalCard}>
                  <Text style={styles.payPinModalTitle}>Code PIN</Text>
                  <Text style={styles.payPinModalSub}>
                    Saisissez votre PIN à 4 chiffres pour confirmer le paiement de{" "}
                    {formatFcfa(payPendingAmount)} FCFA à {DEMO_DRIVER.name}.
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
                    placeholder="• • • •"
                    placeholderTextColor="#CCC"
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
                      <Text style={styles.payPinModalCancelText}>Annuler</Text>
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
                        <ActivityIndicator color="#fff" size="small" />
                      ) : (
                        <Text style={styles.payPinModalOkText}>Payer</Text>
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

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  payScreenBody: {
    flex: 1,
    flexDirection: "column",
    paddingHorizontal: 22,
    paddingBottom: 8,
  },
  payContentSpacer: {
    flex: 1,
    minHeight: 0,
  },
  payTopBlock: {
    width: "100%",
    paddingTop: 28,
  },
  payBottomBlock: {
    width: "100%",
    flexShrink: 0,
  },
  topBarRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    width: "100%",
    marginTop: 0,
    marginBottom: 20,
    gap: 8,
  },
  balanceValueGroup: {
    flexDirection: "row",
    alignItems: "center",
    flexShrink: 0,
    flexWrap: "wrap",
    justifyContent: "flex-end",
  },
  balanceAmountNum: {
    fontSize: 14,
    fontWeight: "800",
    color: ACCENT,
  },
  balanceCurrency: {
    fontSize: 10,
    fontWeight: "700",
    color: "#AAA",
    marginLeft: 5,
  },
  balanceAddBtn: {
    marginLeft: 6,
    marginTop: 0,
    padding: 2,
    justifyContent: "center",
    alignItems: "center",
  },
  balanceAddBtnPressed: {
    opacity: 0.55,
    transform: [{ scale: 0.94 }],
  },
  connexionModalRoot: {
    flex: 1,
    justifyContent: "center",
  },
  connexionModalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  connexionModalCard: {
    marginHorizontal: 28,
    backgroundColor: "#fff",
    borderRadius: 16,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
    zIndex: 1,
  },
  connexionModalTitle: {
    fontSize: 17,
    fontWeight: "800",
    color: "#222",
    marginBottom: 8,
  },
  connexionModalMessage: {
    fontSize: 14,
    color: "#666",
    lineHeight: 20,
  },
  connexionModalActions: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 18,
    paddingTop: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#E8E8E8",
  },
  connexionModalBtnHit: {
    paddingVertical: 6,
    paddingHorizontal: 4,
    minWidth: 44,
    minHeight: 36,
    justifyContent: "center",
  },
  connexionModalBtnPressed: {
    opacity: 0.65,
  },
  connexionModalBtnAnnuler: {
    fontSize: 13,
    fontWeight: "600",
    color: "#888",
  },
  connexionModalBtnConnexion: {
    fontSize: 13,
    fontWeight: "700",
    color: ACCENT,
  },
  payPinModalKeyboardWrap: {
    flex: 1,
  },
  payPinModalRoot: {
    flex: 1,
    justifyContent: "flex-start",
  },
  payPinModalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  payPinModalCard: {
    marginHorizontal: 24,
    backgroundColor: "#fff",
    borderRadius: 20,
    padding: 22,
    zIndex: 1,
  },
  payPinModalTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: "#222",
    marginBottom: 8,
  },
  payPinModalSub: {
    fontSize: 14,
    color: "#666",
    lineHeight: 20,
    marginBottom: 10,
  },
  payPinModalError: {
    fontSize: 13,
    fontWeight: "600",
    color: "#C62828",
    lineHeight: 18,
    marginBottom: 12,
  },
  payPinModalInput: {
    height: 52,
    fontSize: 22,
    fontWeight: "700",
    letterSpacing: 8,
    textAlign: "center",
    color: "#222",
    backgroundColor: "#F8F8F8",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#EEE",
    marginBottom: 20,
    ...Platform.select({
      android: {
        includeFontPadding: false,
        textAlignVertical: "center",
      },
      default: {},
    }),
  },
  payPinModalInputError: {
    borderColor: "rgba(198, 40, 40, 0.45)",
    backgroundColor: "#FFF5F5",
  },
  payPinModalActions: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  payPinModalCancelBtn: {
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  payPinModalCancelText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#666",
  },
  payPinModalOkBtn: {
    flex: 1,
    backgroundColor: ACCENT,
    paddingVertical: 14,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 48,
  },
  payPinModalOkBtnDisabled: {
    backgroundColor: "#CCC",
  },
  payPinModalOkBtnPressed: {
    opacity: 0.92,
  },
  payPinModalOkText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "800",
  },
  recipientRow: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    minWidth: 0,
    marginRight: 4,
  },
  recipientThumb: {
    width: 52,
    height: 52,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E0E0E0",
    backgroundColor: "#F5F5F5",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  recipientThumbImage: {
    width: 52,
    height: 52,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E0E0E0",
    marginRight: 12,
  },
  recipientThumbLetter: {
    fontSize: 20,
    fontWeight: "800",
    color: ACCENT,
  },
  recipientTexts: {
    flex: 1,
    minWidth: 0,
    justifyContent: "center",
    minHeight: 52,
    paddingTop: 0,
  },
  driverName: {
    fontSize: 13,
    fontWeight: "700",
    color: "#333",
  },
  driverPhone: {
    fontSize: 11,
    color: "#888",
  },
  inputSection: {
    marginBottom: 0,
  },
  inputLabel: {
    fontSize: 13,
    color: "#888",
    fontWeight: "600",
    marginBottom: 10,
    letterSpacing: 0.8,
    textAlign: 'center'
  },
  inputWrapper: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
    paddingHorizontal: 18,
    paddingVertical: 4,
    minHeight: 80,
  },
  amountDisplayWrap: {
    minHeight: 72,
    minWidth: 0,
    flexShrink: 1,
    justifyContent: "center",
  },
  amountDisplay: {
    fontSize: 28,
    fontWeight: "bold",
    color: "#222",
    fontVariant: ["tabular-nums"],
    ...Platform.select({
      android: { textAlignVertical: "center" as const },
      default: {},
    }),
  },
  currency: {
    fontSize: 19,
    fontWeight: "800",
    color: "#AAA",
    marginLeft: 10,
  },
  actionSection: {
    marginTop: 18,
  },
  payButton: {
    backgroundColor: ACCENT,
    height: 60,
    borderRadius: 30,
    justifyContent: "center",
    alignItems: "center",
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
  },
  payButtonPressed: {
    backgroundColor: "#4bb004",
    transform: [{ scale: 0.98 }],
  },
  payButtonDisabled: {
    backgroundColor: "#CCCCCC",
    elevation: 0,
  },
  payButtonText: {
    color: "#ffffff",
    fontSize: 17,
    fontWeight: "bold",
    letterSpacing: 0.2,
  },
  successContainer: {
    flex: 1,
    backgroundColor: ACCENT,
    justifyContent: "center",
    alignItems: "center",
    padding: 18,
  },
  successEmoji: { fontSize: 76 },
  successText: {
    color: "#ffffff",
    fontSize: 32,
    fontWeight: "900",
    marginTop: 8,
  },
  successSub: {
    color: "#ffffff",
    fontSize: 14,
    opacity: 0.9,
    marginTop: 8,
    textAlign: "center",
  },
  resetButton: {
    marginTop: 44,
    paddingVertical: 12,
    paddingHorizontal: 18,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 16
  },
  resetButtonText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "bold",
  },
});