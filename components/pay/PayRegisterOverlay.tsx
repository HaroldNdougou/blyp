import { useAuth } from "@/contexts/AuthContext";
import {
  ApiError,
  fetchHealth,
  setOnboardingProfile,
  setOnboardingTransactionPin,
} from "@/lib/api/client";
import { USE_MOCK_API } from "@/lib/config";
import {
  formatCameroonPhoneDisplay,
  inferCameroonMobileMoneyBrand,
  normalizeCameroonPhoneDigits,
} from "@/lib/format";
import { Ionicons } from "@expo/vector-icons";
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
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView as SafeModalArea, useSafeAreaInsets } from "react-native-safe-area-context";
import { AndroidOtpSmsAutofill } from "@/components/AndroidOtpSmsAutofill";

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
const ONBOARDING_PIN_LEN = 4;

const REG_STEPS = [
  "phone",
  "otp",
  "pin",
  "pinConfirm",
  "profile",
] as const;
type RegStep = (typeof REG_STEPS)[number];

function regModalTitle(step: RegStep): string {
  switch (step) {
    case "phone":
      return "Téléphone";
    case "otp":
      return "Code SMS";
    case "pin":
      return "Code PIN";
    case "pinConfirm":
      return "Confirmer";
    case "profile":
      return "Votre profil";
    default:
      return "";
  }
}

