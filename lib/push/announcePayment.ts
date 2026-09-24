import type { PaymentReceivedPushData } from "@/lib/push/handleIncoming";
import {
  getAnnouncePaymentsCached,
  hydrateAnnouncePaymentsPref,
} from "@/lib/push/announcePref";
import { AppState, Platform } from "react-native";

let lastAnnouncedTx: string | null = null;
let speaking = false;
let cachedMaleVoice: string | null | undefined;

/** Repli si le callback fin de lecture ne part pas (OEM). Cash ~0,62 s. */
const CASH_SOUND_FALLBACK_MS = 780;
const SPEAK_TIMEOUT_MS = 9000;

/**
 * Cash court + voix montant.
 * Android : natif via FCM (1er plan + arrière-plan) — pas de chemin JS.
 * iOS : expo-speech, 1er plan uniquement (v1).
 */
export async function maybeAnnouncePaymentReceived(
  data: PaymentReceivedPushData,
): Promise<void> {
  if (Platform.OS === "web") return;
  if (Platform.OS === "android") return;

  await hydrateAnnouncePaymentsPref();
  if (!getAnnouncePaymentsCached()) return;
  if (AppState.currentState !== "active") return;

  const amount = Math.floor(Number(data.amountFcfa) || 0);
  if (amount <= 0) return;

  const txId = String(data.transactionId ?? "").trim();
  if (txId && txId === lastAnnouncedTx) return;
  if (speaking) return;

  speaking = true;
  try {
    const [{ default: i18n }, { formatFcfa }, Speech, expoAv] =
      await Promise.all([
        import("@/lib/i18n"),
        import("@/lib/formatFcfa"),
        import("expo-speech"),
        import("expo-av"),
      ]);

    if (!getAnnouncePaymentsCached() || AppState.currentState !== "active") {
      return;
    }

    const amountLabel = formatFcfa(amount);
    const line = i18n.t("push.announcePayment", { amount: amountLabel });
    const lang = i18n.language === "fr" ? "fr-FR" : "en-US";

    try {
      Speech.stop();
    } catch {
      /* ignore */
    }

    const voicePromise = resolveFirmMaleVoice(Speech, lang);

    await armAnnounceAudioSession(expoAv);
    await playCashSound(expoAv.Audio);
    await releaseAnnounceAudioSession(expoAv);

    if (!getAnnouncePaymentsCached() || AppState.currentState !== "active") {
      return;
    }

    const voice = await voicePromise;
    const spoke = await speakWithFallback(Speech, line, lang, voice);
    if (!spoke && __DEV__) {
      console.warn("[announce] TTS failed after fallback", { line, lang });
    }

    if (txId) lastAnnouncedTx = txId;
  } catch (e) {
    if (__DEV__) console.warn("[announce] maybeAnnouncePaymentReceived", e);
  } finally {
    speaking = false;
  }
}

async function armAnnounceAudioSession(
  av: typeof import("expo-av"),
): Promise<void> {
  const { Audio, InterruptionModeAndroid, InterruptionModeIOS } = av;
  try {
    await Audio.setAudioModeAsync({
      playsInSilentModeIOS: true,
      staysActiveInBackground: false,
      shouldDuckAndroid: false,
      playThroughEarpieceAndroid: false,
      interruptionModeAndroid: InterruptionModeAndroid.DoNotMix,
      interruptionModeIOS: InterruptionModeIOS.DoNotMix,
    });
  } catch {
    try {
      await Audio.setAudioModeAsync({
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
        shouldDuckAndroid: false,
        playThroughEarpieceAndroid: false,
      });
    } catch {
      /* ignore */
    }
  }
}

async function releaseAnnounceAudioSession(
  av: typeof import("expo-av"),
): Promise<void> {
  if (Platform.OS !== "android") return;
  const { Audio } = av;
  try {
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true,
      staysActiveInBackground: false,
      shouldDuckAndroid: true,
      playThroughEarpieceAndroid: false,
    });
  } catch {
    /* ignore */
  }
}

async function speakWithFallback(
  Speech: typeof import("expo-speech"),
  line: string,
  lang: string,
  voice: string | null,
): Promise<boolean> {
  const attempt = (voiceId?: string): Promise<boolean> =>
    new Promise((resolve) => {
      let settled = false;
      const finish = (ok: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(ok);
      };
      const timer = setTimeout(() => finish(false), SPEAK_TIMEOUT_MS);
      try {
        Speech.speak(line, {
          language: lang,
          voice: voiceId,
          rate: Platform.OS === "android" ? 1.0 : 1.08,
          pitch: Platform.OS === "android" ? 1.0 : 0.88,
          onDone: () => finish(true),
          onStopped: () => finish(true),
          onError: () => finish(false),
        });
      } catch {
        finish(false);
      }
    });

  if (voice) {
    const ok = await attempt(voice);
    if (ok) return true;
    cachedMaleVoice = null;
  }
  return attempt(undefined);
}

async function playCashSound(
  Audio: typeof import("expo-av").Audio,
): Promise<void> {
  try {
    const { sound } = await Audio.Sound.createAsync(
      require("../../assets/sounds/cash.wav"),
      { shouldPlay: true, volume: 1, isMuted: false },
    );
    try {
      await sound.setVolumeAsync(1);
    } catch {
      /* ignore */
    }
    await new Promise<void>((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        void sound.unloadAsync().catch(() => {});
        resolve();
      };
      sound.setOnPlaybackStatusUpdate((st) => {
        if (!st.isLoaded) return;
        if (st.didJustFinish) done();
      });
      setTimeout(done, CASH_SOUND_FALLBACK_MS);
    });
  } catch {
    /* son optionnel */
  }
}

async function resolveFirmMaleVoice(
  Speech: typeof import("expo-speech"),
  lang: string,
): Promise<string | null> {
  if (cachedMaleVoice !== undefined) return cachedMaleVoice;
  try {
    const voices = await Speech.getAvailableVoicesAsync();
    const prefix = lang.slice(0, 2).toLowerCase();
    const pool = voices.filter((v) =>
      String(v.language ?? "")
        .toLowerCase()
        .startsWith(prefix),
    );
    const male =
      pool.find((v) =>
        /male|homme|masculine|#male|fr-fr-x-frm|en-us-x-iom|en-gb-x-gbm/i.test(
          `${v.name} ${v.identifier}`,
        ),
      ) ??
      pool.find((v) => /frm|male/i.test(String(v.identifier))) ??
      null;
    cachedMaleVoice = male?.identifier ?? null;
  } catch {
    cachedMaleVoice = null;
  }
  return cachedMaleVoice;
}
