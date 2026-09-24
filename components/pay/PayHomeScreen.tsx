import "@/lib/perf/eagerRoutes";
import { DepositOpenChrome } from "@/components/deposit/DepositOpenChrome";
import { useAuth } from "@/contexts/authContextBase";
import { useTheme } from "@/contexts/ThemeContext";
import { useNearbyTaxi } from "@/hooks/useNearbyTaxi";
import { ApiError, isTransactionPinInvalidError } from "@/lib/api/errors";
import {
  initiateWalletDeposit,
  newDepositIdempotencyKey,
  waitDepositCompleted,
} from "@/lib/deposit/runDeposit";
import { takePendingDepositWatch } from "@/lib/deposit/pendingWatch";
import { takeTopUpSuccessFlash } from "@/lib/deposit/successFlash";
import { formatCameroonPhoneDisplay } from "@/lib/format";
import { formatFcfa } from "@/lib/formatFcfa";
import { openDepositRoute } from "@/lib/nav/openDeposit";
import { runAggressiveWarm } from "@/lib/perf/aggressiveWarm";
import { perfMarkEnd, perfMarkStart } from "@/lib/perf/marks";
import { useMarkRootShellReady } from "@/lib/rootShellReady";
import { fallbackTxReference } from "@/lib/txReference";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
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
  BackHandler,
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

import { MaskedPinInput } from "@/components/pay/MaskedPinInput";
import { PayAmountEntry } from "@/components/pay/PayAmountEntry";
import { CheckGlyph } from "@/components/pay/PayGlyphs";
import {
  PayOutcomeSheet,
  type PayOutcomeSheetData,
} from "@/components/pay/PayOutcomeSheet";
import { createPayHomeStyles } from "@/components/pay/payHomeStyles";
import { PayRegisterOverlayFallback } from "@/components/pay/PayRegisterOverlayFallback";
import { Trans, useTranslation } from "react-i18next";
import { SafeAreaView } from "react-native-safe-area-context";

/** Même cible que `lazy` : le préchargement remplit le cache avant le 1er « Connexion rapide ». */
const importPayRegisterOverlay = () => import("./PayRegisterOverlay");
const PayRegisterOverlay = lazy(importPayRegisterOverlay);

const ONBOARDING_PIN_LEN = 4;

/** Limite côté app (l’API doit appliquer sa propre politique). */
const PAY_PIN_MAX_ATTEMPTS = 5;
/** Blocage temporaire après épuisement des tentatives (ms). */
const PAY_PIN_LOCKOUT_MS = 2 * 60 * 1000;

/** Micro-fenêtre « Recherche… » avant l’état calme (scan BLE continue). */
const BLE_SEARCH_PULSE_MS = 1400;

/**
 * Si true : ouverture auto du sheet inscription (compte manquant / onboarding).
 * Sans le bouton « Créer un compte », passe à true si tu n’as pas d’autre entrée vers l’inscription.
 */
const AUTO_OPEN_REGISTER_SHEET_ON_LAUNCH = false;