export default function PayRegisterOverlay({
  onComplete,
}: {
  onComplete: () => void;
}) {
  const { user, token, requestOtp, verifyAndSignIn, refreshUser } = useAuth();
  const [welcomePhone, setWelcomePhone] = useState("");
  const [welcomeOtp, setWelcomeOtp] = useState("");
  const [welcomeStep, setWelcomeStep] = useState<RegStep>("phone");
  const [onboardingPin, setOnboardingPin] = useState("");
  const [onboardingPinConfirm, setOnboardingPinConfirm] = useState("");
  const [onboardingFirstName, setOnboardingFirstName] = useState("");
  const [onboardingLastName, setOnboardingLastName] = useState("");
  const [authOtpSending, setAuthOtpSending] = useState(false);
  const [authResendSending, setAuthResendSending] = useState(false);
  const [authVerifySending, setAuthVerifySending] = useState(false);
  const [authPinSaving, setAuthPinSaving] = useState(false);
  const [authProfileSaving, setAuthProfileSaving] = useState(false);
  const [otpResendCooldown, setOtpResendCooldown] = useState(0);
  const [otpSendCount, setOtpSendCount] = useState(0);
  const regPhoneInputRef = useRef<TextInput>(null);
  const regOtpInputRef = useRef<TextInput>(null);
  const regPinInputRef = useRef<TextInput>(null);
  const regPinConfirmInputRef = useRef<TextInput>(null);
  const regFirstNameInputRef = useRef<TextInput>(null);
  const regLastNameInputRef = useRef<TextInput>(null);
  const otpAutoSubmittedRef = useRef<string | null>(null);
  const otpVerifyInFlightRef = useRef(false);
  const pinFirstAutoSubmittedRef = useRef<string | null>(null);
  const pinConfirmAutoSubmittedRef = useRef<string | null>(null);
  const pinConfirmVerifyInFlightRef = useRef(false);
  const railwayOtpHashAlertShownRef = useRef(false);
  const regSlideX = useRef(new Animated.Value(0)).current;
  const [regSlideWidth, setRegSlideWidth] = useState(0);
  const { width: windowWidth } = useWindowDimensions();
  const regSlidePanelW =
    regSlideWidth > 0 ? regSlideWidth : Math.max(280, windowWidth - 72);
  const regInsets = useSafeAreaInsets();
  const regSheetTop = regInsets.top + REG_SHEET_EXTRA_TOP;

  const phoneWalletBrand = inferCameroonMobileMoneyBrand(welcomePhone);

  useEffect(() => {
    if (user?.needsOnboarding) {
      setWelcomeStep(user.onboardingStep === "profile" ? "profile" : "pin");
      const nine = user.phone.replace(/\D/g, "").slice(-9);
      setWelcomePhone(nine);
      setOnboardingFirstName(user.firstName?.trim() ?? "");
      setOnboardingLastName(user.lastName?.trim() ?? "");
    } else {
      setWelcomeStep("phone");
      setWelcomeOtp("");
      setWelcomePhone("");
      setOtpResendCooldown(0);
      setOtpSendCount(0);
      setOnboardingPin("");
      setOnboardingPinConfirm("");
      setOnboardingFirstName("");
      setOnboardingLastName("");
    }
  }, [user]);

  useEffect(() => {
    if (welcomeStep !== "otp" || otpResendCooldown <= 0) return;
    const id = setInterval(() => {
      setOtpResendCooldown((s) => Math.max(0, s - 1));
    }, 1000);
    return () => clearInterval(id);
  }, [welcomeStep, otpResendCooldown > 0]);

  useEffect(() => {
    const w =
      regSlideWidth > 0 ? regSlideWidth : Math.max(280, windowWidth - 72);
    const idx = Math.max(0, REG_STEPS.indexOf(welcomeStep));
    const to = -w * idx;
    Animated.timing(regSlideX, {
      toValue: to,
      duration: 320,
      useNativeDriver: true,
    }).start();
  }, [welcomeStep, regSlideWidth, windowWidth, regSlideX]);

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
      const u = await verifyAndSignIn(welcomePhone, welcomeOtp);
      setWelcomeOtp("");
      if (!u.needsOnboarding) {
        onComplete();
      } else {
        setWelcomeStep("pin");
        setOnboardingPin("");
        setOnboardingPinConfirm("");
      }
    } catch (e) {
      Alert.alert(
        "Vérification",
        e instanceof ApiError ? e.message : "Code invalide.",
      );
    } finally {
      otpVerifyInFlightRef.current = false;
      setAuthVerifySending(false);
    }
  }, [welcomePhone, welcomeOtp, verifyAndSignIn, onComplete]);

  const applySmsAutofillOtp = useCallback((digits: string) => {
    setWelcomeOtp(digits);
  }, []);

  const closeRegistrationOverlay = useCallback(() => {
    Keyboard.dismiss();
    onComplete();
  }, [onComplete]);

  const goBackToRegistrationPhone = useCallback(() => {
    Keyboard.dismiss();
    setWelcomeStep("phone");
    setOtpResendCooldown(0);
  }, []);

  const goBackInRegistrationHeader = useCallback(() => {
    Keyboard.dismiss();
    if (welcomeStep === "otp") {
      goBackToRegistrationPhone();
      return;
    }
    if (welcomeStep === "pin") {
      setWelcomeStep("otp");
      setOnboardingPin("");
      return;
    }
    if (welcomeStep === "pinConfirm") {
      setWelcomeStep("pin");
      setOnboardingPinConfirm("");
    }
  }, [welcomeStep, goBackToRegistrationPhone]);

  const submitOnboardingPinContinue = useCallback(() => {
    const d = onboardingPin.replace(/\D/g, "");
    if (d.length !== ONBOARDING_PIN_LEN) return;
    Keyboard.dismiss();
    setWelcomeStep("pinConfirm");
    setOnboardingPinConfirm("");
  }, [onboardingPin]);

  const submitOnboardingPinConfirm = useCallback(async () => {
    const a = onboardingPin.replace(/\D/g, "");
    const b = onboardingPinConfirm.replace(/\D/g, "");
    if (a.length !== ONBOARDING_PIN_LEN || b.length !== ONBOARDING_PIN_LEN) return;
    if (a !== b) {
      Alert.alert("Code PIN", "Les deux saisies ne correspondent pas.");
      setOnboardingPinConfirm("");
      pinConfirmAutoSubmittedRef.current = null;
      return;
    }
    if (!token) return;
    if (pinConfirmVerifyInFlightRef.current) return;
    pinConfirmVerifyInFlightRef.current = true;
    Keyboard.dismiss();
    setAuthPinSaving(true);
    try {
      await setOnboardingTransactionPin(token, b);
      await refreshUser();
      setWelcomeStep("profile");
      setOnboardingPin("");
      setOnboardingPinConfirm("");
      pinConfirmAutoSubmittedRef.current = null;
    } catch (e) {
      Alert.alert(
        "Code PIN",
        e instanceof ApiError ? e.message : "Enregistrement impossible.",
      );
      pinConfirmAutoSubmittedRef.current = null;
    } finally {
      pinConfirmVerifyInFlightRef.current = false;
      setAuthPinSaving(false);
    }
  }, [
    onboardingPin,
    onboardingPinConfirm,
    token,
    refreshUser,
  ]);

  const submitOnboardingProfile = useCallback(async () => {
    const f = onboardingFirstName.trim();
    const l = onboardingLastName.trim();
    if (f.length < 2 || l.length < 2) {
      Alert.alert(
        "Profil",
        "Prénom et nom : au moins 2 caractères chacun.",
      );
      return;
    }
    if (!token) return;
    Keyboard.dismiss();
    setAuthProfileSaving(true);
    try {
      await setOnboardingProfile(token, f, l);
      await refreshUser();
      onComplete();
    } catch (e) {
      Alert.alert(
        "Profil",
        e instanceof ApiError ? e.message : "Enregistrement impossible.",
      );
    } finally {
      setAuthProfileSaving(false);
    }
  }, [onboardingFirstName, onboardingLastName, token, refreshUser, onComplete]);

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

  useEffect(() => {
    if (welcomeStep !== "pin") {
      pinFirstAutoSubmittedRef.current = null;
      return;
    }
    const d = onboardingPin.replace(/\D/g, "");
    if (d.length < ONBOARDING_PIN_LEN) {
      pinFirstAutoSubmittedRef.current = null;
      return;
    }
    if (pinFirstAutoSubmittedRef.current === d) return;
    pinFirstAutoSubmittedRef.current = d;
    submitOnboardingPinContinue();
  }, [welcomeStep, onboardingPin, submitOnboardingPinContinue]);

  useEffect(() => {
    if (welcomeStep !== "pinConfirm") {
      pinConfirmAutoSubmittedRef.current = null;
      return;
    }
    const b = onboardingPinConfirm.replace(/\D/g, "");
    if (b.length < ONBOARDING_PIN_LEN) {
      pinConfirmAutoSubmittedRef.current = null;
      return;
    }
    if (authPinSaving || pinConfirmVerifyInFlightRef.current) return;
    if (pinConfirmAutoSubmittedRef.current === b) return;
    pinConfirmAutoSubmittedRef.current = b;
    void submitOnboardingPinConfirm();
  }, [
    welcomeStep,
    onboardingPinConfirm,
    authPinSaving,
    submitOnboardingPinConfirm,
  ]);

  /** Focus + clavier après ouverture du modal / changement d’étape (délai Android = fin animation). */
  useEffect(() => {
    const delay = Platform.OS === "android" ? 450 : 120;
    const t = setTimeout(() => {
      if (welcomeStep === "phone") regPhoneInputRef.current?.focus();
      else if (welcomeStep === "otp") regOtpInputRef.current?.focus();
      else if (welcomeStep === "pin") regPinInputRef.current?.focus();
      else if (welcomeStep === "pinConfirm")
        regPinConfirmInputRef.current?.focus();
      else if (welcomeStep === "profile")
        regFirstNameInputRef.current?.focus();
    }, delay);
    return () => clearTimeout(t);
  }, [welcomeStep]);

  useEffect(() => {
    if (welcomeStep === "phone") railwayOtpHashAlertShownRef.current = false;
  }, [welcomeStep]);

  useEffect(() => {
    if (welcomeStep !== "otp" || railwayOtpHashAlertShownRef.current) return;
    let cancelled = false;
    void (async () => {
      try {
        const h = await fetchHealth();
        const snap = h.sms?.androidOtpHash;
        if (cancelled || !snap) return;
        railwayOtpHashAlertShownRef.current = true;
        console.log(
          "[Blyp] ANDROID_SMS_OTP_APP_HASH (lu par le serveur / Railway)",
          JSON.stringify(snap, null, 2),
        );
      } catch (e) {
        console.warn("[Blyp] GET /health impossible", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [welcomeStep]);

  return (
    <>
      <Modal
        visible
            transparent
            animationType="slide"
            statusBarTranslucent
            onRequestClose={() => {
              if (welcomeStep === "phone") {
                closeRegistrationOverlay();
              } else {
                Keyboard.dismiss();
                goBackInRegistrationHeader();
              }
            }}
          >
            <View style={styles.regModalRoot}>
              <Pressable
                style={styles.regModalBackdrop}
                onPress={() => {
                  if (welcomeStep === "phone") closeRegistrationOverlay();
                  else Keyboard.dismiss();
                }}
                accessibilityLabel={
                  welcomeStep === "phone" ? "Fermer" : "Fond"
                }
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
                      {welcomeStep === "phone" ? (
                        <Pressable
                          onPress={closeRegistrationOverlay}
                          style={({ pressed }) => [
                            styles.regModalBackHeaderBtn,
                            pressed && styles.regModalBackHeaderBtnPressed,
                          ]}
                          hitSlop={12}
                          accessibilityLabel="Fermer"
                          accessibilityRole="button"
                        >
                          <Ionicons name="close" size={28} color="#333" />
                        </Pressable>
                      ) : welcomeStep === "otp" ||
                        welcomeStep === "pin" ||
                        welcomeStep === "pinConfirm" ? (
                        <Pressable
                          onPress={goBackInRegistrationHeader}
                          style={({ pressed }) => [
                            styles.regModalBackHeaderBtn,
                            pressed && styles.regModalBackHeaderBtnPressed,
                          ]}
                          hitSlop={12}
                          accessibilityLabel={
                            welcomeStep === "otp"
                              ? "Modifier le numéro"
                              : "Retour"
                          }
                          accessibilityRole="button"
                        >
                          <Ionicons name="chevron-back" size={28} color="#333" />
                        </Pressable>
                      ) : (
                        <View style={styles.regModalHeaderLeading} />
                      )}
                      <Text style={styles.regModalHeaderTitle}>
                        {regModalTitle(welcomeStep)}
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
                              width: regSlidePanelW * REG_STEPS.length,
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
                              Nous vous enverrons un code par SMS pour vérifier votre numéro.
                            </Text>
                            <Text style={styles.regModalLabel}>Numéro de téléphone</Text>
                            <View style={styles.regModalPhoneWrap}>
                              <Text
                                style={styles.regModalFlag}
                                accessibilityLabel="Cameroun"
                              >
                                🇨🇲
                              </Text>
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
                              {phoneWalletBrand === "orange" && (
                                <Image
                                  source={require("../../assets/images/orange-money.png")}
                                  style={[
                                    styles.regModalWalletLogo,
                                    styles.regModalWalletLogoOrange,
                                  ]}
                                  accessibilityLabel="Orange Money"
                                />
                              )}
                              {phoneWalletBrand === "mtn" && (
                                <Image
                                  source={require("../../assets/images/mtn-mobile-money.png")}
                                  style={[
                                    styles.regModalWalletLogo,
                                    styles.regModalWalletLogoMtn,
                                  ]}
                                  accessibilityLabel="MTN Mobile Money"
                                />
                              )}
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
                                : `Saisissez le code à ${OTP_LEN} chiffres reçu par SMS.`}
                            </Text>
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
                                Limite d’envois atteinte. Réessayez plus tard ou modifiez le numéro
                                ci-dessous.
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
                              onPress={goBackToRegistrationPhone}
                            >
                              <Text style={styles.regModalBackLinkText}>
                                Modifier le numéro
                              </Text>
                            </Pressable>
                          </View>
                          <View
                            style={[
                              styles.regModalSlidePage,
                              { width: regSlidePanelW },
                            ]}
                          >
                            <Text style={styles.regModalLead}>
                              Choisissez un code PIN à 4 chiffres pour valider vos paiements. Ne le
                              partagez avec personne.
                            </Text>
                            <Text style={styles.regModalLabel}>Nouveau code PIN</Text>
                            <TextInput
                              ref={regPinInputRef}
                              style={styles.regModalOtpInput}
                              placeholder="• • • •"
                              placeholderTextColor="#DDD"
                              keyboardType="number-pad"
                              secureTextEntry
                              value={onboardingPin}
                              onChangeText={(t) =>
                                setOnboardingPin(
                                  t.replace(/\D/g, "").slice(0, ONBOARDING_PIN_LEN),
                                )
                              }
                              maxLength={ONBOARDING_PIN_LEN}
                              autoCapitalize="none"
                              autoCorrect={false}
                              showSoftInputOnFocus
                            />
                            <Pressable
                              style={({ pressed }) => [
                                styles.regModalPrimaryBtn,
                                pressed &&
                                  onboardingPin.replace(/\D/g, "").length ===
                                    ONBOARDING_PIN_LEN &&
                                  styles.regModalPrimaryBtnPressed,
                                onboardingPin.replace(/\D/g, "").length !==
                                  ONBOARDING_PIN_LEN &&
                                  styles.regModalPrimaryBtnDisabled,
                              ]}
                              disabled={
                                onboardingPin.replace(/\D/g, "").length !==
                                ONBOARDING_PIN_LEN
                              }
                              onPress={submitOnboardingPinContinue}
                            >
                              <Text style={styles.regModalPrimaryBtnText}>Continuer</Text>
                            </Pressable>
                          </View>
                          <View
                            style={[
                              styles.regModalSlidePage,
                              { width: regSlidePanelW },
                            ]}
                          >
                            <Text style={styles.regModalLead}>
                              Saisissez à nouveau votre code PIN pour confirmer.
                            </Text>
                            <Text style={styles.regModalLabel}>Confirmation</Text>
                            <TextInput
                              ref={regPinConfirmInputRef}
                              style={styles.regModalOtpInput}
                              placeholder="• • • •"
                              placeholderTextColor="#DDD"
                              keyboardType="number-pad"
                              secureTextEntry
                              value={onboardingPinConfirm}
                              onChangeText={(t) =>
                                setOnboardingPinConfirm(
                                  t.replace(/\D/g, "").slice(0, ONBOARDING_PIN_LEN),
                                )
                              }
                              maxLength={ONBOARDING_PIN_LEN}
                              autoCapitalize="none"
                              autoCorrect={false}
                              showSoftInputOnFocus
                            />
                            <Pressable
                              style={({ pressed }) => [
                                styles.regModalPrimaryBtn,
                                pressed &&
                                  onboardingPinConfirm.replace(/\D/g, "").length ===
                                    ONBOARDING_PIN_LEN &&
                                  !authPinSaving &&
                                  styles.regModalPrimaryBtnPressed,
                                (onboardingPinConfirm.replace(/\D/g, "").length !==
                                  ONBOARDING_PIN_LEN ||
                                  authPinSaving) &&
                                  styles.regModalPrimaryBtnDisabled,
                              ]}
                              disabled={
                                onboardingPinConfirm.replace(/\D/g, "").length !==
                                  ONBOARDING_PIN_LEN || authPinSaving
                              }
                              onPress={() => void submitOnboardingPinConfirm()}
                            >
                              {authPinSaving ? (
                                <ActivityIndicator color="#fff" size="small" />
                              ) : (
                                <Text style={styles.regModalPrimaryBtnText}>
                                  Enregistrer le PIN
                                </Text>
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
                              Indiquez votre prénom et votre nom pour finaliser votre compte.
                            </Text>
                            <Text style={styles.regModalLabel}>Prénom</Text>
                            <TextInput
                              ref={regFirstNameInputRef}
                              style={styles.regModalProfileInput}
                              placeholder="Ex. Jean"
                              placeholderTextColor="#CCC"
                              value={onboardingFirstName}
                              onChangeText={setOnboardingFirstName}
                              autoCapitalize="words"
                              autoCorrect={false}
                              maxLength={80}
                            />
                            <Text style={styles.regModalLabel}>Nom</Text>
                            <TextInput
                              ref={regLastNameInputRef}
                              style={styles.regModalProfileInput}
                              placeholder="Ex. Kamga"
                              placeholderTextColor="#CCC"
                              value={onboardingLastName}
                              onChangeText={setOnboardingLastName}
                              autoCapitalize="words"
                              autoCorrect={false}
                              maxLength={80}
                            />
                            <Pressable
                              style={({ pressed }) => [
                                styles.regModalPrimaryBtn,
                                pressed &&
                                  onboardingFirstName.trim().length >= 2 &&
                                  onboardingLastName.trim().length >= 2 &&
                                  !authProfileSaving &&
                                  styles.regModalPrimaryBtnPressed,
                                (onboardingFirstName.trim().length < 2 ||
                                  onboardingLastName.trim().length < 2 ||
                                  authProfileSaving) &&
                                  styles.regModalPrimaryBtnDisabled,
                              ]}
                              disabled={
                                onboardingFirstName.trim().length < 2 ||
                                onboardingLastName.trim().length < 2 ||
                                authProfileSaving
                              }
                              onPress={() => void submitOnboardingProfile()}
                            >
                              {authProfileSaving ? (
                                <ActivityIndicator color="#fff" size="small" />
                              ) : (
                                <Text style={styles.regModalPrimaryBtnText}>
                                  Terminer
                                </Text>
                              )}
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
      <AndroidOtpSmsAutofill
        applyOtp={welcomeStep === "otp"}
        otpLength={OTP_LEN}
        onCode={applySmsAutofillOtp}
      />
    </>
  );
}

const styles = StyleSheet.create({
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
  /** Espace réservé (même largeur que la flèche retour) pour garder le titre centré. */
  regModalHeaderLeading: {
    width: 44,
    height: 44,
  },
  regModalBackHeaderBtn: {
    width: 44,
    height: 44,
    justifyContent: "center",
    alignItems: "flex-start",
  },
  regModalBackHeaderBtnPressed: { opacity: 0.6 },
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
    paddingLeft: 12,
    paddingRight: 6,
    borderWidth: 1,
    borderColor: "#EEE",
    marginBottom: 20,
    minHeight: 56,
  },
  regModalFlag: {
    fontSize: 15,
    lineHeight: 19,
    marginRight: 5,
  },
  regModalPrefix: {
    fontSize: 13,
    fontWeight: "700",
    color: "#333",
    marginRight: 6,
    letterSpacing: -0.2,
  },
  regModalPhoneInput: {
    flex: 1,
    fontSize: 16,
    fontWeight: "600",
    color: "#222",
    paddingVertical: 12,
    paddingHorizontal: 0,
    minWidth: 0,
  },
  regModalWalletLogo: {
    marginLeft: "auto",
    flexShrink: 0,
    alignSelf: "center",
    resizeMode: "contain",
  },
  /** Boîte plus carrée : évite le vide latéral avec le logo Orange (fond noir / icône centrée). */
  regModalWalletLogoOrange: {
    width: 26,
    height: 26,
    marginRight: 4,
  },
  /** Logo MTN plus horizontal. */
  regModalWalletLogoMtn: {
    width: 56,
    height: 24,
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
  regModalProfileInput: {
    width: "100%",
    minHeight: 48,
    fontSize: 17,
    fontWeight: "600",
    color: "#222",
    backgroundColor: "#F8F8F8",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#EEE",
    marginBottom: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
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
});