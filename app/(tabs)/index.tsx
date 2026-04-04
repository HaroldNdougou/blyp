import { AndroidOtpSmsAutofill } from "../../components/AndroidOtpSmsAutofill";
import { useAuth } from "@/contexts/AuthContext";
import { ApiError, pay as apiPay, sayHello } from "@/lib/api/client";
import { API_BASE_URL, USE_MOCK_API } from "@/lib/config";
import {
  formatCameroonPhoneDisplay,
  formatFcfa,
  normalizeCameroonPhoneDigits,
} from "@/lib/format";
import { Ionicons } from "@expo/vector-icons";
import { router, Stack } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableWithoutFeedback,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView as SafeModalArea, useSafeAreaInsets } from "react-native-safe-area-context";

/** Vert identité Blyp */
const BLYP_GREEN = "#5dc705";
const ACCENT = BLYP_GREEN;

/** Même principe que `app/deposit.tsx` : feuille sous la barre de statut. */
const REG_SHEET_EXTRA_TOP = 36;

/** Aligné sur le cooldown serveur (`/auth/request-otp`). */
const OTP_RESEND_COOLDOWN_SEC = 60;
/** Limite d’envois par ouverture du modal d’inscription. */
const MAX_OTP_SENDS_PER_SESSION = 8;

const OTP_LEN = 6;

