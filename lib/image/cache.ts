import FS from "@/lib/voice/fileSystemLegacy";
import { voiceUriExists } from "@/lib/voice/cache";

function safeKey(key: string): string {
  return String(key ?? "").replace(/[^a-zA-Z0-9._-]+/g, "_");
}

async function destFor(key: string): Promise<string | null> {
  const k = safeKey(key);
  if (!k) return null;
  const dir = `${FS.cacheDirectory}blyp-image/`;
  return `${dir}${k}`;
}

export async function peekImageCache(key: string): Promise<string | null> {
  const dest = await destFor(key);
  if (!dest) return null;
  const info = await FS.getInfoAsync(dest);
  return info.exists ? dest : null;
}

export { voiceUriExists as imageUriExists };

export async function copyImageIntoCache(
  key: string,
  localUri: string,
): Promise<string> {
  const hit = await peekImageCache(key);
  if (hit) return hit;
  const dest = await destFor(key);
  const src = String(localUri ?? "").trim();
  if (!dest || !src) return src;
  const dir = `${FS.cacheDirectory}blyp-image/`;
  const dirInfo = await FS.getInfoAsync(dir);
  if (!dirInfo.exists) {
    await FS.makeDirectoryAsync(dir, { intermediates: true });
  }
  await FS.copyAsync({ from: src, to: dest });
  return dest;
}
