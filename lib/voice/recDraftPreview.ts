/** Lecture aperçu vocal avant envoi — hors player global du fil. */

import { normalizeVoiceFileUri } from "@/lib/voice/voiceFileUri";

export { normalizeVoiceFileUri };

async function setVoiceRecordingAudioMode(recording: boolean): Promise<void> {
  const { setVoiceRecordingAudioMode: setMode } = await import(
    "@/lib/voice/record"
  );
  await setMode(recording);
}

export type RecDraftPreviewStatus = {
  playing: boolean;
  positionMs: number;
  durationMs: number;
};

const idle = (): RecDraftPreviewStatus => ({
  playing: false,
  positionMs: 0,
  durationMs: 0,
});

let session = 0;
let sound: {
  unloadAsync: () => Promise<unknown>;
  pauseAsync: () => Promise<unknown>;
  playAsync: () => Promise<unknown>;
  setOnPlaybackStatusUpdate: (
    cb: (st: {
      isLoaded: boolean;
      isPlaying?: boolean;
      positionMillis?: number;
      durationMillis?: number;
      didJustFinish?: boolean;
    }) => void,
  ) => void;
} | null = null;

let playing = false;
let positionMs = 0;
let durationMs = 0;

const listeners = new Set<(s: RecDraftPreviewStatus) => void>();

function emit() {
  const s = { playing, positionMs, durationMs };
  for (const cb of listeners) cb(s);
}

export function subscribeRecDraftPreview(
  cb: (s: RecDraftPreviewStatus) => void,
): () => void {
  listeners.add(cb);
  cb({ playing, positionMs, durationMs });
  return () => listeners.delete(cb);
}

export function getRecDraftPreviewStatus(): RecDraftPreviewStatus {
  return { playing, positionMs, durationMs };
}

export async function copyDraftRecordingPreview(
  sourceUri: string,
): Promise<string> {
  const FS = await import("@/lib/voice/fileSystem").then((m) =>
    m.getVoiceFileSystem(),
  );
  const from = normalizeVoiceFileUri(sourceUri);
  const dir = `${FS.cacheDirectory}blyp-voice/`;
  const dirInfo = await FS.getInfoAsync(dir);
  if (!dirInfo.exists) {
    await FS.makeDirectoryAsync(dir, { intermediates: true });
  }
  const dest = `${dir}draft-preview-${Date.now()}.m4a`;
  await FS.copyAsync({ from, to: dest });
  return dest;
}

export async function stopRecDraftPreview(): Promise<void> {
  session += 1;
  const s = sound;
  sound = null;
  playing = false;
  positionMs = 0;
  durationMs = 0;
  emit();
  if (!s) return;
  try {
    await s.unloadAsync();
  } catch {
    /* ignore */
  }
}

export async function toggleRecDraftPreview(
  uri: string,
  hintDurationMs: number,
): Promise<void> {
  const src = normalizeVoiceFileUri(uri);
  if (!src) return;

  if (sound && playing) {
    try {
      await sound.pauseAsync();
    } catch {
      /* ignore */
    }
    playing = false;
    emit();
    return;
  }

  if (sound && !playing) {
    await setVoiceRecordingAudioMode(false);
    try {
      await sound.playAsync();
      playing = true;
      emit();
    } catch {
      await stopRecDraftPreview();
      throw new Error("draft_resume_failed");
    }
    return;
  }

  await stopRecDraftPreview();
  const mySession = session;
  await setVoiceRecordingAudioMode(false);
  const { Audio } = await import("expo-av");
  const { sound: created } = await Audio.Sound.createAsync(
    { uri: src },
    {
      shouldPlay: true,
      progressUpdateIntervalMillis: 80,
    },
  );
  if (mySession !== session) {
    try {
      await created.unloadAsync();
    } catch {
      /* ignore */
    }
    return;
  }
  sound = created;
  playing = true;
  positionMs = 0;
  durationMs = hintDurationMs > 0 ? hintDurationMs : 0;
  emit();
  created.setOnPlaybackStatusUpdate((st) => {
    if (mySession !== session || !st.isLoaded) return;
    if (typeof st.positionMillis === "number") positionMs = st.positionMillis;
    if (typeof st.durationMillis === "number" && st.durationMillis > 0) {
      durationMs = st.durationMillis;
    }
    playing = st.isPlaying === true;
    if (st.didJustFinish) {
      void stopRecDraftPreview().then(() =>
        setVoiceRecordingAudioMode(true),
      );
      return;
    }
    emit();
  });
}
