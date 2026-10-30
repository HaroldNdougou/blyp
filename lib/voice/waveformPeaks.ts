/** Pics d’amplitude réels (decode natif offline) — cache RAM, pas de zigzag factice. */

import { InteractionManager } from "react-native";

export const VOICE_WAVE_BAR_COUNT = 34;
const MIN_BAR = 3;
const MAX_BAR = 18;

const cache = new Map<string, number[]>();
const inflight = new Map<string, Promise<number[]>>();
const listeners = new Map<string, Set<() => void>>();

function notify(key: string) {
  const set = listeners.get(key);
  if (!set) return;
  for (const cb of set) cb();
}

export function voiceWaveformCacheKey(
  voiceKey: string | undefined | null,
  messageId: string,
): string {
  const k = String(voiceKey ?? "").trim();
  if (k) return k;
  return `local:${messageId}`;
}

/** Placeholder neutre tant que le fichier n’est pas analysé. */
export function flatVoiceWaveformHeights(
  count = VOICE_WAVE_BAR_COUNT,
): number[] {
  return Array.from({ length: count }, () => 4);
}

function peaksToHeights(peaks: number[]): number[] {
  return peaks.map((p) => MIN_BAR + Math.max(0, Math.min(1, p)) * (MAX_BAR - MIN_BAR));
}

export function getCachedVoiceWaveformHeights(
  cacheKey: string,
): number[] | null {
  return cache.get(cacheKey) ?? null;
}

export function subscribeVoiceWaveform(
  cacheKey: string,
  cb: () => void,
): () => void {
  let set = listeners.get(cacheKey);
  if (!set) {
    set = new Set();
    listeners.set(cacheKey, set);
  }
  set.add(cb);
  return () => {
    set?.delete(cb);
    if (set && set.size === 0) listeners.delete(cacheKey);
  };
}

export function migrateVoiceWaveformCache(fromKey: string, toKey: string): void {
  const from = String(fromKey ?? "").trim();
  const to = String(toKey ?? "").trim();
  if (!from || !to || from === to) return;
  const heights = cache.get(from);
  if (heights && !cache.has(to)) {
    cache.set(to, heights);
    notify(to);
  }
}

export async function ensureVoiceWaveformPeaks(
  cacheKey: string,
  uri: string,
  count = VOICE_WAVE_BAR_COUNT,
): Promise<number[]> {
  const key = String(cacheKey ?? "").trim();
  const src = String(uri ?? "").trim();
  if (!key || !src) return flatVoiceWaveformHeights(count);

  const hit = cache.get(key);
  if (hit) return hit;

  const pending = inflight.get(key);
  if (pending) return pending;

  const job = (async () => {
    const { extractWaveform } = await import("expo-audio-waveform");
    const peaks = await extractWaveform(src, {
      samples: count,
      metric: "rms",
    });
    const heights = peaksToHeights(peaks);
    cache.set(key, heights);
    notify(key);
    return heights;
  })()
    .catch(() => {
      const flat = flatVoiceWaveformHeights(count);
      cache.set(key, flat);
      notify(key);
      return flat;
    })
    .finally(() => {
      inflight.delete(key);
    });

  inflight.set(key, job);
  return job;
}

export function prefetchVoiceWaveform(
  cacheKey: string,
  uri: string,
  count = VOICE_WAVE_BAR_COUNT,
): void {
  const key = String(cacheKey ?? "").trim();
  const src = String(uri ?? "").trim();
  if (!key || !src || cache.has(key)) return;
  InteractionManager.runAfterInteractions(() => {
    void ensureVoiceWaveformPeaks(key, src, count);
  });
}
