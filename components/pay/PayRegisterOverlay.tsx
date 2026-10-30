import { RegisterCancelConfirmModal } from "@/components/auth/RegisterCancelConfirmModal";
import { AndroidOtpSmsAutofill } from "@/components/AndroidOtpSmsAutofill";
import { PeerAvatar } from "@/components/peers/PeerAvatar";
import { MaskedPinInput } from "@/components/pay/MaskedPinInput";
import { createPayRegisterStyles } from "@/components/pay/payRegisterStyles";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import {
  ApiError,
  fetchHealth,
  setOnboardingProfile,
  setOnboardingTransactionPin,
  getMe,
} from "@/lib/api/client";
import { USE_MOCK_API } from "@/lib/config";
import {
  formatCameroonPhoneDisplay,
  formatCameroonPhoneSpacedPairs,
  cameroonPhoneSpacedPairsMaxLength,
  inferCameroonMobileMoneyBrand,
  normalizeCameroonPhoneDigits,
} from "@/lib/format";
import {
  formatRegistrationFullName,
  parseRegistrationFullName,
} from "@/lib/profile/parseRegistrationFullName";
import {
  ensureImageLibraryPermission,
  pickImagesFromLibrary,
  warmImageLibraryPermission,
} from "@/lib/image/pickFromLibrary";
import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { blypAlert } from "@/lib/ui/blypAlert";
import { ActivityIndicator, Animated, BackHandler, Dimensions, Image, InteractionManager, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, TextInput, useWindowDimensions, View } from "react-native";
import { SafeAreaView as SafeModalArea } from "react-native-safe-area-context";

/** Part de la hauteur d’écran pour la feuille (depuis le bas), aligné sur `app/deposit.tsx`. */
const REG_SHEET_HEIGHT_RATIO = 0.85;

/** Aligné sur le cooldown serveur (`/auth/request-otp`). */
const OTP_RESEND_COOLDOWN_SEC = 60;
/** Limite d’envois par ouverture du modal d’inscription. */
const MAX_OTP_SENDS_PER_SESSION = 8;

/** 4 chiffres tant que Meta WhatsApp off (1234) ; passer à 6 quand WHATSAPP_* est configuré. */
const OTP_LEN = 4;
const ONBOARDING_PIN_LEN = 4;

const REG_STEPS = [
  "phone",
  "otp",
  "profileName",
  "profilePhoto",
  "pin",
  "pinConfirm",
] as const;
type RegStep = (typeof REG_STEPS)[number];

