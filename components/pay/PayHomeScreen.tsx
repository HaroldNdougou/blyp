import "@/lib/perf/eagerRoutes";
import { DepositOpenChrome } from "@/components/deposit/DepositOpenChrome";
import { useAuth } from "@/contexts/authContextBase";
import { useTheme } from "@/contexts/ThemeContext";
import { modalPresentation } from "@/lib/perf/instantMotion";
import { useNearbyTaxi } from "@/hooks/useNearbyTaxi";
import { useTaxiBroadcast } from "@/hooks/useTaxiBroadcast";
import { fallbackAccountId } from "@/lib/accountId";
import { resolveP2pReceiveBroadcastAccount } from "@/lib/ble/broadcastAccount";
import { waitForNearbyPayPeer } from "@/lib/ble/waitPayPeer";
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
import { maxTxAmountFcfaForUser } from "@/lib/kyc/limits";
import { openDepositRoute } from "@/lib/nav/openDeposit";
import { perfMarkEnd, perfMarkStart } from "@/lib/perf/marks";
import { useMarkRootShellReady } from "@/lib/rootShellReady";
import { fallbackTxReference } from "@/lib/txReference";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { router, Stack, usePathname } from "expo-router";
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

import { contactPhotoUriForPhone } from "@/lib/contacts/contactPhotos";
import { PeerAvatar } from "@/components/peers/PeerAvatar";
import { IncomingPaymentFlashSheet } from "@/components/pay/IncomingPaymentFlashSheet";
import { MaskedPinInput } from "@/components/pay/MaskedPinInput";
import { PayAmountEntry } from "@/components/pay/PayAmountEntry";
import { CheckGlyph, ReceiveNearbyGlyph } from "@/components/pay/PayGlyphs";
import {
  PayOutcomeSheet,
  type PayOutcomeSheetData,
} from "@/components/pay/PayOutcomeSheet";
import { createPayHomeStyles } from "@/components/pay/payHomeStyles";
import { PayRegisterOverlayFallback } from "@/components/pay/PayRegisterOverlayFallback";
import {
  subscribeIncomingPaymentFlash,
  type IncomingPaymentFlash,
} from "@/lib/pay/incomingFlash";
import {
  DEFAULT_QUICK_AMOUNTS,
  getQuickAmounts,
  startQuickAmountsEngine,
  subscribeQuickAmounts,
} from "@/lib/pay/quickAmounts";
import { demoAvatarUrlForPhone, isDemoPhone } from "@/lib/dev/demoProfiles";
import {
  getRegularRecipients,
  startRegularRecipientsEngine,
  subscribeRegularRecipients,
  type RegularRecipient,
} from "@/lib/pay/regularRecipients";
import { Trans, useTranslation } from "react-i18next";
import { SafeAreaView } from "react-native-safe-area-context";

/** Même cible que `lazy` : le préchargement remplit le cache avant le 1er « Connexion rapide ». */
const importPayRegisterOverlay = () => import("./PayRegisterOverlay");
const PayRegisterOverlay = lazy(importPayRegisterOverlay);

/** Ne pas se détecter soi-même (BLE-U / tel). */
function isOwnNearbyPeer(
  peer: { accountId: string; phoneDigits: string },
  user: { id?: string; personalAccountId?: string | null; phone?: string | null } | null,
): boolean {
  if (!user) return false;
  const peerId = peer.accountId.trim().toUpperCase();
  const personal = String(user.personalAccountId ?? "")
    .trim()
    .toUpperCase();
  if (personal && peerId === personal) return true;
  if (user.id) {
    const derived = fallbackAccountId(user.id).toUpperCase();
    if (peerId === derived) return true;
  }
  const mine = String(user.phone ?? "")
    .replace(/\D/g, "")
    .slice(-9);
  return mine.length === 9 && peer.phoneDigits === mine;
}

const RECEIVED_FLASH_MS = 10000;

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
  /** Proche fréquent : envoi par message money (pas BLE). */
  viaMoneyMessage?: boolean;
};

