/** Un seul player — import expo-av au play seulement. */

export const VOICE_RATES = [1, 1.5, 2] as const;
export type VoiceRate = (typeof VOICE_RATES)[number];

export type VoicePlayStatus = {
  messageId: string | null;
  uri: string | null;
  playing: boolean;
  paused: boolean;
  positionMs: number;
  durationMs: number;
  rate: VoiceRate;
};

type SoundLike = {
  unloadAsync: () => Promise<unknown>;
  stopAsync: () => Promise<unknown>;
  pauseAsync: () => Promise<unknown>;
  playAsync: () => Promise<unknown>;
  setPositionAsync: (ms: number) => Promise<unknown>;
  setRateAsync: (
    rate: number,
    shouldCorrectPitch: boolean,
  ) => Promise<unknown>;
  setOnPlaybackStatusUpdate: (
    cb: (st: {
      isLoaded: boolean;
      didJustFinish?: boolean;
      isPlaying?: boolean;
      positionMillis?: number;
      durationMillis?: number;
    }) => void,
  ) => void;
};

const idleStatus = (): VoicePlayStatus => ({
  messageId: null,
  uri: null,
  playing: false,
  paused: false,
  positionMs: 0,
  durationMs: 0,
  rate: currentRate,
});

let current: SoundLike | null = null;
let currentUri = "";
let currentMessageId: string | null = null;
let currentRate: VoiceRate = 1;
let positionMs = 0;
let durationMs = 0;
let playing = false;
let paused = false;
let session = 0;
let lastEmitAt = 0;

const statusListeners = new Set<(s: VoicePlayStatus) => void>();
const finishListeners = new Set<(messageId: string) => void>();

function snapshot(): VoicePlayStatus {
  return {
    messageId: currentMessageId,
    uri: currentUri || null,
    playing,
    paused,
    positionMs,
    durationMs,
    rate: currentRate,
  };
}

function emitStatus(force = false) {
  const now = Date.now();
  if (!force && now - lastEmitAt < 70) return;
  lastEmitAt = now;
  const s = snapshot();
  for (const cb of statusListeners) cb(s);
}

export function getVoiceStatus(): VoicePlayStatus {
  return snapshot();
}

export function subscribeVoiceStatus(
  cb: (s: VoicePlayStatus) => void,
): () => void {
  statusListeners.add(cb);
  cb(snapshot());
  return () => {
    statusListeners.delete(cb);
  };
}

export function subscribeVoiceFinished(
  cb: (messageId: string) => void,
): () => void {
  finishListeners.add(cb);
  return () => {
    finishListeners.delete(cb);
  };
}

export function isActiveMessage(id: string): boolean {
  return current != null && currentMessageId === id;
}

export function getVoiceRate(): VoiceRate {
  return currentRate;
}

async function applyRate(sound: SoundLike, rate: VoiceRate) {
  try {
    await sound.setRateAsync(rate, true);
  } catch {
    try {
      await sound.setRateAsync(rate, false);
    } catch {
      /* ignore */
    }
  }
}

export async function stopVoice(): Promise<void> {
  session += 1;
  const s = current;
  current = null;
  currentUri = "";
  currentMessageId = null;
  playing = false;
  paused = false;
  positionMs = 0;
  durationMs = 0;
  emitStatus(true);
  if (!s) return;
  try {
    await s.stopAsync();
  } catch {
    /* ignore */
  }
  try {
    await s.unloadAsync();
  } catch {
    /* ignore */
  }
}

export async function pauseVoice(): Promise<void> {
  if (!current || !playing) return;
  try {
    await current.pauseAsync();
  } catch {
    return;
  }
  playing = false;
  paused = true;
  emitStatus(true);
}

export async function resumeVoice(): Promise<void> {
  if (!current || !paused) return;
  try {
    await current.playAsync();
  } catch {
    return;
  }
  playing = true;
  paused = false;
  emitStatus(true);
}

export async function toggleActiveVoice(): Promise<void> {
  if (playing) {
    await pauseVoice();
    return;
  }
  if (paused) await resumeVoice();
}

export async function seekVoice(ms: number): Promise<void> {
  if (!current) return;
  const cap = durationMs > 0 ? durationMs : ms;
  const next = Math.max(0, Math.min(ms, cap));
  positionMs = next;
  emitStatus(true);
  try {
    await current.setPositionAsync(next);
  } catch {
    /* ignore */
  }
}

export async function setVoiceRate(rate: VoiceRate): Promise<void> {
  currentRate = rate;
  if (current) await applyRate(current, rate);
  emitStatus(true);
}

export function cycleVoiceRate(): VoiceRate {
  const i = VOICE_RATES.indexOf(currentRate);
  const next = VOICE_RATES[(i + 1) % VOICE_RATES.length] ?? 1;
  void setVoiceRate(next);
  return next;
}

let engineWarmed = false;

/** Après ouverture d’un fil avec vocaux — pas le splash / Pay. */
export async function warmVoiceEngine(): Promise<void> {
  if (engineWarmed) return;
  engineWarmed = true;
  const { Audio } = await import("expo-av");
  await Audio.setAudioModeAsync({
    allowsRecordingIOS: false,
    playsInSilentModeIOS: true,
    shouldDuckAndroid: true,
    playThroughEarpieceAndroid: false,
  });
}

function normalizePlayUri(uri: string): string {
  const u = String(uri ?? "").trim();
  if (!u) return u;
  if (u.startsWith("file://") || u.startsWith("content://")) return u;
  return `file://${u}`;
}

export async function playVoice(
  uri: string,
  opts?: { messageId?: string; durationMs?: number },
): Promise<void> {
  const src = normalizePlayUri(String(uri ?? "").trim());
  if (!src) return;
  if (current && currentUri === src && currentMessageId === (opts?.messageId ?? currentMessageId)) {
    if (paused) {
      await resumeVoice();
      return;
    }
    if (playing) {
      await pauseVoice();
      return;
    }
  }
  await stopVoice();
  const mySession = session;
  const { Audio } = await import("expo-av");
  if (!engineWarmed) {
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true,
      shouldDuckAndroid: true,
      playThroughEarpieceAndroid: false,
    });
    engineWarmed = true;
  }
  const { sound } = await Audio.Sound.createAsync(
    { uri: src },
    {
      shouldPlay: true,
      rate: currentRate,
      shouldCorrectPitch: true,
      progressUpdateIntervalMillis: 80,
    },
  );
  if (mySession !== session) {
    try {
      await sound.unloadAsync();
    } catch {
      /* ignore */
    }
    return;
  }
  current = sound;
  currentUri = src;
  currentMessageId = opts?.messageId ?? null;
  playing = true;
  paused = false;
  positionMs = 0;
  durationMs = opts?.durationMs ?? 0;
  await applyRate(sound, currentRate);
  emitStatus(true);
  sound.setOnPlaybackStatusUpdate((st) => {
    if (mySession !== session) return;
    if (!st.isLoaded) return;
    if (typeof st.positionMillis === "number") positionMs = st.positionMillis;
    if (typeof st.durationMillis === "number" && st.durationMillis > 0) {
      durationMs = st.durationMillis;
    }
    if (st.didJustFinish) {
      const id = currentMessageId;
      void stopVoice().then(() => {
        if (id) {
          for (const cb of finishListeners) cb(id);
        }
      });
      return;
    }
    playing = st.isPlaying === true;
    paused = st.isPlaying === false;
    emitStatus();
  });
}

export function isPlayingUri(uri: string): boolean {
  return current != null && currentUri === uri && playing;
}