export default function PayRegisterOverlay({
  onComplete,
  presentation = "sheet",
}: {
  onComplete: () => void;
  presentation?: "sheet" | "fullScreen";
}) {
  const isFullScreen = presentation === "fullScreen";
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => createPayRegisterStyles(colors), [colors]);
  const { user, token, requestOtp, verifyAndSignIn, refreshUser, cancelRegistration } =
    useAuth();
  const [welcomePhone, setWelcomePhone] = useState("");
  const [welcomeOtp, setWelcomeOtp] = useState("");
  const [welcomeStep, setWelcomeStep] = useState<RegStep>("phone");
  const [onboardingPin, setOnboardingPin] = useState("");
  const [onboardingPinConfirm, setOnboardingPinConfirm] = useState("");
  const [onboardingFullName, setOnboardingFullName] = useState("");
  const [onboardingAvatarUri, setOnboardingAvatarUri] = useState<string | null>(
    null,
  );
  const [onboardingAvatarPickerOpen, setOnboardingAvatarPickerOpen] =
    useState(false);
  const [authAvatarUploading, setAuthAvatarUploading] = useState(false);
  const [authOtpSending, setAuthOtpSending] = useState(false);
  const [authResendSending, setAuthResendSending] = useState(false);
  const [authVerifySending, setAuthVerifySending] = useState(false);
  const [authPinSaving, setAuthPinSaving] = useState(false);
  const [authProfileSaving, setAuthProfileSaving] = useState(false);
  const [cancelRegModalVisible, setCancelRegModalVisible] = useState(false);
  const [cancelRegBusy, setCancelRegBusy] = useState(false);
  const [otpResendCooldown, setOtpResendCooldown] = useState(0);
  const [otpSendCount, setOtpSendCount] = useState(0);
  const regPhoneInputRef = useRef<TextInput>(null);
  const regOtpInputRef = useRef<TextInput>(null);
  const regPinInputRef = useRef<TextInput>(null);
  const regPinConfirmInputRef = useRef<TextInput>(null);
  const regFullNameInputRef = useRef<TextInput>(null);
  const regFocusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const regFocusGenRef = useRef(0);
  /** Remount phone field → autoFocus fiable (MIUI / Modal Android). */
  const [regPhoneInputKey, setRegPhoneInputKey] = useState(0);
  const phoneAutoSubmittedRef = useRef<string | null>(null);
  const otpAutoSubmittedRef = useRef<string | null>(null);
  const otpVerifyInFlightRef = useRef(false);
  /** `request-otp` a bien écrit le challenge — sans ça, 1234 est rejeté trop tôt. */
  const otpChallengeReadyRef = useRef(false);
  const otpRequestReadyRef = useRef<Promise<boolean>>(Promise.resolve(false));
  const otpRequestResolveRef = useRef<(ok: boolean) => void>(() => {});
  const pinFirstAutoSubmittedRef = useRef<string | null>(null);
  const pinConfirmAutoSubmittedRef = useRef<string | null>(null);
  const pinConfirmVerifyInFlightRef = useRef(false);
  const railwayOtpHashAlertShownRef = useRef(false);
  /** Évite de réécraser prénom/nom locaux à chaque refresh `user`. */
  const onboardingHydratedKeyRef = useRef<string | null>(null);
  const regSlideX = useRef(new Animated.Value(0)).current;
  const regScrollRef = useRef<ScrollView>(null);
  const [regSlideWidth, setRegSlideWidth] = useState(0);
  /** RN Modal Android n’applique pas adjustResize → on soulève la feuille. */
  const [keyboardLift, setKeyboardLift] = useState(0);
  /** Plein écran welcome : hauteur figée pour que le clavier (resize Android) ne recalcule pas le centre. */
  const fullScreenLayoutHeightRef = useRef(0);
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  if (isFullScreen && fullScreenLayoutHeightRef.current === 0 && windowHeight > 0) {
    fullScreenLayoutHeightRef.current = Math.max(
      windowHeight,
      Dimensions.get("window").height,
    );
  }
  const fullScreenScrollMinHeight = isFullScreen
    ? fullScreenLayoutHeightRef.current || windowHeight
    : 0;
  const regSlidePanelW =
    regSlideWidth > 0 ? regSlideWidth : Math.max(280, windowWidth - 72);
  const regSheetHeight = windowHeight * REG_SHEET_HEIGHT_RATIO;

  const scrollRegSheetToFooter = useCallback((animated = true) => {
    const run = () => regScrollRef.current?.scrollToEnd({ animated });
    requestAnimationFrame(run);
    setTimeout(run, 80);
    setTimeout(run, 220);
  }, []);

  useEffect(() => {
    if (isFullScreen) return;
    const showEvt =
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvt =
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const onShow = Keyboard.addListener(showEvt, (e) => {
      const h = e.endCoordinates?.height ?? 0;
      setKeyboardLift(h);
      scrollRegSheetToFooter(true);
    });
    const onHide = Keyboard.addListener(hideEvt, () => setKeyboardLift(0));
    return () => {
      onShow.remove();
      onHide.remove();
    };
  }, [isFullScreen, scrollRegSheetToFooter]);

  const phoneWalletBrand = inferCameroonMobileMoneyBrand(welcomePhone);

  useEffect(() => {
    if (!user?.needsOnboarding) {
      onboardingHydratedKeyRef.current = null;
      setWelcomeStep("phone");
      setWelcomeOtp("");
      setWelcomePhone("");
      setOtpResendCooldown(0);
      setOtpSendCount(0);
      setOnboardingPin("");
      setOnboardingPinConfirm("");
      setOnboardingFullName("");
      setOnboardingAvatarUri(null);
      return;
    }

    const hydrateKey = [
      user.personalAccountId ?? user.id ?? "",
      user.phone,
      user.onboardingStep ?? "",
    ].join("|");
    if (onboardingHydratedKeyRef.current === hydrateKey) return;
    onboardingHydratedKeyRef.current = hydrateKey;

    const nine = user.phone.replace(/\D/g, "").slice(-9);
    setWelcomePhone(nine);
    setOnboardingFullName((prev) => {
      const fromServer = formatRegistrationFullName(
        user.firstName,
        user.lastName,
      );
      return fromServer.length > 0 ? fromServer : prev;
    });

    if (user.onboardingStep === "profile") {
      const fn = user.firstName?.trim() ?? "";
      const ln = user.lastName?.trim() ?? "";
      if (fn.length >= 1 && ln.length >= 1) {
        setWelcomeStep("profilePhoto");
      } else {
        setWelcomeStep("profileName");
      }
    } else {
      setWelcomeStep("pin");
    }
  }, [user]);

  const advanceAfterOnboardingStep = useCallback(async () => {
    if (!token) return;
    const me = await getMe(token);
    if (!me.needsOnboarding) {
      onComplete();
      return;
    }
    if (me.onboardingStep === "profile") {
      const fn = me.firstName?.trim() ?? "";
      const ln = me.lastName?.trim() ?? "";
      if (fn.length >= 1 && ln.length >= 1) {
        setWelcomeStep("profilePhoto");
      } else {
        setWelcomeStep("profileName");
      }
      return;
    }
    setWelcomeStep("pin");
  }, [token, onComplete]);

  const pickOnboardingAvatar = useCallback(async () => {
    if (
      !token ||
      authAvatarUploading ||
      authProfileSaving ||
      onboardingAvatarPickerOpen
    ) {
      return;
    }
    setOnboardingAvatarPickerOpen(true);
    try {
      const granted = await ensureImageLibraryPermission();
      if (!granted) return;
      const assets = await pickImagesFromLibrary();
      const asset = assets?.[0];
      if (!asset?.uri) return;
      setOnboardingAvatarUri(asset.uri);
    } catch (e) {
      if (__DEV__) {
        console.warn("[Blyp register] avatar pick failed", e);
      }
      blypAlert(t("register.profileTitle"), t("register.photoPickFailed"));
    } finally {
      setOnboardingAvatarPickerOpen(false);
    }
  }, [
    token,
    authAvatarUploading,
    authProfileSaving,
    onboardingAvatarPickerOpen,
    t,
  ]);

  useEffect(() => {
    if (welcomeStep !== "profilePhoto") return;
    void warmImageLibraryPermission();
  }, [welcomeStep]);

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

  useEffect(() => {
    if (!isFullScreen) return;
    regScrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [isFullScreen, welcomeStep]);

  const requestOtpForRegistration = async (
    mode: "initial" | "resend",
    phoneOverride?: string,
  ) => {
    const phone = phoneOverride ?? welcomePhone;
    if (phone.length !== 9) return;
    if (otpSendCount >= MAX_OTP_SENDS_PER_SESSION) {
      blypAlert(
        t("register.sendLimitTitle"),
        t("register.sendLimitMessage"),
      );
      return;
    }
    if (mode === "resend" && otpResendCooldown > 0) return;
    if (mode === "initial" && authOtpSending) return;
    const setBusy = mode === "initial" ? setAuthOtpSending : setAuthResendSending;
    setBusy(true);
    /** Instantané : passer à l’écran code sans attendre Obit/réseau. */
    if (mode === "initial") {
      otpChallengeReadyRef.current = false;
      otpRequestReadyRef.current = new Promise<boolean>((resolve) => {
        otpRequestResolveRef.current = resolve;
      });
      setWelcomePhone(phone);
      setWelcomeStep("otp");
      setWelcomeOtp("");
      otpAutoSubmittedRef.current = null;
    }
    try {
      await requestOtp(phone);
      otpChallengeReadyRef.current = true;
      if (mode === "initial") otpRequestResolveRef.current(true);
      setOtpSendCount((c) => c + 1);
      setOtpResendCooldown(OTP_RESEND_COOLDOWN_SEC);
    } catch (e) {
      otpChallengeReadyRef.current = false;
      if (mode === "initial") otpRequestResolveRef.current(false);
      const msg =
        e instanceof ApiError ? e.message : t("common.sendCodeFailed");
      if (e instanceof ApiError && e.retryAfterSeconds != null) {
        setOtpResendCooldown(e.retryAfterSeconds);
      }
      blypAlert(t("register.smsCodeTitle"), msg);
      if (mode === "initial") {
        phoneAutoSubmittedRef.current = null;
        setWelcomeStep("phone");
      }
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
      if (!otpChallengeReadyRef.current) {
        const ready = await otpRequestReadyRef.current;
        if (!ready) return;
      }
      const u = await verifyAndSignIn(welcomePhone, welcomeOtp);
      setWelcomeOtp("");
      if (!u.needsOnboarding) {
        onComplete();
      } else {
        setWelcomeStep(u.onboardingStep === "profile" ? "profileName" : "pin");
        setOnboardingPin("");
        setOnboardingPinConfirm("");
      }
    } catch (e) {
      blypAlert(
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
    if (isFullScreen) return;
    Keyboard.dismiss();
    onComplete();
  }, [onComplete, isFullScreen]);

  const goBackToRegistrationPhone = useCallback(() => {
    Keyboard.dismiss();
    phoneAutoSubmittedRef.current = null;
    setWelcomeStep("phone");
    setOtpResendCooldown(0);
  }, []);

  const registrationAbortable = Boolean(token && user?.needsOnboarding);

  const resetRegistrationToPhone = useCallback(() => {
    phoneAutoSubmittedRef.current = null;
    setWelcomeStep("phone");
    setWelcomeOtp("");
    setWelcomePhone("");
    setOtpResendCooldown(0);
    setOtpSendCount(0);
    setOnboardingPin("");
    setOnboardingPinConfirm("");
    setOnboardingFullName("");
    setOnboardingAvatarUri(null);
    otpAutoSubmittedRef.current = null;
    otpChallengeReadyRef.current = false;
  }, []);

  const promptCancelRegistration = useCallback(() => {
    setCancelRegModalVisible(true);
  }, []);

  const confirmCancelRegistration = useCallback(async () => {
    setCancelRegBusy(true);
    try {
      await cancelRegistration();
      resetRegistrationToPhone();
      setCancelRegModalVisible(false);
      if (!isFullScreen) {
        onComplete();
      }
    } catch (e) {
      blypAlert(
        t("register.cancelRegistrationTitle"),
        e instanceof ApiError ? e.message : t("common.genericError"),
      );
    } finally {
      setCancelRegBusy(false);
    }
  }, [
    cancelRegistration,
    resetRegistrationToPhone,
    isFullScreen,
    onComplete,
    t,
  ]);

  const goBackInRegistrationHeader = useCallback(() => {
    if (registrationAbortable) {
      promptCancelRegistration();
      return;
    }
    Keyboard.dismiss();
    if (welcomeStep === "otp") {
      goBackToRegistrationPhone();
      return;
    }
    if (welcomeStep === "profileName") {
      goBackToRegistrationPhone();
      return;
    }
    if (welcomeStep === "profilePhoto") {
      setWelcomeStep("profileName");
      return;
    }
    if (welcomeStep === "pin") {
      setWelcomeStep("profilePhoto");
      setOnboardingPin("");
      return;
    }
    if (welcomeStep === "pinConfirm") {
      setWelcomeStep("pin");
      setOnboardingPinConfirm("");
    }
  }, [
    welcomeStep,
    goBackToRegistrationPhone,
    registrationAbortable,
    promptCancelRegistration,
  ]);

  const handleRegistrationHardwareBack = useCallback((): boolean => {
    if (welcomeStep === "phone") return false;
    if (registrationAbortable) {
      promptCancelRegistration();
      return true;
    }
    if (welcomeStep === "otp") {
      goBackToRegistrationPhone();
      return true;
    }
    goBackInRegistrationHeader();
    return true;
  }, [
    welcomeStep,
    registrationAbortable,
    promptCancelRegistration,
    goBackToRegistrationPhone,
    goBackInRegistrationHeader,
  ]);

  useEffect(() => {
    const sub = BackHandler.addEventListener(
      "hardwareBackPress",
      handleRegistrationHardwareBack,
    );
    return () => sub.remove();
  }, [handleRegistrationHardwareBack]);

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
      blypAlert(t("register.pinTitle"), t("register.pinMismatch"));
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
      const { saveTransactionPinVault } = await import(
        "@/lib/security/transactionPinVault"
      );
      await saveTransactionPinVault(b);
      await refreshUser();
      setOnboardingPin("");
      setOnboardingPinConfirm("");
      pinConfirmAutoSubmittedRef.current = null;
      await advanceAfterOnboardingStep();
    } catch (e) {
      blypAlert(
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
    advanceAfterOnboardingStep,
  ]);

  const submitOnboardingProfile = useCallback(async () => {
    const parsed = parseRegistrationFullName(onboardingFullName);
    if (!parsed) {
      blypAlert(t("register.profileTitle"), t("register.fullNameInvalid"));
      return;
    }
    const { firstName: f, lastName: l } = parsed;
    if (!token) return;
    Keyboard.dismiss();
    setAuthProfileSaving(true);
    try {
      await setOnboardingProfile(token, f, l);
      if (onboardingAvatarUri) {
        setAuthAvatarUploading(true);
        try {
          const { uploadProfileAvatar } = await import(
            "@/lib/avatar/uploadProfileAvatar"
          );
          await uploadProfileAvatar(token, onboardingAvatarUri);
        } finally {
          setAuthAvatarUploading(false);
        }
      }
      await refreshUser();
      setOnboardingAvatarUri(null);
      await advanceAfterOnboardingStep();
    } catch (e) {
      blypAlert(
        t("register.profileTitle"),
        e instanceof ApiError
          ? e.message
          : onboardingAvatarUri
            ? t("profile.photoUploadFailed")
            : t("common.saveFailed"),
      );
    } finally {
      setAuthProfileSaving(false);
    }
  }, [
    onboardingFullName,
    onboardingAvatarUri,
    token,
    refreshUser,
    advanceAfterOnboardingStep,
    t,
  ]);

  const continueProfileName = useCallback(() => {
    const parsed = parseRegistrationFullName(onboardingFullName);
    if (!parsed) {
      blypAlert(t("register.profileTitle"), t("register.fullNameInvalid"));
      return;
    }
    Keyboard.dismiss();
    setWelcomeStep("profilePhoto");
  }, [onboardingFullName, t]);

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

  const focusRefForStep = useCallback((step: RegStep) => {
    if (step === "phone") return regPhoneInputRef.current;
    if (step === "otp") return regOtpInputRef.current;
    if (step === "pin") return regPinInputRef.current;
    if (step === "pinConfirm") return regPinConfirmInputRef.current;
    if (step === "profileName") return regFullNameInputRef.current;
    return null;
  }, []);

  /** Clavier dès l’ouverture — retries Android (Redmi / Modal). */
  const scheduleRegFieldFocus = useCallback(
    (step: RegStep) => {
      const gen = ++regFocusGenRef.current;
      if (regFocusTimerRef.current) {
        clearTimeout(regFocusTimerRef.current);
        regFocusTimerRef.current = null;
      }

      const tryFocus = (attempt: number) => {
        if (gen !== regFocusGenRef.current) return;
        const input = focusRefForStep(step);
        if (!input) {
          if (attempt < 24) {
            regFocusTimerRef.current = setTimeout(
              () => tryFocus(attempt + 1),
              40,
            );
          }
          return;
        }
        input.focus();
        if (Platform.OS === "android" && attempt < 8) {
          regFocusTimerRef.current = setTimeout(
            () => tryFocus(attempt + 1),
            80,
          );
        } else {
          regFocusTimerRef.current = null;
        }
      };

      regFocusTimerRef.current = setTimeout(() => {
        InteractionManager.runAfterInteractions(() => {
          requestAnimationFrame(() => tryFocus(0));
        });
      }, Platform.OS === "android" ? 80 : 16);
    },
    [focusRefForStep],
  );

  const resumeRegistrationAfterCancelDismiss = useCallback(() => {
    if (cancelRegBusy) return;
    setCancelRegModalVisible(false);
    scheduleRegFieldFocus(welcomeStep);
  }, [cancelRegBusy, welcomeStep, scheduleRegFieldFocus]);

  useEffect(() => {
    if (welcomeStep === "phone") {
      setRegPhoneInputKey((k) => k + 1);
    }
    scheduleRegFieldFocus(welcomeStep);
    return () => {
      if (regFocusTimerRef.current) {
        clearTimeout(regFocusTimerRef.current);
        regFocusTimerRef.current = null;
      }
    };
  }, [welcomeStep, scheduleRegFieldFocus]);

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

  const RegKeyboardWrapper = isFullScreen ? View : KeyboardAvoidingView;

  const fullScreenStepVerticallyCentered =
    welcomeStep === "phone" || welcomeStep === "profileName";

  const registrationBody = (
    <View
      style={
        isFullScreen ? styles.regFullScreenRoot : styles.regModalRoot
      }
    >
      {!isFullScreen ? (
        <Pressable
          style={styles.regModalBackdrop}
          onPress={() => {
            if (welcomeStep === "phone" || welcomeStep === "otp") {
              closeRegistrationOverlay();
            } else {
              Keyboard.dismiss();
            }
          }}
          accessibilityLabel={
            welcomeStep === "phone" || welcomeStep === "otp"
              ? t("common.close")
              : t("common.background")
          }
          accessibilityRole="button"
        />
      ) : null}
      <View
        style={
          isFullScreen
            ? styles.regFullScreenSheet
            : [
                styles.regModalSheet,
                {
                  bottom: keyboardLift,
                  maxHeight: Math.max(
                    280,
                    windowHeight - keyboardLift - 12,
                  ),
                  height: Math.min(
                    regSheetHeight,
                    Math.max(280, windowHeight - keyboardLift - 12),
                  ),
                },
              ]
        }
      >
                <RegKeyboardWrapper
                  style={styles.regModalKeyboard}
                  {...(!isFullScreen
                    ? {
                        behavior:
                          Platform.OS === "ios" ? ("padding" as const) : undefined,
                        enabled: Platform.OS === "ios" && keyboardLift === 0,
                      }
                    : {})}
                >
                  <SafeModalArea
                    style={styles.regModalSafe}
                    edges={
                      !isFullScreen && keyboardLift > 0
                        ? ["left", "right"]
                        : isFullScreen
                          ? ["top", "left", "right", "bottom"]
                          : ["bottom", "left", "right"]
                    }
                  >
                    {!(isFullScreen && welcomeStep === "phone") ? (
                    <View style={styles.regModalHeader}>
                      {welcomeStep === "phone" ? (
                        isFullScreen ? (
                          <View style={styles.regModalHeaderLeading} />
                        ) : (
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
                        )
                      ) : welcomeStep === "otp" ||
                        welcomeStep === "profileName" ||
                        welcomeStep === "profilePhoto" ||
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
                    ) : null}

                    <ScrollView
                      ref={regScrollRef}
                      style={styles.regModalScrollView}
                      contentContainerStyle={[
                        styles.regModalScroll,
                        isFullScreen &&
                          welcomeStep === "phone" && {
                            minHeight: fullScreenScrollMinHeight,
                          },
                        isFullScreen &&
                          fullScreenStepVerticallyCentered &&
                          styles.regModalScrollCentered,
                        isFullScreen &&
                          !fullScreenStepVerticallyCentered &&
                          styles.regModalScrollBelowHeader,
                        !isFullScreen &&
                          keyboardLift > 0 &&
                          styles.regModalScrollKeyboardPad,
                      ]}
                      keyboardShouldPersistTaps="handled"
                      showsVerticalScrollIndicator={false}
                      keyboardDismissMode="interactive"
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
                            {!isFullScreen ? (
                              <Text style={styles.regModalLead}>
                                {t("register.smsVerifyLead")}
                              </Text>
                            ) : null}
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
                                key={`reg-phone-${regPhoneInputKey}`}
                                ref={regPhoneInputRef}
                                style={styles.regModalPhoneInput}
                                placeholder={t("register.phonePlaceholder")}
                                placeholderTextColor={colors.placeholder}
                                keyboardType="number-pad"
                                maxLength={cameroonPhoneSpacedPairsMaxLength(9)}
                                value={formatCameroonPhoneSpacedPairs(welcomePhone)}
                                editable={!authOtpSending}
                                autoFocus={welcomeStep === "phone"}
                                showSoftInputOnFocus
                                onChangeText={(text) => {
                                  const next = normalizeCameroonPhoneDigits(text);
                                  setWelcomePhone(next);
                                  if (next.length < 9) {
                                    phoneAutoSubmittedRef.current = null;
                                  }
                                }}
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
                                styles.regModalPhoneContinueBtn,
                                (welcomePhone.length !== 9 ||
                                  authOtpSending ||
                                  otpSendCount >= MAX_OTP_SENDS_PER_SESSION) &&
                                  styles.regModalPrimaryBtnDisabled,
                                pressed &&
                                  welcomePhone.length === 9 &&
                                  !authOtpSending &&
                                  styles.regModalPrimaryBtnPressed,
                              ]}
                              disabled={
                                welcomePhone.length !== 9 ||
                                authOtpSending ||
                                otpSendCount >= MAX_OTP_SENDS_PER_SESSION
                              }
                              accessibilityRole="button"
                              accessibilityLabel={t("common.continue")}
                              onPress={() => {
                                const nine = welcomePhone;
                                if (
                                  nine.length !== 9 ||
                                  phoneAutoSubmittedRef.current === nine ||
                                  otpSendCount >= MAX_OTP_SENDS_PER_SESSION
                                ) {
                                  return;
                                }
                                phoneAutoSubmittedRef.current = nine;
                                Keyboard.dismiss();
                                void requestOtpForRegistration("initial", nine);
                              }}
                            >
                              {authOtpSending ? (
                                <ActivityIndicator
                                  color={colors.accentOn}
                                  size="small"
                                />
                              ) : (
                                <Text style={styles.regModalPrimaryBtnText}>
                                  {t("common.continue")}
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
                            <MaskedPinInput
                              ref={regOtpInputRef}
                              variant="lines"
                              style={styles.regModalOtpInput}
                              accessibilityLabel={t("register.verificationCode")}
                              digits={welcomeOtp}
                              maxLength={OTP_LEN}
                              onDigitsChange={setWelcomeOtp}
                              textContentType="oneTimeCode"
                              autoComplete={
                                Platform.OS === "android" ? "sms-otp" : "one-time-code"
                              }
                              {...(Platform.OS === "android"
                                ? { importantForAutofill: "yes" as const }
                                : {})}
                              showSoftInputOnFocus
                              onFocus={() => {
                                scrollRegSheetToFooter(true);
                              }}
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
                                  <ActivityIndicator
                                    color={colors.textMuted}
                                    size="small"
                                  />
                                ) : (
                                  <Text style={styles.regModalResendBtnText}>
                                    {t("register.resendCode")}
                                  </Text>
                                )}
                              </Pressable>
                            )}
                            <View style={styles.regModalOtpFooterSpacer} />
                          </View>
                          <View
                            style={[
                              styles.regModalSlidePage,
                              { width: regSlidePanelW },
                            ]}
                          >
                            <Text
                              style={[
                                styles.regModalLabel,
                                styles.regModalLabelInputAlign,
                              ]}
                            >
                              {t("register.fullName")}
                            </Text>
                            <TextInput
                              ref={regFullNameInputRef}
                              style={styles.regModalProfileInput}
                              placeholder={t("register.fullNamePlaceholder")}
                              placeholderTextColor={colors.placeholder}
                              value={onboardingFullName}
                              onChangeText={setOnboardingFullName}
                              autoCapitalize="words"
                              autoCorrect={false}
                              maxLength={80}
                              autoFocus={welcomeStep === "profileName"}
                            />
                            <Pressable
                              style={({ pressed }) => [
                                styles.regModalPrimaryBtn,
                                pressed &&
                                  onboardingFullName.trim().length >= 1 &&
                                  styles.regModalPrimaryBtnPressed,
                                onboardingFullName.trim().length < 1 &&
                                  styles.regModalPrimaryBtnDisabled,
                              ]}
                              disabled={onboardingFullName.trim().length < 1}
                              onPress={continueProfileName}
                            >
                              <Text style={styles.regModalPrimaryBtnText}>
                                {t("common.continue")}
                              </Text>
                            </Pressable>
                          </View>
                          <View
                            style={[
                              styles.regModalSlidePage,
                              { width: regSlidePanelW },
                            ]}
                          >
                            <Text
                              style={[
                                styles.regModalLead,
                                styles.regModalLeadCentered,
                              ]}
                            >
                              {t("register.profilePhotoLead")}
                            </Text>
                            <Pressable
                              style={({ pressed }) => [
                                styles.regModalAvatarTap,
                                pressed && styles.regModalAvatarTapPressed,
                              ]}
                              onPress={() => void pickOnboardingAvatar()}
                              disabled={
                                authProfileSaving ||
                                authAvatarUploading ||
                                onboardingAvatarPickerOpen
                              }
                              accessibilityRole="button"
                              accessibilityLabel={t("register.addPhoto")}
                            >
                              {({ pressed }) => {
                                const ringActive =
                                  pressed ||
                                  onboardingAvatarPickerOpen ||
                                  Boolean(onboardingAvatarUri);
                                return (
                                  <>
                                    <View style={styles.regModalAvatarRingWrap}>
                                      <View
                                        style={[
                                          styles.regModalAvatarRing,
                                          ringActive && {
                                            borderColor: colors.accent,
                                          },
                                        ]}
                                      >
                                        <PeerAvatar
                                          name={
                                            onboardingFullName.trim() ||
                                            formatRegistrationFullName(
                                              user?.firstName,
                                              user?.lastName,
                                            ) ||
                                            "?"
                                          }
                                          localUri={onboardingAvatarUri}
                                          remoteUrl={user?.avatarUrl}
                                          size={96}
                                          style={styles.regModalAvatar}
                                          textStyle={
                                            styles.regModalAvatarInitials
                                          }
                                        />
                                      </View>
                                      {onboardingAvatarPickerOpen ? (
                                        <View
                                          style={[
                                            styles.regModalAvatarSpinnerOverlay,
                                            { backgroundColor: colors.overlay },
                                          ]}
                                        >
                                          <ActivityIndicator
                                            color={colors.accent}
                                            size="small"
                                          />
                                        </View>
                                      ) : null}
                                    </View>
                                    <View
                                      style={[
                                        styles.regModalAvatarBadge,
                                        { backgroundColor: colors.modal },
                                      ]}
                                    >
                                      <Ionicons
                                        name="camera"
                                        size={17}
                                        color={colors.textMuted}
                                      />
                                    </View>
                                  </>
                                );
                              }}
                            </Pressable>
                            <Pressable
                              style={({ pressed }) => [
                                styles.regModalSkipPhotoBtn,
                                pressed &&
                                  !authProfileSaving &&
                                  !authAvatarUploading &&
                                  styles.regModalSkipPhotoBtnPressed,
                              ]}
                              disabled={authProfileSaving || authAvatarUploading}
                              onPress={() => void submitOnboardingProfile()}
                              accessibilityRole="button"
                              accessibilityLabel={t("register.skipPhotoForNow")}
                            >
                              <Text style={styles.regModalSkipPhotoBtnText}>
                                {t("register.skipPhotoForNow")}
                              </Text>
                            </Pressable>
                            <Pressable
                              style={({ pressed }) => [
                                styles.regModalPrimaryBtn,
                                pressed &&
                                  !authProfileSaving &&
                                  !authAvatarUploading &&
                                  styles.regModalPrimaryBtnPressed,
                                (authProfileSaving || authAvatarUploading) &&
                                  styles.regModalPrimaryBtnDisabled,
                              ]}
                              disabled={authProfileSaving || authAvatarUploading}
                              onPress={() => void submitOnboardingProfile()}
                            >
                              {authProfileSaving || authAvatarUploading ? (
                                <ActivityIndicator
                                  color={colors.accentOn}
                                  size="small"
                                />
                              ) : (
                                <Text style={styles.regModalPrimaryBtnText}>
                                  {t("common.continue")}
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
                              {t("register.pinChooseLead")}
                            </Text>
                            <Text style={styles.regModalLabel}>{t("register.newPin")}</Text>
                            <MaskedPinInput
                              ref={regPinInputRef}
                              variant="circles"
                              style={styles.regModalOtpInput}
                              accessibilityLabel={t("register.newPin")}
                              digits={onboardingPin}
                              maxLength={ONBOARDING_PIN_LEN}
                              onDigitsChange={setOnboardingPin}
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
                            <MaskedPinInput
                              ref={regPinConfirmInputRef}
                              variant="circles"
                              style={styles.regModalOtpInput}
                              accessibilityLabel={t("common.confirm")}
                              digits={onboardingPinConfirm}
                              maxLength={ONBOARDING_PIN_LEN}
                              onDigitsChange={setOnboardingPinConfirm}
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
                        </Animated.View>
                      </View>
                    </ScrollView>
                  </SafeModalArea>
                </RegKeyboardWrapper>
              </View>
    </View>
  );

  useEffect(() => {
    if (!isFullScreen) return;
    if (welcomeStep === "phone") {
      setRegPhoneInputKey((k) => k + 1);
    }
    scheduleRegFieldFocus(welcomeStep);
  }, [isFullScreen, welcomeStep, scheduleRegFieldFocus]);

  return (
    <>
      {isFullScreen ? (
        registrationBody
      ) : (
        <Modal
          visible
          transparent
          animationType="none"
          statusBarTranslucent
          onShow={() => {
            if (welcomeStep === "phone") {
              setRegPhoneInputKey((k) => k + 1);
            }
            scheduleRegFieldFocus(welcomeStep);
          }}
          onRequestClose={() => {
            if (welcomeStep === "phone" || welcomeStep === "otp") {
              if (registrationAbortable) {
                promptCancelRegistration();
                return;
              }
              closeRegistrationOverlay();
              return;
            }
            handleRegistrationHardwareBack();
          }}
        >
          {registrationBody}
        </Modal>
      )}
      <AndroidOtpSmsAutofill
        applyOtp={welcomeStep === "otp"}
        otpLength={OTP_LEN}
        onCode={applySmsAutofillOtp}
      />
      <RegisterCancelConfirmModal
        visible={cancelRegModalVisible}
        busy={cancelRegBusy}
        onContinue={resumeRegistrationAfterCancelDismiss}
        onConfirmCancel={() => void confirmCancelRegistration()}
      />
    </>
  );
}
