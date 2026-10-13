/** Disque d’abord — réseau seulement si le vocal n’est pas déjà là. */

import FS from "@/lib/voice/fileSystem";
import { cacheVoiceFile } from "@/lib/voice/upload";

const inflight = new Map<string, Promise<string>>();

function safeKey(key: string): string {
  return String(key ?? "").replace(/[^a-zA-Z0-9._-]+/g, "_");
}

async function destFor(key: string): Promise<string | null> {
  const k = safeKey(key);
  if (!k) return null;
  const dir = `${FS.cacheDirectory}blyp-voice/`;
  return `${dir}${k}`;
}

export async function peekVoiceCache(key: string): Promise<string | null> {
  const dest = await destFor(key);
  if (!dest) return null;
  const info = await FS.getInfoAsync(dest);
  return info.exists ? dest : null;
}

export async function voiceUriExists(uri: string): Promise<boolean> {
  const src = String(uri ?? "").trim();
  if (!src) return false;
  try {
    const info = await FS.getInfoAsync(src);
    return Boolean(info.exists);
  } catch {
    return false;
  }
}

export async function copyVoiceIntoCache(
  key: string,
  localUri: string,
): Promise<string> {
  const hit = await peekVoiceCache(key);
  if (hit) return hit;
  const dest = await destFor(key);
  const src = String(localUri ?? "").trim();
  if (!dest || !src) return src;
  const dir = `${FS.cacheDirectory}blyp-voice/`;
  const dirInfo = await FS.getInfoAsync(dir);
  if (!dirInfo.exists) {
    await FS.makeDirectoryAsync(dir, { intermediates: true });
  }
  await FS.copyAsync({ from: src, to: dest });
  return dest;
}

/** Presign + download seulement si le fichier n’est pas en cache. */
export async function ensureVoiceCached(
  token: string,
  conversationId: string,
  key: string,
): Promise<string> {
  const k = String(key ?? "").trim();
  if (!k) return "";
  const hit = await peekVoiceCache(k);
  if (hit) return hit;
  const pending = inflight.get(k);
  if (pending) return pending;
  const job = (async () => {
    const api = await import("@/lib/api/client");
    const { url } = await api.presignVoicePlay(token, conversationId, k);
    if (!url) return "";
    return cacheVoiceFile(k, url);
  })()
    .catch(() => "")
    .finally(() => {
      inflight.delete(k);
    });
  inflight.set(k, job);
  return job;
}