function newMoneyClientId() {
  return `c-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function regularToRecipient(r: RegularRecipient): PayRecipient {
  return {
    accountId: null,
    name: r.name,
    phoneDigits: r.phone,
    viaMoneyMessage: true,
  };
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
  const pathname = usePathname();
  /** Montant pad Pay — pour recharge + sans passer par le modal dépôt. */
  const [payAmountFcfa, setPayAmountFcfa] = useState<number | null>(null);
  /** Incrémenté à la fermeture feuille succès/erreur → vide le pad (état local PayAmountEntry). */
  const [amountPadResetSeq, setAmountPadResetSeq] = useState(0);
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
  /** La vraie feuille /deposit est un transparentModal : retirer la coquille
   *  dès qu’elle est montée, sinon on voit 2 overlays (coquille + modal). */
  useEffect(() => {
    if (pathname === "/deposit") setDepositChrome(false);
  }, [pathname]);
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
  const p2pBroadcastAccount = useMemo(
    () => resolveP2pReceiveBroadcastAccount(user),
    [user],
  );
  const receiveBroadcast = useTaxiBroadcast(p2pBroadcastAccount);
  const [quickAmounts, setQuickAmounts] = useState<readonly number[]>(
    () => DEFAULT_QUICK_AMOUNTS,
  );
  const spendCategory = nearbyPeer?.category ?? null;

  const recipient = useMemo<PayRecipient | null>(() => {
    if (!nearbyPeer) return null;
    if (isOwnNearbyPeer(nearbyPeer, user)) return null;
    return {
      accountId: nearbyPeer.accountId,
      name: nearbyPeer.displayName,
      phoneDigits: nearbyPeer.phoneDigits,
    };
  }, [nearbyPeer, user]);
  const recipientRef = useRef(recipient);
  recipientRef.current = recipient;
  /** Figé à l’ouverture du PIN — le render ne doit pas l’effacer pendant le handoff BLE. */
  const payRecipientAtPinRef = useRef<PayRecipient | null>(null);
  const payOfflinePendingRef = useRef<{
    amountFcfa: number;
    recipientName: string;
    recipientPhone: string | null;
    recipientAccountId: string | null;
    pin: string;
  } | null>(null);
  const userRef = useRef(user);
  userRef.current = user;
  const [payHandoff, setPayHandoff] = useState(false);
  const payHandoffRef = useRef(false);

  const [receivedFlash, setReceivedFlash] =
    useState<IncomingPaymentFlash | null>(null);
  const payFocusedRef = useRef(false);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismissReceivedFlash = useCallback(() => {
    if (flashTimerRef.current) {
      clearTimeout(flashTimerRef.current);
      flashTimerRef.current = null;
    }
    setReceivedFlash(null);
  }, []);

  const showReceivedFlash = useCallback((event: IncomingPaymentFlash) => {
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
  }, []);

  useEffect(() => {
    return subscribeIncomingPaymentFlash((event) => {
      if (!payFocusedRef.current) return;
      if (event.contextType === "commerce") return;
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

  /**
   * Soft UX BLE : pulse « Recherche… » au 1er affichage / tap refresh,
   * puis « Aucun taxi détecté ». Le scan continue. Le timer ne doit
   * jamais être clear sans passer à l’état calme (sinon spinner infini).
   */
  const [bleSearchPulse, setBleSearchPulse] = useState(true);
  const blePulseGenRef = useRef(0);
  const blePulseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bleSearchSettledRef = useRef(false);
  const wasBleHardRef = useRef(false);

  const bleHardBlock =
    bleBroadcasting ||
    bleStatus === "denied" ||
    bleStatus === "powered_off" ||
    bleStatus === "unavailable";

  const stopBleSearchPulse = useCallback(() => {
    blePulseGenRef.current += 1;
    if (blePulseTimerRef.current) {
      clearTimeout(blePulseTimerRef.current);
      blePulseTimerRef.current = null;
    }
    setBleSearchPulse(false);
  }, []);

  const armBleSearchPulse = useCallback(() => {
    const gen = ++blePulseGenRef.current;
    bleSearchSettledRef.current = false;
    setBleSearchPulse(true);
    if (blePulseTimerRef.current) clearTimeout(blePulseTimerRef.current);
    blePulseTimerRef.current = setTimeout(() => {
      if (blePulseGenRef.current !== gen) return;
      blePulseTimerRef.current = null;
      bleSearchSettledRef.current = true;
      setBleSearchPulse(false);
    }, BLE_SEARCH_PULSE_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (blePulseTimerRef.current) clearTimeout(blePulseTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (recipient || bleHardBlock) {
      stopBleSearchPulse();
      if (recipient) bleSearchSettledRef.current = true;
      wasBleHardRef.current = bleHardBlock;
      return;
    }
    if (wasBleHardRef.current) {
      wasBleHardRef.current = false;
      armBleSearchPulse();
    }
  }, [recipient, bleHardBlock, armBleSearchPulse, stopBleSearchPulse]);

  useEffect(() => {
    if (bleSearchSettledRef.current || recipient || bleHardBlock) return;
    armBleSearchPulse();
  }, [armBleSearchPulse, recipient, bleHardBlock]);

  const bleShowSearchChrome =
    !recipient &&
    (payHandoff ||
      (!bleHardBlock && (bleSearchPulse || bleStatus === "starting")));

  const bleHeaderTitle = recipient
    ? recipient.name
    : payHandoff
      ? t("ble.searchingTaxi")
    : bleBroadcasting
      ? t("ble.broadcastingShort")
      : bleStatus === "denied" || bleStatus === "powered_off"
        ? t("ble.bluetoothOffShort")
          : bleStatus === "unavailable"
            ? t("ble.nativeUnavailableShort")
            : bleShowSearchChrome
              ? t("ble.searchingTaxi")
              : t("ble.noneNearby");
  const bleHeaderSubtitle = recipient
    ? formatCameroonPhoneDisplay(recipient.phoneDigits)
    : payHandoff
      ? t("ble.searchingHint")
    : bleBroadcasting
      ? t("ble.broadcastingHint")
      : bleStatus === "denied" || bleStatus === "powered_off"
        ? t("ble.bluetoothOffHint")
        : bleStatus === "unavailable"
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
    armBleSearchPulse();
    void import("expo-haptics")
      .then((H) => H.impactAsync(H.ImpactFeedbackStyle.Light))
      .catch(() => {});
  }, [bleBroadcasting, refreshNearbyTaxi, armBleSearchPulse]);

  const onReceiveNearbyToggle = useCallback(
    async (enabled: boolean) => {
      if (!token) {
        Keyboard.dismiss();
        void importPayRegisterOverlay();
        setConnexionPromptKind("pay");
        return;
      }
      const { status, message } = await receiveBroadcast.setEnabled(enabled);
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
      Alert.alert(t("pay.receiveNearbyLabel"), msg);
    },
    [token, receiveBroadcast.setEnabled, t],
  );

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
  const resyncNearbyTaxiOnFocusRef = useRef(resyncNearbyTaxiOnFocus);
  resyncNearbyTaxiOnFocusRef.current = resyncNearbyTaxiOnFocus;
  const armBleSearchPulseRef = useRef(armBleSearchPulse);
  armBleSearchPulseRef.current = armBleSearchPulse;
  const showTopUpSuccessBannerRef = useRef(showTopUpSuccessBanner);
  showTopUpSuccessBannerRef.current = showTopUpSuccessBanner;
  const refreshUserRef = useRef(refreshUser);
  refreshUserRef.current = refreshUser;
  const tRef = useRef(t);
  tRef.current = t;

  useFocusEffect(
    useCallback(() => {
      payFocusedRef.current = true;
      return () => {
        payFocusedRef.current = false;
      };
    }, []),
  );

  useFocusEffect(
    useCallback(() => {
      setDepositChrome(false);
      resyncNearbyTaxiOnFocusRef.current();
      /** Retour modal / autre onglet : pas de nouveau spinner si déjà tranché. */
      if (!bleSearchSettledRef.current) {
        armBleSearchPulseRef.current();
      }
      const flashed = takeTopUpSuccessFlash();
      if (flashed != null) {
        showTopUpSuccessBannerRef.current(flashed);
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
          showTopUpSuccessBannerRef.current(pending.amountFcfa);
          void refreshUserRef.current();
          await new Promise<void>((r) => setTimeout(r, 500));
          setTopUpPhase("idle");
        } catch (e) {
          if (pollAbort.signal.aborted) return;
          setTopUpPhase("idle");
          setTopUpSuccessMessage(null);
          Alert.alert(
            tRef.current("deposit.topUpTitle"),
            e instanceof ApiError
              ? e.message
              : tRef.current("deposit.creditFailed"),
          );
        }
      })();
    }, []),
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
  const spendCategoryRef = useRef(spendCategory);
  spendCategoryRef.current = spendCategory;

  useEffect(() => {
    if (!userPhone) return;
    return startQuickAmountsEngine(userPhone);
  }, [userPhone]);

  const [regulars, setRegulars] = useState<readonly RegularRecipient[]>(
    getRegularRecipients,
  );
  const [selectedRegularPhone, setSelectedRegularPhone] = useState<
    string | null
  >(null);
  const selectedRegularRef = useRef<RegularRecipient | null>(null);
  /** conversationId résolu en fond dès la sélection (cache → sinon POST). */
  const regularConvRef = useRef<{
    phone: string;
    promise: Promise<string>;
  } | null>(null);

  useEffect(() => {
    if (!userPhone) return;
    const stop = startRegularRecipientsEngine(userPhone);
    setRegulars(getRegularRecipients());
    const unsub = subscribeRegularRecipients(() =>
      setRegulars(getRegularRecipients()),
    );
    return () => {
      unsub();
      stop();
    };
  }, [userPhone]);

  useEffect(() => {
    const sel = selectedRegularRef.current;
    if (sel && !regulars.some((r) => r.phone === sel.phone)) {
      selectedRegularRef.current = null;
      setSelectedRegularPhone(null);
    }
  }, [regulars]);

  const resolveRegularConversation = useCallback(
    (phone: string): Promise<string> => {
      const hit = regularConvRef.current;
      if (hit && hit.phone === phone) return hit.promise;
      const access = token;
      const promise = (async () => {
        if (!access) throw new ApiError(t("common.genericError"), 401);
        const cache = await import("@/lib/messagesCache");
        const convs = cache.getConversationsSnapshot(access) ?? [];
        const cached = convs.find(
          (c) =>
            String(c.peerPhone ?? "")
              .replace(/\D/g, "")
              .slice(-9) === phone,
        );
        if (cached) return cached.id;
        if (isDemoPhone(phone)) throw new ApiError(t("demo.readOnly"), 400);
        const api = await import("@/lib/api/client");
        const { conversation } = await api.openConversation(access, phone);
        cache.setConversationsSnapshot(access, [
          conversation,
          ...convs.filter((c) => c.id !== conversation.id),
        ]);
        return conversation.id;
      })();
      promise.catch(() => {
        if (regularConvRef.current?.promise === promise) {
          regularConvRef.current = null;
        }
      });
      regularConvRef.current = { phone, promise };
      return promise;
    },
    [token, t],
  );

  useEffect(() => {
    const apply = () => {
      const next = getQuickAmounts(spendCategory);
      setQuickAmounts((prev) => {
        if (
          prev.length === next.length &&
          prev.every((v, i) => v === next[i])
        ) {
          return prev;
        }
        return next;
      });
    };
    apply();
    return subscribeQuickAmounts(apply);
  }, [spendCategory]);
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
  /** Une clé par ouverture PIN : double tap / retry réseau = un seul débit. */
  const moneyIdemRef = useRef<string | null>(null);
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
  const confirmPayWithPinRef = useRef<
    (
      pinRaw?: string,
      opts?: { deviceAuthDone?: boolean },
    ) => Promise<void>
  >(async () => {});
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

  useEffect(() => {
    if (!token) void importPayRegisterOverlay();
  }, [token]);

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

  const openPayPinForAmount = useCallback(
    (n: number, to: PayRecipient) => {
      if (!to.accountId && !to.viaMoneyMessage) {
        Alert.alert(t("ble.noNearbyTitle"), t("ble.noNearbyMessage"));
        return;
      }
      const u = userRef.current;
      if (u?.needsOnboarding) {
        Alert.alert(
          t("pay.onboardingRequiredTitle"),
          t("pay.onboardingRequiredMessage"),
        );
        return;
      }
      if (u != null && n > balance) {
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
      payRecipientAtPinRef.current = to;
      if (to.viaMoneyMessage) {
        moneyIdemRef.current = newMoneyClientId();
        void resolveRegularConversation(to.phoneDigits).catch(() => {});
      } else {
        recipientRef.current = to;
      }
      payPinFailedRef.current = 0;
      setPayPinErrorLine(null);
      setPayPinSelection(undefined);
      setPayPinUi("idle");
      setPayPendingAmount(n);
      setPayPinDraft("");
      payPinOpenFocusGenRef.current += 1;
      setPayPinInputKey((k) => k + 1);
      void (async () => {
        const { tryUnlockTransactionPinVault } = await import(
          "@/lib/security/transactionPinVault"
        );
        const vaulted = await tryUnlockTransactionPinVault(
          t("pay.deviceAuthPrompt"),
        );
        if (vaulted) {
          void confirmPayWithPinRef.current(vaulted, { deviceAuthDone: true });
          return;
        }
        setPayPinModalVisible(true);
      })();
    },
    [balance, payPinLockoutUntil, t, resolveRegularConversation],
  );

  const handlePay = useCallback(
    (n: number) => {
      if (n <= 0 || paymentStatus === "SENDING" || payHandoffRef.current) {
        return;
      }
      warmPayApi();
      if (!token) {
        Keyboard.dismiss();
        void importPayRegisterOverlay();
        setConnexionPromptKind("pay");
        return;
      }
      if (user?.activeContext?.type === "commerce") {
        Alert.alert(
          t("commerce.payAsPersonalTitle"),
          t("commerce.payAsPersonalMessage"),
        );
        return;
      }

      const kycMax = maxTxAmountFcfaForUser(user);
      if (n > kycMax) {
        Alert.alert(t("kyc.limitTitle"), t("kyc.limitMessage", {
          amount: formatFcfa(kycMax),
        }), [
          { text: t("common.cancel"), style: "cancel" },
          {
            text: t("kyc.verifyCta"),
            onPress: () => router.push("/kyc"),
          },
        ]);
        return;
      }

      const regular = selectedRegularRef.current;
      if (regular) {
        if (isDemoPhone(regular.phone)) {
          Alert.alert(t("demo.title"), t("demo.readOnly"));
          return;
        }
        openPayPinForAmount(n, regularToRecipient(regular));
        return;
      }

      const proceed = (to: PayRecipient | null) => {
        if (!to?.accountId) {
          Alert.alert(t("ble.noNearbyTitle"), t("ble.noNearbyMessage"));
          return;
        }
        openPayPinForAmount(n, to);
      };

      if (!bleBroadcasting && !receiveBroadcast.on) {
        proceed(recipientRef.current);
        return;
      }

      payHandoffRef.current = true;
      setPayHandoff(true);
      armBleSearchPulse();
      void (async () => {
        try {
          await receiveBroadcast.setEnabled(false);
          const peer = await waitForNearbyPayPeer({
            isOwn: (p) => isOwnNearbyPeer(p, userRef.current),
          });
          if (!peer) {
            proceed(null);
            return;
          }
          proceed({
            accountId: peer.accountId,
            name: peer.displayName,
            phoneDigits: peer.phoneDigits,
          });
        } finally {
          payHandoffRef.current = false;
          setPayHandoff(false);
        }
      })();
    },
    [
      paymentStatus,
      token,
      user,
      t,
      warmPayApi,
      bleBroadcasting,
      receiveBroadcast.on,
      receiveBroadcast.setEnabled,
      openPayPinForAmount,
      armBleSearchPulse,
    ],
  );

  const handlePayRef = useRef(handlePay);
  handlePayRef.current = handlePay;
  const payAmountFcfaRef = useRef(payAmountFcfa);
  payAmountFcfaRef.current = payAmountFcfa;

  /** Tap proche : montant déjà saisi → PIN direct ; sinon sélection (↑ / montant rapide). */
  const onRegularPress = useCallback(
    (r: RegularRecipient) => {
      if (selectedRegularRef.current?.phone === r.phone) {
        selectedRegularRef.current = null;
        setSelectedRegularPhone(null);
        return;
      }
      selectedRegularRef.current = r;
      setSelectedRegularPhone(r.phone);
      warmPayApi();
      void resolveRegularConversation(r.phone).catch(() => {});
      const n = payAmountFcfaRef.current;
      if (n != null && n > 0) handlePayRef.current(n);
    },
    [warmPayApi, resolveRegularConversation],
  );

  const selectedRegularLabel = useMemo(() => {
    if (!selectedRegularPhone) return null;
    const r = regulars.find((x) => x.phone === selectedRegularPhone);
    return r ? t("pay.amountLabelTo", { name: r.firstName }) : null;
  }, [selectedRegularPhone, regulars, t]);

  const regularsBusy = paymentStatus === "SENDING" || payHandoff;
  const regularsRow = useMemo(() => {
    if (!token || regulars.length === 0) return null;
    return (
      <View style={styles.regularsRow}>
        {regulars.map((r) => {
          const selected = selectedRegularPhone === r.phone;
          return (
            <Pressable
              key={r.phone}
              style={({ pressed }) => [
                styles.regularChip,
                selected && styles.regularChipSelected,
                pressed && !regularsBusy && styles.regularChipPressed,
              ]}
              onPress={() => onRegularPress(r)}
              unstable_pressDelay={0}
              hitSlop={4}
              disabled={regularsBusy}
              accessibilityRole="button"
              accessibilityState={{ selected, disabled: regularsBusy }}
              accessibilityLabel={t("pay.regularA11y", { name: r.name })}
            >
              <PeerAvatar
                name={r.name}
                phone={r.phone}
                remoteUrl={demoAvatarUrlForPhone(r.phone)}
                localUri={contactPhotoUriForPhone(r.phone)}
                size={28}
                selected={selected}
                style={styles.regularAvatar}
                textStyle={
                  selected ? styles.regularAvatarTextSelected : styles.regularAvatarText
                }
              />
              <Text
                style={[
                  styles.regularName,
                  selected && styles.regularNameSelected,
                ]}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.7}
              >
                {r.firstName}
              </Text>
            </Pressable>
          );
        })}
      </View>
    );
  }, [
    token,
    regulars,
    selectedRegularPhone,
    regularsBusy,
    styles,
    onRegularPress,
    t,
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

  const confirmPayWithPin = useCallback(
    async (pinRaw?: string, opts?: { deviceAuthDone?: boolean }) => {
    const pin = (pinRaw ?? payPinDraft).replace(/\D/g, "");
    if (pin.length !== ONBOARDING_PIN_LEN || !token) return;
    if (paymentStatus === "SENDING" || payPinUi !== "idle") return;
    setPayPinErrorLine(null);
    setPaymentStatus("SENDING");
    setPayPinUi("sending");
    try {
      const api = payApiRef.current ?? (await import("@/lib/api/client"));
      payApiRef.current = api;
      const to = payRecipientAtPinRef.current ?? recipientRef.current;
      if (!to) {
        throw new ApiError(t("ble.noTaxiMessage"), 409);
      }
      let payRes: {
        balanceFcfa: number;
        transactionId: string | null;
        reference: string | null;
      };
      let txKind = "PAYMENT";
      if (to.viaMoneyMessage) {
        const conversationId = await resolveRegularConversation(
          to.phoneDigits,
        );
        const idem = moneyIdemRef.current ?? newMoneyClientId();
        moneyIdemRef.current = idem;
        const res = await api.sendMoneyMessage(
          token,
          conversationId,
          payPendingAmount,
          newMoneyClientId(),
          idem,
          pin,
        );
        payRes = {
          balanceFcfa: res.balanceFcfa,
          transactionId: res.message.moneyTransfer?.transferId ?? null,
          reference: null,
        };
        txKind = "MONEY_SEND";
        void import("@/lib/messagesCache").then((m) => {
          m.upsertPushedMessage(token, res.message);
        });
        selectedRegularRef.current = null;
        setSelectedRegularPhone(null);
      } else {
        payRes = await api.pay(
          token,
          payPendingAmount,
          to.name,
          to.phoneDigits || null,
          pin,
          to.accountId,
        );
      }
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
            kind: txKind,
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
        copy:
          to.viaMoneyMessage || spendCategoryRef.current === "other"
            ? "transfer"
            : "payment",
      });
      if (to.accountId && to.name) {
        void import("@/lib/peers/displayNameCache").then((m) => {
          m.rememberPeerDisplayName(to.accountId!, to.name);
        });
      }
      const cat = to.viaMoneyMessage ? null : spendCategoryRef.current;
      if (cat) {
        void import("@/lib/peers/peerCategoryCache").then((m) => {
          m.rememberPeerCategory(to.accountId ?? "", cat, to.phoneDigits);
        });
      }
      /** Confirmations réseau en fond (ne bloquent pas l’UI). */
      void refreshUser();
      if (userPhone) {
        void import("@/lib/sync/transactionsSync").then((m) => {
          void m.syncTransactionsFromNetwork(token, userPhone);
        });
      }
      void import("@/lib/security/transactionPinVault").then((m) => {
        void m.saveTransactionPinVault(pin);
      });
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
        setPaymentStatus("IDLE");
        setPayPinUi("idle");
        const to = payRecipientAtPinRef.current ?? recipientRef.current;
        const networkDown =
          e instanceof ApiError &&
          (e.status === 0 ||
            e.status === 502 ||
            e.status === 503 ||
            e.status === 504);
        if (networkDown && to && !to.viaMoneyMessage) {
          payOfflinePendingRef.current = {
            amountFcfa: payPendingAmount,
            recipientName: to.name,
            recipientPhone: to.phoneDigits || null,
            recipientAccountId: to.accountId ?? null,
            pin,
          };
          setPayOutcomeSheet({
            kind: "offline_offer",
            amountFcfa: payPendingAmount,
            recipientName: to.name,
          });
          return;
        }
        setPayOutcomeSheet({
          kind: "error",
          title:
            payRecipientAtPinRef.current?.viaMoneyMessage ||
            spendCategoryRef.current === "other"
              ? t("pay.transferTitle")
              : t("pay.paymentTitle"),
          message:
            e instanceof ApiError ? e.message : t("common.genericError"),
          recipientName: to?.name,
        });
      }
    }
  },
    [
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
      resolveRegularConversation,
    ],
  );

  useEffect(() => {
    confirmPayWithPinRef.current = confirmPayWithPin;
  }, [confirmPayWithPin]);

  const dismissPayOutcomeSheet = useCallback(() => {
    payOfflinePendingRef.current = null;
    setPayOutcomeSheet(null);
    setPayAmountFcfa(null);
    setAmountPadResetSeq((n) => n + 1);
  }, []);

  const confirmOfflinePay = useCallback(async () => {
    const pending = payOfflinePendingRef.current;
    if (!pending) {
      dismissPayOutcomeSheet();
      return;
    }
    payOfflinePendingRef.current = null;
    try {
      const queue = await import("@/lib/offline/queue");
      await queue.enqueueOfflineOp("pay", {
        amountFcfa: pending.amountFcfa,
        recipientName: pending.recipientName,
        recipientPhone: pending.recipientPhone,
        recipientAccountId: pending.recipientAccountId,
        transactionPin: pending.pin,
      });
      void import("@/lib/security/transactionPinVault").then((m) => {
        void m.saveTransactionPinVault(pending.pin);
      });
      setPayOutcomeSheet({
        kind: "offline_queued",
        amountFcfa: pending.amountFcfa,
        recipientName: pending.recipientName,
      });
    } catch {
      setPayOutcomeSheet({
        kind: "error",
        title: t("pay.paymentTitle"),
        message: t("common.genericError"),
        recipientName: pending.recipientName,
      });
    }
  }, [dismissPayOutcomeSheet, t]);

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
                        <PeerAvatar
                          name={recipient.name}
                          phone={recipient.phoneDigits}
                          localUri={contactPhotoUriForPhone(recipient.phoneDigits)}
                          size={52}
                        />
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
                        style={[
                          styles.driverName,
                          (bleStatus === "denied" ||
                            bleStatus === "powered_off") && {
                            color: colors.text,
                          },
                        ]}
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
                /** Identité stable + seq (fermeture feuille → vide le pad sans refresh JWT). */
                resetKey={`${user?.personalAccountId ?? user?.phone ?? "anon"}-${amountPadResetSeq}`}
                keypadDisabled={
                  paymentStatus === "SENDING" ||
                  payHandoff ||
                  showRegisterOverlay
                }
                payBusy={paymentStatus === "SENDING" || payHandoff}
                onPay={handlePay}
                onAmountFcfaChange={setPayAmountFcfa}
                topUpSuccessMessage={topUpSuccessMessage}
                balanceFcfa={user && balance <= 1000 ? balance : null}
                quickAmounts={quickAmounts}
                belowQuickAmounts={regularsRow}
                amountLabel={selectedRegularLabel}
                amountFooter={
                  <Pressable
                    style={styles.receiveNearbyRow}
                    onPress={() => {
                      if (receiveBroadcast.busy || payHandoff) return;
                      void onReceiveNearbyToggle(!receiveBroadcast.on);
                    }}
                    disabled={receiveBroadcast.busy || payHandoff}
                    accessibilityRole="switch"
                    accessibilityState={{
                      checked: receiveBroadcast.on,
                      disabled: receiveBroadcast.busy || payHandoff,
                    }}
                    accessibilityLabel={t("pay.receiveNearbyLabel")}
                    hitSlop={8}
                  >
                    {receiveBroadcast.busy || payHandoff ? (
                      <ActivityIndicator color={colors.accent} size="small" />
                    ) : (
                      <ReceiveNearbyGlyph
                        color={
                          receiveBroadcast.on
                            ? colors.accent
                            : colors.textMuted
                        }
                        size={30}
                      />
                    )}
                  </Pressable>
                }
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
              animationType={modalPresentation}
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
              animationType={modalPresentation}
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
                    i18nKey={
                      payRecipientAtPinRef.current?.viaMoneyMessage ||
                      spendCategory === "other"
                        ? "pay.pinConfirmTransfer"
                        : "pay.pinConfirmPayment"
                    }
                    values={{
                      amount: formatFcfa(payPendingAmount),
                      name:
                        payRecipientAtPinRef.current?.name ??
                        recipient?.name ??
                        t("ble.driverDefaultName"),
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

          {depositChrome && pathname !== "/deposit" ? (
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
              onConfirmOfflinePay={confirmOfflinePay}
            />
          ) : null}

          {receivedFlash ? (
            <IncomingPaymentFlashSheet
              amountFcfa={receivedFlash.amountFcfa}
              onDismiss={dismissReceivedFlash}
              copy="transfer"
            />
          ) : null}
      </View>
    </View>
  );
}
