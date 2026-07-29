import { AndroidOtpSmsAutofill } from "@/components/AndroidOtpSmsAutofill";
import { createPayRegisterStyles } from "@/components/pay/payRegisterStyles";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
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
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
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
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView as SafeModalArea } from "react-native-safe-area-context";

/** Part de la hauteur d’écran pour la feuille (depuis le bas), aligné sur `app/deposit.tsx`. */
const REG_SHEET_HEIGHT_RATIO = 0.85;

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

export default function PayRegisterOverlay({
  onComplete,
}: {
  onComplete: () => void;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => createPayRegisterStyles(colors), [colors]);
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
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const regSlidePanelW =
    regSlideWidth > 0 ? regSlideWidth : Math.max(280, windowWidth - 72);
  const regSheetHeight = windowHeight * REG_SHEET_HEIGHT_RATIO;

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
        t("register.sendLimitTitle"),
        t("register.sendLimitMessage"),
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
        e instanceof ApiError ? e.message : t("common.sendCodeFailed");
      if (e instanceof ApiError && e.retryAfterSeconds != null) {
        setOtpResendCooldown(e.retryAfterSeconds);
      }
      Alert.alert(t("register.smsCodeTitle"), msg);
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
        t("register.verificationTitle"),
        e instanceof ApiError ? e.message : t("common.invalidCode"),
      );
    } finally {
      otpVerifyInFlightRef.current = false;
      setAuthVerifySending(false);
    }
  }, [welcomePhone, welcomeOtp, verifyAndSignIn, onComplete, t]);

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
      Alert.alert(t("register.pinTitle"), t("register.pinMismatch"));
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
        t("register.pinTitle"),
        e instanceof ApiError ? e.message : t("common.saveFailed"),
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
    t,
  ]);

  const submitOnboardingProfile = useCallback(async () => {
    const f = onboardingFirstName.trim();
    const l = onboardingLastName.trim();
    if (f.length < 2 || l.length < 2) {
      Alert.alert(
        t("register.profileTitle"),
        t("register.profileMinLength"),
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
        t("register.profileTitle"),
        e instanceof ApiError ? e.message : t("common.saveFailed"),
      );
    } finally {
      setAuthProfileSaving(false);
    }
  }, [onboardingFirstName, onboardingLastName, token, refreshUser, onComplete, t]);

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

  /** Focus + clavier : court délai pour la mise en page du modal (pas d’animation d’entrée). */
  useEffect(() => {
    const delay = Platform.OS === "android" ? 100 : 50;
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
            animationType="none"
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
                  welcomeStep === "phone" ? t("common.close") : t("common.background")
                }
                accessibilityRole="button"
              />
              <View style={[styles.regModalSheet, { height: regSheetHeight }]}>
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
                          accessibilityLabel={t("common.close")}
                          accessibilityRole="button"
                        >
                          <Ionicons name="close" size={28} color={colors.text} />
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
                              ? t("register.editPhone")
                              : t("common.back")
                          }
                          accessibilityRole="button"
                        >
                          <Ionicons name="chevron-back" size={28} color={colors.text} />
                        </Pressable>
                      ) : (
                        <View style={styles.regModalHeaderLeading} />
                      )}
                      <Text style={styles.regModalHeaderTitle}>
                        {t(`register.steps.${welcomeStep}`)}
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
                              {t("register.smsVerifyLead")}
                            </Text>
                            <Text style={styles.regModalLabel}>{t("register.phoneLabel")}</Text>
                            <View style={styles.regModalPhoneWrap}>
                              <Text
                                style={styles.regModalFlag}
                                accessibilityLabel={t("common.cameroon")}
                              >
                                🇨🇲
                              </Text>
                              <Text style={styles.regModalPrefix}>+237</Text>
                              <TextInput
                                ref={regPhoneInputRef}
                                style={styles.regModalPhoneInput}
                                placeholder={t("register.phonePlaceholder")}
                                placeholderTextColor={colors.placeholder}
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
                                  accessibilityLabel={t("common.orangeMoney")}
                                />
                              )}
                              {phoneWalletBrand === "mtn" && (
                                <Image
                                  source={require("../../assets/images/mtn-mobile-money.png")}
                                  style={[
                                    styles.regModalWalletLogo,
                                    styles.regModalWalletLogoMtn,
                                  ]}
                                  accessibilityLabel={t("common.mtnMobileMoney")}
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
                                <ActivityIndicator color={colors.accentOn} size="small" />
                              ) : (
                                <Text style={styles.regModalPrimaryBtnText}>{t("common.continue")}</Text>
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
                                ? t("register.otpDemoLead", { count: OTP_LEN })
                                : t("register.otpLead", { count: OTP_LEN })}
                            </Text>
                            <Text style={styles.regModalOtpHint}>
                              +237{" "}
                              {welcomePhone
                                ? formatCameroonPhoneDisplay(welcomePhone)
                                : "…"}
                            </Text>
                            <Text style={styles.regModalLabel}>{t("register.verificationCode")}</Text>
                            <TextInput
                              ref={regOtpInputRef}
                              style={styles.regModalOtpInput}
                              placeholder={t("common.otpPlaceholder")}
                              placeholderTextColor={colors.placeholder}
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
                                <ActivityIndicator color={colors.accentOn} size="small" />
                              ) : (
                                <Text style={styles.regModalPrimaryBtnText}>{t("common.validate")}</Text>
                              )}
                            </Pressable>
                            {otpSendCount >= MAX_OTP_SENDS_PER_SESSION ? (
                              <Text style={styles.regModalResendLimit}>
                                {t("register.resendLimit")}
                              </Text>
                            ) : otpResendCooldown > 0 ? (
                              <Text style={styles.regModalResendHint}>
                                {t("register.resendIn")}{" "}
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
                                  <ActivityIndicator color={colors.accent} size="small" />
                                ) : (
                                  <Text style={styles.regModalResendBtnText}>
                                    {t("register.resendCode")}
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
                                {t("register.editPhone")}
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
                              {t("register.pinChooseLead")}
                            </Text>
                            <Text style={styles.regModalLabel}>{t("register.newPin")}</Text>
                            <TextInput
                              ref={regPinInputRef}
                              style={styles.regModalOtpInput}
                              placeholder={t("common.pinPlaceholder")}
                              placeholderTextColor={colors.placeholder}
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
                              <Text style={styles.regModalPrimaryBtnText}>{t("common.continue")}</Text>
                            </Pressable>
                          </View>
                          <View
                            style={[
                              styles.regModalSlidePage,
                              { width: regSlidePanelW },
                            ]}
                          >
                            <Text style={styles.regModalLead}>
                              {t("register.pinConfirmLead")}
                            </Text>
                            <Text style={styles.regModalLabel}>{t("common.confirm")}</Text>
                            <TextInput
                              ref={regPinConfirmInputRef}
                              style={styles.regModalOtpInput}
                              placeholder={t("common.pinPlaceholder")}
                              placeholderTextColor={colors.placeholder}
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
                                <ActivityIndicator color={colors.accentOn} size="small" />
                              ) : (
                                <Text style={styles.regModalPrimaryBtnText}>
                                  {t("register.savePin")}
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
                              {t("register.profileLead")}
                            </Text>
                            <Text style={styles.regModalLabel}>{t("register.firstName")}</Text>
                            <TextInput
                              ref={regFirstNameInputRef}
                              style={styles.regModalProfileInput}
                              placeholder={t("register.firstNamePlaceholder")}
                              placeholderTextColor={colors.placeholder}
                              value={onboardingFirstName}
                              onChangeText={setOnboardingFirstName}
                              autoCapitalize="words"
                              autoCorrect={false}
                              maxLength={80}
                            />
                            <Text style={styles.regModalLabel}>{t("register.lastName")}</Text>
                            <TextInput
                              ref={regLastNameInputRef}
                              style={styles.regModalProfileInput}
                              placeholder={t("register.lastNamePlaceholder")}
                              placeholderTextColor={colors.placeholder}
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
                                <ActivityIndicator color={colors.accentOn} size="small" />
                              ) : (
                                <Text style={styles.regModalPrimaryBtnText}>
                                  {t("register.finish")}
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
