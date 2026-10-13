/** Retours sonores messages — expo-av lazy, hors chemin Pay. */

export type ChatSoundId =
  | "recordStart"
  | "recordStop"
  | "sent"
  | "incomingInChat"
  | "incomingList";

const SOURCES: Record<ChatSoundId, number> = {
  recordStart: require("../../assets/sounds/msg-record-start.wav"),
  recordStop: require("../../assets/sounds/msg-record-stop.wav"),
  sent: require("../../assets/sounds/msg-sent.wav"),
  incomingInChat: require("../../assets/sounds/msg-in-chat.wav"),
  incomingList: require("../../assets/sounds/msg-in-list.wav"),
};

const FALLBACK_MS = 900;
let avPromise: Promise<typeof import("expo-av")> | null = null;
let lastModeRecording: boolean | null = null;

function loadAv() {
  avPromise ??= import("expo-av");
  return avPromise;
}

async function ensurePlaybackMode(
  Audio: typeof import("expo-av").Audio,
  keepRecording: boolean,
) {
  if (lastModeRecording === keepRecording) return;
  try {
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: keepRecording,
      playsInSilentModeIOS: true,
      staysActiveInBackground: false,
      shouldDuckAndroid: true,
      playThroughEarpieceAndroid: false,
    });
    lastModeRecording = keepRecording;
  } catch {
    /* ignore */
  }
}

export type PlayChatSoundOpts = {
  /** Pendant un enregistrement vocal — ne pas couper le micro iOS. */
  keepRecording?: boolean;
};

/** Précharge le module audio quand l’onglet Messages est probable. */
export function prefetchChatSounds(): void {
  void loadAv();
}

export function playChatSound(
  id: ChatSoundId,
  opts?: PlayChatSoundOpts,
): void {
  void (async () => {
    const { Audio } = await loadAv();
    await ensurePlaybackMode(Audio, opts?.keepRecording === true);
    const { sound } = await Audio.Sound.createAsync(SOURCES[id], {
      shouldPlay: true,
      volume: 0.88,
      isMuted: false,
    });
    const done = () => {
      void sound.unloadAsync().catch(() => {});
    };
    sound.setOnPlaybackStatusUpdate((st) => {
      if (st.isLoaded && st.didJustFinish) done();
    });
    setTimeout(done, FALLBACK_MS);
  })().catch(() => {});
}