type PayRecipient = {
  accountId: string | null;
  name: string;
  phoneDigits: string;
};

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
  /** Montant pad Pay — pour recharge + sans passer par le modal dépôt. */
  const [payAmountFcfa, setPayAmountFcfa] = useState<number | null>(null);
  const [topUpPhase, setTopUpPhase] = useState<
    "idle" | "loading" | "awaiting" | "success"
  >("idle");
  const [topUpSuccessMessage, setTopUpSuccessMessage] = useState<string | null>(
    null,
  );
  const topUpIdempotencyRef = useRef<string | null>(null);
  const topUpBannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const topUpPollAbortRef = useRef<AbortController | null>(null);
  const openDepositInstant = useCallback(() => {
    setDepositChrome(true);
    openDepositRoute();
  }, []);
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => createPayHomeStyles(colors), [colors]);
  const { user, token, isLoading: authLoading, refreshUser, updateBalance } =
    useAuth();
  const {
    peer: nearbyPeer,
    status: bleStatus,
    broadcasting: bleBroadcasting,
    refreshing: bleRefreshing,
    refresh: refreshNearbyTaxi,
    resyncOnFocus: resyncNearbyTaxiOnFocus,
  } = useNearbyTaxi(true);
  const recipient = useMemo<PayRecipient | null>(() => {
    if (!nearbyPeer) return null;
    /** Ne pas se détecter soi-même. */
    if (user?.id && nearbyPeer.accountId === user.id) return null;
    return {
      accountId: nearbyPeer.accountId,
      name: nearbyPeer.displayName,
      phoneDigits: nearbyPeer.phoneDigits,
    };
  }, [nearbyPeer, user?.id]);
  const recipientRef = useRef(recipient);
  recipientRef.current = recipient;

  /**
   * Soft UX BLE : micro-pulse « Recherche… » à l’ouverture / refresh,
   * puis état calme « Aucun à proximité » sans spinner — le scan continue.
   */
  const [bleSearchPulse, setBleSearchPulse] = useState(true);
  const blePulseGenRef = useRef(0);

  const bleHardBlock =
    bleBroadcasting ||
    bleStatus === "denied" ||
    bleStatus === "powered_off" ||
    bleStatus === "unavailable";

  const armBleSearchPulse = useCallback(() => {
    const gen = ++blePulseGenRef.current;
    setBleSearchPulse(true);
    const id = setTimeout(() => {
      if (blePulseGenRef.current === gen) setBleSearchPulse(false);
    }, BLE_SEARCH_PULSE_MS);
    return () => {
      clearTimeout(id);
    };
  }, []);

  useEffect(() => {
    if (recipient || bleHardBlock) {
      blePulseGenRef.current += 1;
      setBleSearchPulse(false);
      return;
    }
    return armBleSearchPulse();
  }, [recipient, bleHardBlock, armBleSearchPulse]);

  useEffect(() => {
    if (!bleRefreshing || recipient || bleHardBlock) return;
    return armBleSearchPulse();
  }, [bleRefreshing, recipient, bleHardBlock, armBleSearchPulse]);

  const bleShowSearchChrome =
    !recipient && !bleHardBlock && (bleSearchPulse || bleRefreshing);

  const bleHeaderTitle = recipient
    ? recipient.name
    : bleBroadcasting
      ? t("ble.broadcastingShort")
      : bleStatus === "denied"
        ? t("ble.permissionDeniedShort")
        : bleStatus === "powered_off"
          ? t("ble.bluetoothOffShort")
          : bleStatus === "unavailable"
            ? t("ble.nativeUnavailableShort")
            : bleShowSearchChrome
              ? t("ble.searchingTaxi")
              : t("ble.noneNearby");
  const bleHeaderSubtitle = recipient
    ? formatCameroonPhoneDisplay(recipient.phoneDigits)
    : bleBroadcasting
      ? t("ble.broadcastingHint")
      : bleStatus === "denied" ||
          bleStatus === "powered_off" ||
          bleStatus === "unavailable"
        ? t("ble.noTaxiHint")
        : bleShowSearchChrome
          ? bleRefreshing
            ? t("ble.refreshingHint")
            : t("ble.searchingHint")
          : t("ble.noneNearbyHint");
  const onRefreshNearbyTaxi = useCallback(() => {
    if (bleBroadcasting) return;
    const started = refreshNearbyTaxi();
    if (!started) return;
    void import("expo-haptics")
      .then((H) => H.impactAsync(H.ImpactFeedbackStyle.Light))
      .catch(() => {});
  }, [bleBroadcasting, refreshNearbyTaxi]);
  const showTopUpSuccessBanner = useCallback(
    (amountFcfa: number) => {
      if (topUpBannerTimerRef.current) {
        clearTimeout(topUpBannerTimerRef.current);
      }
      setTopUpSuccessMessage(
        t("deposit.successBanner", { amount: formatFcfa(amountFcfa) }),
      );
      topUpBannerTimerRef.current = setTimeout(() => {
        setTopUpSuccessMessage(null);
        topUpBannerTimerRef.current = null;
      }, 2800);
    },
    [t],
  );
  useFocusEffect(
    useCallback(() => {
      setDepositChrome(false);
      resyncNearbyTaxiOnFocus();
      armBleSearchPulse();
      const flashed = takeTopUpSuccessFlash();
      if (flashed != null) {
        showTopUpSuccessBanner(flashed);
      }
      const pending = takePendingDepositWatch();
      if (pending == null) return;
      topUpPollAbortRef.current?.abort();
      const pollAbort = new AbortController();
      topUpPollAbortRef.current = pollAbort;
      setTopUpPhase("awaiting");
      void (async () => {
        try {
          await waitDepositCompleted(pending.token, pending.depositIntentId, {
            signal: pollAbort.signal,
          });
          if (pollAbort.signal.aborted) return;
          setTopUpPhase("success");
          showTopUpSuccessBanner(pending.amountFcfa);
          void refreshUser();
          await new Promise<void>((r) => setTimeout(r, 500));
          setTopUpPhase("idle");
        } catch (e) {
          if (pollAbort.signal.aborted) return;
          setTopUpPhase("idle");
          setTopUpSuccessMessage(null);
          Alert.alert(
            t("deposit.topUpTitle"),
            e instanceof ApiError ? e.message : t("deposit.creditFailed"),
          );
        }
      })();
    }, [
      showTopUpSuccessBanner,
      refreshUser,
      t,
      resyncNearbyTaxiOnFocus,
      armBleSearchPulse,
    ]),
  );
  useEffect(() => {
    return () => {
      if (topUpBannerTimerRef.current) {
        clearTimeout(topUpBannerTimerRef.current);
      }
      topUpPollAbortRef.current?.abort();
    };
  }, []);
  const userPhone = user?.phone ?? "";
  /** Module API préchargé pendant la saisie PIN (pas au moment du POST). */
  const payApiRef = useRef<typeof import("@/lib/api/client") | null>(null);
  const warmPayApi = useCallback(() => {
    void import("@/lib/api/client")
      .then((m) => {
        payApiRef.current = m;
        return m.ensureSessionFresh();
      })
      .catch(() => {
        /* warm best-effort */
      });
  }, []);
  const [paymentStatus, setPaymentStatus] = useState<"IDLE" | "SENDING">("IDLE");
  /** Montant affiché dans la modale solde insuffisant (état local pad). */
  const [insufficientAttemptFcfa, setInsufficientAttemptFcfa] = useState(0);
  /** Feedback PIN : spinner → coche succès → écran Payé. */
  const [payPinUi, setPayPinUi] = useState<"idle" | "sending">("idle");
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
  const [payOutcomeSheet, setPayOutcomeSheet] =
    useState<PayOutcomeSheetData | null>(null);
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

  /**
   * Splash sacré → prefetch hors chemin critique Pay.
   * Pas de warm API client ici : ça volerait le CPU du 1er frame.
   * Le client se précharge au clic « payer » / montant rapide (Pay déjà affiché).
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

  const handleTopUpFromPay = useCallback(async () => {
    if (topUpPhase !== "idle" || paymentStatus === "SENDING") return;
    if (!token) {
      Keyboard.dismiss();
      void importPayRegisterOverlay();
      setConnexionPromptKind("recharge");
      return;
    }
    if (user?.needsOnboarding) {
      Alert.alert(
        t("pay.onboardingRequiredTitle"),
        t("pay.onboardingRequiredMessage"),
      );
      return;
    }
    const n = payAmountFcfa;
    /** Pas de montant sur le pad → feuille dépôt classique. */
    if (n == null || n <= 0) {
      openDepositInstant();
      return;
    }
    if (!topUpIdempotencyRef.current) {
      topUpIdempotencyRef.current = newDepositIdempotencyKey();
    }
    const idempotencyKey = topUpIdempotencyRef.current;
    topUpPollAbortRef.current?.abort();
    const pollAbort = new AbortController();
    topUpPollAbortRef.current = pollAbort;
    setTopUpPhase("loading");
    try {
      const init = await initiateWalletDeposit(token, n, idempotencyKey);
      if (init.status === "completed") {
        topUpIdempotencyRef.current = null;
        setTopUpPhase("success");
        showTopUpSuccessBanner(n);
        void refreshUser();
        await new Promise<void>((r) => setTimeout(r, 500));
        setTopUpPhase("idle");
        return;
      }
      /** MoMo lancé → plus de spinner ; confirmation silencieuse en fond. */
      setTopUpPhase("awaiting");
      await waitDepositCompleted(token, init.depositIntentId, {
        signal: pollAbort.signal,
      });
      if (pollAbort.signal.aborted) return;
      topUpIdempotencyRef.current = null;
      setTopUpPhase("success");
      showTopUpSuccessBanner(n);
      void refreshUser();
      await new Promise<void>((r) => setTimeout(r, 500));
      setTopUpPhase("idle");
    } catch (e) {
      if (pollAbort.signal.aborted) return;
      topUpIdempotencyRef.current = null;
      setTopUpPhase("idle");
      setTopUpSuccessMessage(null);
      Alert.alert(
        t("deposit.topUpTitle"),
        e instanceof ApiError ? e.message : t("deposit.creditFailed"),
      );
    }
  }, [
    topUpPhase,
    paymentStatus,
    token,
    user?.needsOnboarding,
    payAmountFcfa,
    openDepositInstant,
    refreshUser,
    showTopUpSuccessBanner,
    t,
  ]);

  const handlePay = useCallback((n: number) => {
    if (n <= 0 || paymentStatus === "SENDING") return;
    /** Pendant le PIN : module + JWT prêts → POST quasi immédiat. */
    warmPayApi();
    if (!token) {
      Keyboard.dismiss();
      void importPayRegisterOverlay();
      setConnexionPromptKind("pay");
      return;
    }
    if (user?.activeContext?.type === "commerce") {
      Alert.alert(t("commerce.payAsPersonalTitle"), t("commerce.payAsPersonalMessage"));
      return;
    }
    if (!recipientRef.current) {
      Alert.alert(t("ble.noTaxiTitle"), t("ble.noTaxiMessage"));
      return;
    }
    if (!recipientRef.current.accountId) {
      Alert.alert(t("ble.noTaxiTitle"), t("ble.noTaxiMessage"));
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
      setInsufficientAttemptFcfa(n);
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
  }, [
    paymentStatus,
    token,
    user,
    balance,
    payPinLockoutUntil,
    t,
    warmPayApi,
  ]);

  const cancelPayPin = useCallback(() => {
    if (payPinUi === "sending") return;
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

  const confirmPayWithPin = useCallback(async (pinRaw?: string) => {
    const pin = (pinRaw ?? payPinDraft).replace(/\D/g, "");
    if (pin.length !== ONBOARDING_PIN_LEN || !token) return;
    if (paymentStatus === "SENDING" || payPinUi !== "idle") return;
    setPayPinErrorLine(null);
    setPaymentStatus("SENDING");
    setPayPinUi("sending");
    try {
      const api = payApiRef.current ?? (await import("@/lib/api/client"));
      payApiRef.current = api;
      const to = recipientRef.current;
      if (!to) {
        throw new ApiError(t("ble.noTaxiMessage"), 409);
      }
      const payRes = await api.pay(
        token,
        payPendingAmount,
        to.name,
        to.phoneDigits || null,
        pin,
        to.accountId,
      );
      if (payPinFocusTimerRef.current) {
        clearTimeout(payPinFocusTimerRef.current);
        payPinFocusTimerRef.current = null;
      }
      payPinInputRef.current?.blur();
      Keyboard.dismiss();
      payPinFailedRef.current = 0;
      const paidAt = new Date().toISOString();
      const reference =
        payRes.reference?.trim() ||
        (payRes.transactionId
          ? fallbackTxReference(payRes.transactionId)
          : fallbackTxReference(`pay-${Date.now()}`));
      /** Solde + historique RAM tout de suite (onglet Transactions = flash, pas reload). */
      updateBalance(payRes.balanceFcfa);
      if (userPhone && payRes.transactionId) {
        const cache = await import("@/lib/transactionsCache");
        cache.mergeTransactionsDelta(userPhone, [
          {
            id: payRes.transactionId,
            reference,
            type: "sent",
            amountFcfa: payPendingAmount,
            counterpartyName: to.name,
            counterpartyPhone: to.phoneDigits || null,
            createdAt: paidAt,
          },
        ]);
        await cache.setSyncCursor(userPhone, paidAt);
      }
      setPayPinModalVisible(false);
      setPayPinDraft("");
      setPayPinSelection(undefined);
      setPayPinUi("idle");
      setPaymentStatus("IDLE");
      setPayOutcomeSheet({
        kind: "success",
        amountFcfa: payPendingAmount,
        recipientName: to.name,
      });
      if (to.accountId && to.name) {
        void import("@/lib/peers/displayNameCache").then((m) => {
          m.rememberPeerDisplayName(to.accountId!, to.name);
        });
      }
      /** Confirmations réseau en fond (ne bloquent pas l’UI). */
      void refreshUser();
      if (userPhone) {
        void import("@/lib/sync/transactionsSync").then((m) => {
          void m.syncTransactionsFromNetwork(token, userPhone);
        });
      }
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
          const to = recipientRef.current;
          if (to) {
            void import("@/lib/offline/queue").then((m) => {
              void m.enqueueOfflineOp("pay", {
                amountFcfa: payPendingAmount,
                recipientName: to.name,
                recipientPhone: to.phoneDigits || null,
                transactionPin: pin,
              });
            });
          }
        }
        setPayOutcomeSheet({
          kind: "error",
          title: t("pay.paymentTitle"),
          message:
            e instanceof ApiError ? e.message : t("common.genericError"),
          recipientName: recipientRef.current?.name,
        });
      }
    }
  }, [
    payPinDraft,
    payPinUi,
    paymentStatus,
    token,
    payPendingAmount,
    refreshUser,
    updateBalance,
    schedulePayPinFieldFocus,
    t,
    userPhone,
  ]);

  const dismissPayOutcomeSheet = useCallback(() => {
    setPayOutcomeSheet(null);
  }, []);

  useEffect(() => {
    if (!payOutcomeSheet) return;
    const back = BackHandler.addEventListener("hardwareBackPress", () => {
      dismissPayOutcomeSheet();
      return true;
    });
    return () => back.remove();
  }, [payOutcomeSheet, dismissPayOutcomeSheet]);

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
                  <Pressable
                    onPress={onRefreshNearbyTaxi}
                    disabled={bleBroadcasting}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={t("ble.refreshA11y")}
                    accessibilityState={{
                      disabled: bleBroadcasting,
                      busy: bleRefreshing,
                    }}
                    style={({ pressed }) => [
                      styles.recipientRow,
                      pressed &&
                        !bleBroadcasting &&
                        styles.recipientRowPressed,
                    ]}
                  >
                    <View
                      style={[
                        styles.recipientThumb,
                        !recipient && styles.recipientThumbMuted,
                      ]}
                    >
                      {bleShowSearchChrome ? (
                        <ActivityIndicator color={colors.accent} size="small" />
                      ) : recipient ? (
                        <Text style={styles.recipientThumbLetter}>
                          {recipient.name.charAt(0).toUpperCase()}
                        </Text>
                      ) : bleBroadcasting ? (
                        <Ionicons
                          name="radio"
                          size={22}
                          color={colors.accent}
                        />
                      ) : (
                        <Text style={styles.recipientThumbLetter}>?</Text>
                      )}
                    </View>
                    <View style={styles.recipientTexts}>
                      <Text
                        style={styles.driverName}
                        numberOfLines={1}
                        ellipsizeMode="tail"
                      >
                        {bleHeaderTitle}
                      </Text>
                      <Text style={styles.driverPhone} numberOfLines={1}>
                        {bleHeaderSubtitle}
                      </Text>
                    </View>
                  </Pressable>
                  <Pressable
                    style={({ pressed }) => [
                      styles.balanceAddBtn,
                      pressed &&
                        topUpPhase !== "loading" &&
                        topUpPhase !== "awaiting" &&
                        styles.balanceAddBtnPressed,
                    ]}
                    onPressIn={() => {
                      if (token && payAmountFcfa == null) {
                        void import("@/app/deposit");
                      } else if (token) {
                        void import("@/lib/api/client");
                      }
                    }}
                    onPress={() => {
                      void handleTopUpFromPay();
                    }}
                    disabled={topUpPhase === "loading" || topUpPhase === "awaiting"}
                    accessibilityRole="button"
                    accessibilityLabel={t("common.topUpAccount")}
                    accessibilityState={{
                      busy: topUpPhase === "loading" || topUpPhase === "awaiting",
                      disabled:
                        topUpPhase === "loading" || topUpPhase === "awaiting",
                    }}
                    hitSlop={10}
                  >
                    {topUpPhase === "loading" ? (
                      <ActivityIndicator color={colors.accent} size="small" />
                    ) : topUpPhase === "success" ? (
                      <CheckGlyph color={colors.accent} size={22} />
                    ) : (
                      <Text style={styles.balanceAddIcon}>+</Text>
                    )}
                  </Pressable>
                </View>
              </View>

              <PayAmountEntry
                styles={styles}
                /** Identité stable — pas le JWT (refresh → sinon montant remis à 0). */
                resetKey={user?.personalAccountId ?? user?.phone ?? "anon"}
                keypadDisabled={
                  paymentStatus === "SENDING" || showRegisterOverlay
                }
                payBusy={paymentStatus === "SENDING"}
                onPay={handlePay}
                onAmountFcfaChange={setPayAmountFcfa}
                topUpSuccessMessage={topUpSuccessMessage}
                balanceFcfa={user && balance <= 1000 ? balance : null}
              />
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
                      amount: formatFcfa(insufficientAttemptFcfa),
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
            <KeyboardAvoidingView
              style={styles.payPinOverlay}
              behavior={Platform.OS === "ios" ? "padding" : undefined}
              accessibilityViewIsModal
            >
              <Pressable
                style={styles.payPinModalBackdrop}
                onPress={() => {
                  if (payPinUi === "idle") cancelPayPin();
                }}
                disabled={payPinUi !== "idle"}
                accessibilityLabel={t("common.close")}
              />
              <View style={styles.payPinCard}>
                <Text style={styles.payPinModalTitle}>{t("pay.pinTitle")}</Text>
                <Text style={styles.payPinModalSub}>
                  <Trans
                    i18nKey="pay.pinConfirmPayment"
                    values={{
                      amount: formatFcfa(payPendingAmount),
                      name: recipientRef.current?.name ?? t("ble.driverDefaultName"),
                    }}
                    components={{
                      amount: <Text style={styles.payPinModalSubAmount} />,
                    }}
                  />
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
                ) : null}
              </View>
            </KeyboardAvoidingView>
          ) : null}

          {depositChrome ? (
            <DepositOpenChrome
              onClose={() => {
                setDepositChrome(false);
                if (router.canGoBack()) router.back();
              }}
            />
          ) : null}

          {payOutcomeSheet ? (
            <PayOutcomeSheet
              outcome={payOutcomeSheet}
              onDismiss={dismissPayOutcomeSheet}
            />
          ) : null}
      </View>
    </View>
  );
}
