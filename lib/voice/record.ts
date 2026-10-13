/** Enregistrement vocal — import à la demande, hors Pay. */

export const VOICE_MAX_MS = 60_000;

export function formatVoiceClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export type VoiceRecorder = {
  start: () => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  stop: () => Promise<{ uri: string; durationMs: number } | null>;
  discard: () => Promise<void>;
};

async function loadAv() {
  return import("expo-av");
}

function recOptions(Audio: typeof import("expo-av").Audio) {
  return {
    android: {
      extension: ".m4a",
      outputFormat: Audio.AndroidOutputFormat.MPEG_4,
      audioEncoder: Audio.AndroidAudioEncoder.AAC,
      sampleRate: 22050,
      numberOfChannels: 1,
      bitRate: 32000,
    },
    ios: {
      extension: ".m4a",
      audioQuality: Audio.IOSAudioQuality.MEDIUM,
      sampleRate: 22050,
      numberOfChannels: 1,
      bitRate: 32000,
    },
    web: {},
  };
}

/**
 * À chaque tap : dialogue système Autoriser / Refuser.
 * On ne court-circuite jamais après un refus (pas de check préalable).
 * Si l’OS masque la feuille (2ᵉ refus / MIUI), on rouvre l’écran permissions système.
 */
export async function requestMicPermission(): Promise<boolean> {
  const { PermissionsAndroid, Platform } = await import("react-native");
  if (Platform.OS === "android") {
    const perm = PermissionsAndroid.PERMISSIONS.RECORD_AUDIO;
    const started = Date.now();
    const result = await PermissionsAndroid.request(perm);
    if (result === PermissionsAndroid.RESULTS.GRANTED) return true;
    // Refus visible : on s’arrête. Prochain tap = nouveau request().
    // Feuille masquée par l’OS (retour immédiat) : écran permissions système.
    if (Date.now() - started < 320) await openAndroidMicPrompt();
    return (await PermissionsAndroid.check(perm)) === true;
  }
  const { Audio } = await loadAv();
  const perm = await Audio.requestPermissionsAsync();
  return perm.granted === true;
}

async function openAndroidMicPrompt(): Promise<void> {
  const Constants = (await import("expo-constants")).default;
  const pkg =
    Constants.expoConfig?.android?.package ?? "com.haroldndougou.blyp";
  const IntentLauncher = await import("expo-intent-launcher");
  try {
    await IntentLauncher.startActivityAsync("miui.intent.action.APP_PERM_EDITOR", {
      extra: { extra_pkgname: pkg },
    });
    return;
  } catch {
    /* pas MIUI */
  }
  try {
    await IntentLauncher.startActivityAsync(
      IntentLauncher.ActivityAction.APPLICATION_DETAILS_SETTINGS,
      { data: `package:${pkg}` },
    );
  } catch {
    const { Linking } = await import("react-native");
    await Linking.openSettings();
  }
}

export async function createVoiceRecorder(): Promise<VoiceRecorder> {
  const { Audio } = await loadAv();
  await Audio.setAudioModeAsync({
    allowsRecordingIOS: true,
    playsInSilentModeIOS: true,
    staysActiveInBackground: false,
    shouldDuckAndroid: true,
    playThroughEarpieceAndroid: false,
  });
  const rec = new Audio.Recording();
  let prepared = false;

  return {
    async start() {
      if (!prepared) {
        await rec.prepareToRecordAsync(recOptions(Audio));
        prepared = true;
      }
      await rec.startAsync();
    },
    async pause() {
      await rec.pauseAsync();
    },
    async resume() {
      await rec.startAsync();
    },
    async stop() {
      try {
        const status = await rec.getStatusAsync();
        await rec.stopAndUnloadAsync();
        const uri = rec.getURI();
        const durationMs = Math.min(
          VOICE_MAX_MS,
          Math.floor(Number(status.durationMillis) || 0),
        );
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: false,
          playsInSilentModeIOS: true,
          shouldDuckAndroid: true,
        });
        if (!uri || durationMs < 400) return null;
        return { uri, durationMs };
      } catch {
        return null;
      }
    },
    async discard() {
      try {
        const st = await rec.getStatusAsync();
        if (st.canRecord || st.isRecording) {
          await rec.stopAndUnloadAsync();
        }
      } catch {
        /* already unloaded */
      }
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
      });
    },
  };
}