export default function Index() {
  const {
    user,
    token,
    isLoading: authLoading,
    requestOtp,
    verifyAndSignIn,
    refreshUser,
  } = useAuth();
  const [amount, setAmount] = useState("");
  const [paymentStatus, setPaymentStatus] = useState<'IDLE' | 'SENDING' | 'SUCCESS'>('IDLE');
  const balance = user?.balanceFcfa ?? 0;
  const [registerInviteVisible, setRegisterInviteVisible] = useState(false);
  const [welcomePhone, setWelcomePhone] = useState("");
  const [welcomeOtp, setWelcomeOtp] = useState("");
  const [welcomeStep, setWelcomeStep] = useState<"phone" | "otp">("phone");
  const [authOtpSending, setAuthOtpSending] = useState(false);
  const [authResendSending, setAuthResendSending] = useState(false);
  const [authVerifySending, setAuthVerifySending] = useState(false);
  const [otpResendCooldown, setOtpResendCooldown] = useState(0);
  const [otpSendCount, setOtpSendCount] = useState(0);
  const [helloSending, setHelloSending] = useState(false);
  const inviteBootstrapped = useRef(false);
  const regPhoneInputRef = useRef<TextInput>(null);
  const regOtpInputRef = useRef<TextInput>(null);
  const otpAutoSubmittedRef = useRef<string | null>(null);
  const otpVerifyInFlightRef = useRef(false);
  const regSlideX = useRef(new Animated.Value(0)).current;
  const [regSlideWidth, setRegSlideWidth] = useState(0);
  const { width: windowWidth } = useWindowDimensions();
  const regSlidePanelW =
    regSlideWidth > 0 ? regSlideWidth : Math.max(280, windowWidth - 72);
  const regInsets = useSafeAreaInsets();
  const regSheetTop = regInsets.top + REG_SHEET_EXTRA_TOP;

  const showRegisterOverlay = !user && registerInviteVisible;

  useEffect(() => {
    if (authLoading) return;
    if (!user && !inviteBootstrapped.current) {
      inviteBootstrapped.current = true;
      setRegisterInviteVisible(true);
    }
  }, [authLoading, user]);

  useEffect(() => {
    if (user) setRegisterInviteVisible(false);
  }, [user]);

  useEffect(() => {
    if (registerInviteVisible) {
      setWelcomeStep("phone");
      setWelcomeOtp("");
      setOtpResendCooldown(0);
      setOtpSendCount(0);
      setRegSlideWidth(0);
    } else {
      setWelcomeStep("phone");
      setWelcomeOtp("");
      setWelcomePhone("");
      setOtpResendCooldown(0);
      setOtpSendCount(0);
      setRegSlideWidth(0);
    }
  }, [registerInviteVisible]);

  useEffect(() => {
    if (welcomeStep !== "otp" || otpResendCooldown <= 0) return;
    const id = setInterval(() => {
      setOtpResendCooldown((s) => Math.max(0, s - 1));
    }, 1000);
    return () => clearInterval(id);
  }, [welcomeStep, otpResendCooldown > 0]);

  useEffect(() => {
    if (showRegisterOverlay) {
      regSlideX.setValue(0);
    }
  }, [showRegisterOverlay, regSlideX]);

  useEffect(() => {
    if (!showRegisterOverlay) return;
    const w =
      regSlideWidth > 0 ? regSlideWidth : Math.max(280, windowWidth - 72);
    const to = welcomeStep === "otp" ? -w : 0;
    Animated.timing(regSlideX, {
      toValue: to,
      duration: 320,
      useNativeDriver: true,
    }).start();
  }, [
    welcomeStep,
    showRegisterOverlay,
    regSlideWidth,
    windowWidth,
    regSlideX,
  ]);

  const requestOtpForRegistration = async (mode: "initial" | "resend") => {
    if (welcomePhone.length !== 9) return;
    if (otpSendCount >= MAX_OTP_SENDS_PER_SESSION) {
      Alert.alert(
        "Limite d’envois",
        "Nombre maximum d’envois de code atteint pour cette session. Réessayez plus tard ou contactez le support.",
      );
      return;
    }
    if (mode === "resend" && otpResendCooldown > 0) return;
    const setBusy = mode === "initial" ? setAuthOtpSending : setAuthResendSending;
    setBusy(true);
    try {
      await requestOtp(welcomePhone);
      if (mode === "initial") setWelcomeStep("otp");
      setWelcomeOtp("");
      setOtpSendCount((c) => c + 1);
      setOtpResendCooldown(OTP_RESEND_COOLDOWN_SEC);
    } catch (e) {
      const msg =
        e instanceof ApiError ? e.message : "Impossible d’envoyer le code.";
      if (e instanceof ApiError && e.retryAfterSeconds != null) {
        setOtpResendCooldown(e.retryAfterSeconds);
      }
      Alert.alert("Code SMS", msg);
    } finally {
      setBusy(false);
    }
  };

  const submitOtpVerification = useCallback(async () => {
    if (welcomeOtp.length !== OTP_LEN || welcomePhone.length !== 9) return;
    if (otpVerifyInFlightRef.current) return;
    otpVerifyInFlightRef.current = true;
    Keyboard.dismiss();
    setAuthVerifySending(true);
    try {
      await verifyAndSignIn(welcomePhone, welcomeOtp);
      setWelcomeOtp("");
      setRegisterInviteVisible(false);
    } catch (e) {
      Alert.alert(
        "Vérification",
        e instanceof ApiError ? e.message : "Code invalide.",
      );
    } finally {
      otpVerifyInFlightRef.current = false;
      setAuthVerifySending(false);
    }
  }, [welcomePhone, welcomeOtp, verifyAndSignIn]);

  const applySmsAutofillOtp = useCallback((digits: string) => {
    setWelcomeOtp(digits);
  }, []);

  useEffect(() => {
    if (user) return;
    if (welcomeStep === "phone") {
      otpAutoSubmittedRef.current = null;
      return;
    }
    if (welcomeOtp.length < OTP_LEN) {
      otpAutoSubmittedRef.current = null;
      return;
    }
    if (authVerifySending || welcomePhone.length !== 9) return;
    if (otpAutoSubmittedRef.current === welcomeOtp) return;
    otpAutoSubmittedRef.current = welcomeOtp;
    void submitOtpVerification();
  }, [
    user,
    welcomeStep,
    welcomeOtp,
    welcomePhone,
    authVerifySending,
    submitOtpVerification,
  ]);

  /** Focus + clavier après ouverture du modal / changement d’étape (délai Android = fin animation). */
  useEffect(() => {
    if (!showRegisterOverlay) return;
    const delay = Platform.OS === "android" ? 450 : 120;
    const t = setTimeout(() => {
      if (welcomeStep === "phone") {
        regPhoneInputRef.current?.focus();
      } else {
        regOtpInputRef.current?.focus();
      }
    }, delay);
    return () => clearTimeout(t);
  }, [showRegisterOverlay, welcomeStep]);

  const detectedDriver = {
    name: "Taxi Mohamadou",
    phone: "698 25 68 96",
    avatar: null,
  };

  const handlePay = async () => {
    const n = parseInt(amount, 10);
    if (!amount || !Number.isFinite(n) || n <= 0 || paymentStatus === "SENDING")
      return;
    if (!token) {
      Alert.alert(
        "Connexion",
        "Créez un compte ou connectez-vous pour payer.",
      );
      return;
    }
    Keyboard.dismiss();
    setPaymentStatus("SENDING");
    try {
      await apiPay(
        token,
        n,
        detectedDriver.name,
        detectedDriver.phone.replace(/\s/g, "") || null,
      );
      await refreshUser();
      setPaymentStatus("SUCCESS");
    } catch (e) {
      Alert.alert(
        "Paiement",
        e instanceof ApiError ? e.message : "Une erreur est survenue.",
      );
      setPaymentStatus("IDLE");
    }
  };

  if (paymentStatus === 'SUCCESS') {
    return (
      <View style={styles.successContainer}>
        <Text style={styles.successEmoji}>✅</Text>
        <Text style={styles.successText}>Payé !</Text>
        <Text style={styles.successSub}>
          {formatFcfa(parseInt(amount, 10) || 0)} FCFA versé à {detectedDriver.name}
        </Text>
        <Pressable
          style={styles.resetButton}
          onPress={() => { setAmount(""); setPaymentStatus('IDLE'); }}
        >
          <Text style={styles.resetButtonText}>Nouvelle transaction</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={{ flex: 1, backgroundColor: "#ffffff" }}
    >
      <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
        <View style={{ flex: 1 }}>
          <Stack.Screen options={{ headerShown: false }} />
          <SafeAreaView style={styles.safeArea}>

            <ScrollView
              contentContainerStyle={styles.scrollContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.balanceWrap}>
                <View style={styles.balanceAmountRow}>
                  <Text style={styles.balanceLabel}>Solde:</Text>
                  <Text style={styles.balanceAmountNum}>
                    {formatFcfa(balance)}
                  </Text>
                  <Text style={styles.balanceCurrency}>FCFA</Text>
                </View>
                <View style={styles.balanceReassuranceRow}>
                  <View style={styles.balanceReassuranceInner}>
                    <Ionicons
                      name="lock-closed"
                      size={12}
                      color={ACCENT}
                      style={styles.balanceReassuranceIcon}
                    />
                    <Text style={styles.balanceReassurance}>
                      Votre argent est protégé.
                    </Text>
                  </View>
                </View>
                <Pressable
                  style={({ pressed }) => [
                    styles.createAccountBtn,
                    styles.rechargeBtn,
                    pressed && styles.createAccountBtnPressed,
                  ]}
                  onPress={() => router.push("/deposit")}
                  accessibilityRole="button"
                  accessibilityLabel="Recharger le compte"
                >
                  <View style={styles.createAccountBtnIcon}>
                    <Ionicons name="wallet-outline" size={18} color={ACCENT} />
                  </View>
                  <Text style={styles.createAccountBtnText}>Recharger</Text>
                </Pressable>
              </View>

              {!user && !showRegisterOverlay && (
                <Pressable
                  style={({ pressed }) => [
                    styles.createAccountBtn,
                    pressed && styles.createAccountBtnPressed,
                  ]}
                  onPress={() => {
                    Keyboard.dismiss();
                    setRegisterInviteVisible(true);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Créer un compte"
                >
                  <View style={styles.createAccountBtnIcon}>
                    <Ionicons name="person-add-outline" size={18} color={ACCENT} />
                  </View>
                  <Text style={styles.createAccountBtnText}>Créer un compte</Text>
                </Pressable>
              )}

              <Pressable
                style={({ pressed }) => [
                  styles.sayHelloBtn,
                  pressed && !helloSending && styles.sayHelloBtnPressed,
                  helloSending && styles.sayHelloBtnDisabled,
                ]}
                disabled={helloSending}
                onPress={async () => {
                  Keyboard.dismiss();
                  setHelloSending(true);
                  try {
                    const r = await sayHello();
                    if (USE_MOCK_API || r.id.startsWith("mock-hello")) {
                      Alert.alert(
                        "Say Hello — mode démo",
                        "Rien n’est écrit dans PostgreSQL / Railway : l’app tourne sans EXPO_PUBLIC_API_URL dans le binaire.\n\nAjoute l’URL HTTPS de ton API dans .env à la racine du projet, puis reconstruis avec npx expo run:android (ou ios).",
                      );
                      return;
                    }
                    const d = new Date(r.createdAt);
                    Alert.alert(
                      "Say Hello",
                      `API utilisée :\n${API_BASE_URL}\n\nHorodatage serveur :\n${d.toLocaleString("fr-FR", {
                        dateStyle: "medium",
                        timeStyle: "medium",
                      })}\n\nUTC : ${r.createdAt}\nid : ${r.id}`,
                    );
                  } catch (e) {
                    Alert.alert(
                      "Say Hello",
                      e instanceof ApiError ? e.message : "Impossible d’enregistrer.",
                    );
                  } finally {
                    setHelloSending(false);
                  }
                }}
                accessibilityRole="button"
                accessibilityLabel="Say Hello"
              >
                {helloSending ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.sayHelloBtnText}>Say Hello</Text>
                )}
              </Pressable>

              {/* SECTION PROFIL */}
              <View style={styles.profileSection}>
                {!detectedDriver.avatar ? (
                  <View style={[styles.avatar, styles.avatarPlaceholder]}>
                    <Text style={styles.avatarLetter}>{detectedDriver.name.charAt(0)}</Text>
                  </View>
                ) : (
                  <Image source={detectedDriver.avatar} style={styles.avatar} />
                )}
                <Text style={styles.driverName}>{detectedDriver.name}</Text>
                <Text style={styles.driverPhone}>{detectedDriver.phone}</Text>
              </View>

              {/* SECTION INPUT */}
              <View style={styles.inputSection}>
                <Text style={styles.inputLabel}>Entrer montant à payer</Text>
                <View style={styles.inputWrapper}>
                  <TextInput
                    style={styles.amountInput}
                    placeholder="0"
                    placeholderTextColor="#DDD"
                    keyboardType="numeric"
                    returnKeyType="done"
                    onSubmitEditing={handlePay}
                    value={amount}
                    onChangeText={setAmount}
                    maxLength={7}
                    autoFocus={!showRegisterOverlay}
                    showSoftInputOnFocus={true}
                  />
                  <Text style={styles.currency}>FCFA</Text>
                </View>
              </View>

              {/* SECTION BOUTON - Poussée vers le bas par marginTop: 'auto' */}
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

            </ScrollView>
          </SafeAreaView>

          <Modal
            visible={showRegisterOverlay}
            transparent
            animationType="slide"
            statusBarTranslucent
            onRequestClose={() => setRegisterInviteVisible(false)}
          >
            <View style={styles.regModalRoot}>
              <Pressable
                style={styles.regModalBackdrop}
                onPress={() => {
                  Keyboard.dismiss();
                  setRegisterInviteVisible(false);
                }}
                accessibilityLabel="Fermer"
                accessibilityRole="button"
              />
              <View style={[styles.regModalSheet, { marginTop: regSheetTop }]}>
                <KeyboardAvoidingView
                  style={styles.regModalKeyboard}
                  behavior={Platform.OS === "ios" ? "padding" : "height"}
                >
                  <SafeModalArea
                    style={styles.regModalSafe}
                    edges={["bottom", "left", "right"]}
                  >
                    <View style={styles.regModalHeader}>
                      <Pressable
                        onPress={() => {
                          Keyboard.dismiss();
                          setRegisterInviteVisible(false);
                        }}
                        style={({ pressed }) => [
                          styles.regModalCloseBtn,
                          pressed && styles.regModalCloseBtnPressed,
                        ]}
                        hitSlop={12}
                      >
                        <Ionicons name="close" size={28} color="#333" />
                      </Pressable>
                      <Text style={styles.regModalHeaderTitle}>
                        {welcomeStep === "phone" ? "Inscription" : "Code SMS"}
                      </Text>
                      <View style={styles.regModalHeaderSpacer} />
                    </View>

                    <ScrollView
                      contentContainerStyle={styles.regModalScroll}
                      keyboardShouldPersistTaps="handled"
                      showsVerticalScrollIndicator={false}
                    >
                      <View
                        style={styles.regModalSlideClip}
                        onLayout={(e) => {
                          const w = e.nativeEvent.layout.width;
                          if (w > 0 && Math.abs(w - regSlideWidth) > 0.5) {
                            setRegSlideWidth(w);
                          }
                        }}
                      >
                        <Animated.View
                          style={[
                            styles.regModalSlideRow,
                            {
                              width: regSlidePanelW * 2,
                              transform: [{ translateX: regSlideX }],
                            },
                          ]}
                        >
                          <View
                            style={[
                              styles.regModalSlidePage,
                              { width: regSlidePanelW },
                            ]}
                          >
                            <Text style={styles.regModalLead}>
                              Créez votre compte en quelques secondes. Nous vous enverrons un
                              code par SMS pour vérifier votre numéro.
                            </Text>
                            <Text style={styles.regModalLabel}>Numéro de téléphone</Text>
                            <View style={styles.regModalPhoneWrap}>
                              <Text style={styles.regModalPrefix}>+237</Text>
                              <TextInput
                                ref={regPhoneInputRef}
                                style={styles.regModalPhoneInput}
                                placeholder="612345678"
                                placeholderTextColor="#CCC"
                                keyboardType="number-pad"
                                maxLength={9}
                                value={welcomePhone}
                                onChangeText={(t) =>
                                  setWelcomePhone(normalizeCameroonPhoneDigits(t))
                                }
                                showSoftInputOnFocus
                              />
                            </View>
                            <Pressable
                              style={({ pressed }) => [
                                styles.regModalPrimaryBtn,
                                pressed &&
                                  welcomePhone.length === 9 &&
                                  !authOtpSending &&
                                  otpSendCount < MAX_OTP_SENDS_PER_SESSION &&
                                  styles.regModalPrimaryBtnPressed,
                                (welcomePhone.length !== 9 ||
                                  authOtpSending ||
                                  otpSendCount >= MAX_OTP_SENDS_PER_SESSION) &&
                                  styles.regModalPrimaryBtnDisabled,
                              ]}
                              disabled={
                                welcomePhone.length !== 9 ||
                                authOtpSending ||
                                otpSendCount >= MAX_OTP_SENDS_PER_SESSION
                              }
                              onPress={async () => {
                                if (welcomePhone.length !== 9) return;
                                Keyboard.dismiss();
                                await requestOtpForRegistration("initial");
                              }}
                            >
                              {authOtpSending ? (
                                <ActivityIndicator color="#fff" size="small" />
                              ) : (
                                <Text style={styles.regModalPrimaryBtnText}>Continuer</Text>
                              )}
                            </Pressable>
                          </View>
                          <View
                            style={[
                              styles.regModalSlidePage,
                              { width: regSlidePanelW },
                            ]}
                          >
                            <Text style={styles.regModalLead}>
                              {USE_MOCK_API
                                ? `Démo : saisissez les ${OTP_LEN} chiffres — envoi automatique.`
                                : `Saisissez le code à ${OTP_LEN} chiffres reçu par SMS — envoi automatique.`}
                            </Text>
                            {Platform.OS === "android" && !USE_MOCK_API && (
                              <Text style={styles.regModalOtpAutofillHint}>
                                Si le serveur envoie la clé Android en fin de SMS, le code peut se
                                remplir tout seul. Sinon : suggestion au-dessus du clavier, ou copie
                                les 6 chiffres puis reviens ici.
                              </Text>
                            )}
                            <Text style={styles.regModalOtpHint}>
                              +237{" "}
                              {welcomePhone
                                ? formatCameroonPhoneDisplay(welcomePhone)
                                : "…"}
                            </Text>
                            <Text style={styles.regModalLabel}>Code de vérification</Text>
                            <TextInput
                              ref={regOtpInputRef}
                              style={styles.regModalOtpInput}
                              placeholder="• • • • • •"
                              placeholderTextColor="#DDD"
                              keyboardType="number-pad"
                              value={welcomeOtp}
                              onChangeText={(t) =>
                                setWelcomeOtp(t.replace(/\D/g, "").slice(0, OTP_LEN))
                              }
                              maxLength={OTP_LEN}
                              textContentType="oneTimeCode"
                              autoCapitalize="none"
                              autoCorrect={false}
                              spellCheck={false}
                              autoComplete={
                                Platform.OS === "android" ? "sms-otp" : "one-time-code"
                              }
                              {...(Platform.OS === "android"
                                ? { importantForAutofill: "yes" as const }
                                : {})}
                              showSoftInputOnFocus
                            />
                            <Pressable
                              style={({ pressed }) => [
                                styles.regModalPrimaryBtn,
                                pressed &&
                                  welcomeOtp.length === OTP_LEN &&
                                  !authVerifySending &&
                                  styles.regModalPrimaryBtnPressed,
                                (welcomeOtp.length !== OTP_LEN || authVerifySending) &&
                                  styles.regModalPrimaryBtnDisabled,
                              ]}
                              disabled={
                                welcomeOtp.length !== OTP_LEN || authVerifySending
                              }
                              onPress={() => void submitOtpVerification()}
                            >
                              {authVerifySending ? (
                                <ActivityIndicator color="#fff" size="small" />
                              ) : (
                                <Text style={styles.regModalPrimaryBtnText}>Valider</Text>
                              )}
                            </Pressable>
                            {otpSendCount >= MAX_OTP_SENDS_PER_SESSION ? (
                              <Text style={styles.regModalResendLimit}>
                                Limite d’envois atteinte. Fermez l’inscription et réessayez plus
                                tard, ou modifiez le numéro ci-dessous.
                              </Text>
                            ) : otpResendCooldown > 0 ? (
                              <Text style={styles.regModalResendHint}>
                                Renvoyer le code dans{" "}
                                <Text style={styles.regModalResendHintEm}>
                                  {otpResendCooldown}s
                                </Text>
                              </Text>
                            ) : (
                              <Pressable
                                style={({ pressed }) => [
                                  styles.regModalResendBtn,
                                  (authResendSending || authVerifySending) &&
                                    styles.regModalResendBtnDisabled,
                                  pressed &&
                                    !authResendSending &&
                                    !authVerifySending &&
                                    styles.regModalResendBtnPressed,
                                ]}
                                disabled={authResendSending || authVerifySending}
                                onPress={async () => {
                                  Keyboard.dismiss();
                                  await requestOtpForRegistration("resend");
                                }}
                              >
                                {authResendSending ? (
                                  <ActivityIndicator color={ACCENT} size="small" />
                                ) : (
                                  <Text style={styles.regModalResendBtnText}>
                                    Renvoyer le code
                                  </Text>
                                )}
                              </Pressable>
                            )}
                            <Pressable
                              style={({ pressed }) => [
                                styles.regModalBackLink,
                                pressed && { opacity: 0.6 },
                              ]}
                              onPress={() => {
                                Keyboard.dismiss();
                                setWelcomeStep("phone");
                                setOtpResendCooldown(0);
                              }}
                            >
                              <Text style={styles.regModalBackLinkText}>
                                Modifier le numéro
                              </Text>
                            </Pressable>
                          </View>
                        </Animated.View>
                      </View>
                    </ScrollView>
                  </SafeModalArea>
                </KeyboardAvoidingView>
              </View>
            </View>
          </Modal>
          {showRegisterOverlay && (
            <AndroidOtpSmsAutofill
              applyOtp={welcomeStep === "otp"}
              otpLength={OTP_LEN}
              onCode={applySmsAutofillOtp}
            />
          )}
        </View>
      </TouchableWithoutFeedback>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 22,
    paddingBottom: 52,
  },
  balanceWrap: {
    alignItems: "center",
    marginTop: 18,
    marginBottom: 4,
  },
  /** Même base que `createAccountBtn`, espacement sous le solde. */
  rechargeBtn: {
    marginTop: 8,
    marginBottom: 0,
  },
  createAccountBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    marginTop: 10,
    marginBottom: 5,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: ACCENT,
    backgroundColor: "#fff",
  },
  createAccountBtnIcon: { marginRight: 8 },
  createAccountBtnPressed: {
    backgroundColor: "rgba(93, 199, 5, 0.08)",
    transform: [{ scale: 0.99 }],
  },
  createAccountBtnText: {
    fontSize: 14,
    fontWeight: "700",
    color: ACCENT,
  },
  sayHelloBtn: {
    alignSelf: "center",
    marginTop: 12,
    marginBottom: 4,
    minWidth: 160,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 22,
    backgroundColor: "#222",
    alignItems: "center",
    justifyContent: "center",
    minHeight: 48,
  },
  sayHelloBtnPressed: {
    opacity: 0.88,
    transform: [{ scale: 0.98 }],
  },
  sayHelloBtnDisabled: {
    opacity: 0.5,
  },
  sayHelloBtnText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  balanceAmountRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    maxWidth: "100%",
    flexWrap: "wrap",
  },
  balanceLabel: {
    fontSize: 15,
    fontWeight: "700",
    color: "#888",
    marginRight: 8,
  },
  balanceAmountNum: {
    fontSize: 18,
    fontWeight: "800",
    color: ACCENT,
  },
  balanceCurrency: {
    fontSize: 13,
    fontWeight: "700",
    color: "#AAA",
    marginLeft: 6,
  },
  balanceReassuranceRow: {
    marginTop: 0,
    width: "100%",
    paddingHorizontal: 12,
    alignItems: "center",
  },
  balanceReassuranceInner: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "center",
    alignSelf: "center",
    maxWidth: 300,
  },
  balanceReassuranceIcon: {
    marginRight: 5,
    marginTop: 1,
  },
  balanceReassurance: {
    flexShrink: 1,
    maxWidth: 248,
    fontSize: 9,
    fontWeight: "300",
    color: "#999",
    lineHeight: 11,
  },
  /** Modal inscription — aligné sur `app/deposit.tsx` (feuille + header). */
  regModalRoot: {
    flex: 1,
    backgroundColor: "transparent",
  },
  regModalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  regModalSheet: {
    flex: 1,
    backgroundColor: "#fff",
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    overflow: "hidden",
  },
  regModalKeyboard: {
    flex: 1,
  },
  regModalSafe: {
    flex: 1,
  },
  regModalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#F0F0F0",
  },
  regModalCloseBtn: {
    width: 44,
    height: 44,
    justifyContent: "center",
    alignItems: "flex-start",
  },
  regModalCloseBtnPressed: { opacity: 0.6 },
  regModalHeaderTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: "#333",
  },
  regModalHeaderSpacer: { width: 44 },
  regModalScroll: {
    paddingHorizontal: 25,
    paddingTop: 10,
    paddingBottom: 28,
  },
  regModalSlideClip: {
    width: "100%",
    overflow: "hidden",
  },
  regModalSlideRow: {
    flexDirection: "row",
  },
  regModalSlidePage: {
    flexShrink: 0,
  },
  regModalLead: {
    fontSize: 13,
    color: "#666",
    lineHeight: 19,
    marginBottom: 22,
  },
  regModalOtpAutofillHint: {
    fontSize: 11,
    color: "#999",
    lineHeight: 16,
    marginTop: -12,
    marginBottom: 14,
  },
  regModalLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#888",
    marginBottom: 10,
    letterSpacing: 0.8,
    textAlign: "center",
  },
  regModalPhoneWrap: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F8F8F8",
    borderRadius: 20,
    paddingHorizontal: 20,
    borderWidth: 1,
    borderColor: "#EEE",
    marginBottom: 20,
    minHeight: 56,
  },
  regModalPrefix: {
    fontSize: 17,
    fontWeight: "700",
    color: "#333",
    marginRight: 10,
  },
  regModalPhoneInput: {
    flex: 1,
    fontSize: 18,
    fontWeight: "600",
    color: "#222",
    paddingVertical: 14,
  },
  regModalPrimaryBtn: {
    backgroundColor: ACCENT,
    height: 56,
    borderRadius: 28,
    justifyContent: "center",
    alignItems: "center",
  },
  regModalPrimaryBtnPressed: {
    opacity: 0.92,
    transform: [{ scale: 0.99 }],
  },
  regModalPrimaryBtnDisabled: {
    backgroundColor: "#CCC",
  },
  regModalPrimaryBtnText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
  },
  regModalOtpHint: {
    fontSize: 14,
    fontWeight: "600",
    color: "#555",
    textAlign: "center",
    marginBottom: 16,
  },
  regModalOtpInput: {
    width: "100%",
    height: 56,
    fontSize: 22,
    fontWeight: "700",
    letterSpacing: 8,
    textAlign: "center",
    color: "#222",
    backgroundColor: "#F8F8F8",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#EEE",
    marginBottom: 20,
    paddingHorizontal: 12,
  },
  regModalResendHint: {
    fontSize: 14,
    fontWeight: "600",
    color: "#666",
    textAlign: "center",
    marginTop: 4,
    marginBottom: 4,
  },
  regModalResendHintEm: {
    color: "#333",
    fontVariant: ["tabular-nums"],
  },
  regModalResendBtn: {
    alignSelf: "center",
    marginTop: 4,
    marginBottom: 4,
    paddingVertical: 12,
    paddingHorizontal: 16,
    minHeight: 44,
    justifyContent: "center",
  },
  regModalResendBtnPressed: {
    opacity: 0.65,
  },
  regModalResendBtnDisabled: {
    opacity: 0.45,
  },
  regModalResendBtnText: {
    fontSize: 15,
    fontWeight: "700",
    color: ACCENT,
    textDecorationLine: "underline",
  },
  regModalResendLimit: {
    fontSize: 13,
    fontWeight: "600",
    color: "#888",
    textAlign: "center",
    marginTop: 6,
    marginBottom: 4,
    lineHeight: 18,
  },
  regModalBackLink: {
    alignSelf: "center",
    marginTop: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  regModalBackLinkText: {
    fontSize: 14,
    fontWeight: "600",
    color: ACCENT,
    textDecorationLine: "underline",
  },
  profileSection: {
    alignItems: "center",
    marginTop: 22,
    marginBottom: 32,
  },
  avatar: {
    width: 96,
    height: 96,
    borderRadius: 48,
    marginBottom: 14,
  },
  avatarPlaceholder: {
    backgroundColor: "#f0f0f0",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#EEE",
  },
  avatarLetter: {
    fontSize: 40,
    fontWeight: "bold",
    color: ACCENT,
  },
  driverName: {
    fontSize: 18,
    fontWeight: "700",
    color: "#333",
  },
  driverPhone: {
    fontSize: 15,
    color: "#888",
    marginTop: 4,
  },
  inputSection: {
    marginBottom: 20,
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
    backgroundColor: "#F8F8F8",
    borderRadius: 18,
    paddingHorizontal: 18,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: "#EEE",
  },
  amountInput: {
    flex: 1,
    height: 72,
    fontSize: 28,
    fontWeight: "bold",
    color: "#222",
  },
  currency: {
    fontSize: 19,
    fontWeight: "800",
    color: "#AAA",
    marginLeft: 10,
  },
  actionSection: {
    marginTop: 'auto',    // Espace de sécurité
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