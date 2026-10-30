import FS from "@/lib/voice/fileSystemLegacy";
import {
  noteMediaCacheHit,
  noteMediaCacheWrite,
} from "@/lib/media/lruDiskCache";

const DIR = `${FS.cacheDirectory}blyp-doc/`;

function safeKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

export async function peekDocumentCache(key: string): Promise<string | null> {
  const dest = `${DIR}${safeKey(key)}`;
  const info = await FS.getInfoAsync(dest);
  if (info.exists) {
    noteMediaCacheHit(dest);
    return dest;
  }
  return null;
}

/** Télécharge un PDF S3 signé dans le cache local (lecture + vignette). */
export async function cacheDocumentFile(
  key: string,
  remoteUrl: string,
): Promise<string> {
  const dirInfo = await FS.getInfoAsync(DIR);
  if (!dirInfo.exists) {
    await FS.makeDirectoryAsync(DIR, { intermediates: true });
  }
  const dest = `${DIR}${safeKey(key)}`;
  const existing = await FS.getInfoAsync(dest);
  if (existing.exists) {
    noteMediaCacheHit(dest);
    return dest;
  }
  const dl = await FS.downloadAsync(remoteUrl, dest);
  await noteMediaCacheWrite(dl.uri, "doc");
  return dl.uri;
}
