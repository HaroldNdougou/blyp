import FS from "@/lib/voice/fileSystem";

const DIR = `${FS.cacheDirectory}blyp-doc-thumb-remote/`;

function safeKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

export async function peekRemoteDocumentThumb(key: string): Promise<string | null> {
  const dest = `${DIR}${safeKey(key)}.jpg`;
  const info = await FS.getInfoAsync(dest);
  return info.exists ? dest : null;
}

/** Télécharge la vignette S3 (léger) — pas le PDF entier. */
export async function cacheRemoteDocumentThumb(
  key: string,
  remoteUrl: string,
): Promise<string> {
  const dirInfo = await FS.getInfoAsync(DIR);
  if (!dirInfo.exists) {
    await FS.makeDirectoryAsync(DIR, { intermediates: true });
  }
  const dest = `${DIR}${safeKey(key)}.jpg`;
  const existing = await FS.getInfoAsync(dest);
  if (existing.exists) return dest;
  const dl = await FS.downloadAsync(remoteUrl, dest);
  return dl.uri;
}

export async function resolveRemoteDocumentThumbUri(
  token: string,
  conversationId: string,
  thumbKey: string,
): Promise<string | null> {
  const k = String(thumbKey ?? "").trim();
  if (!k) return null;
  const hit = await peekRemoteDocumentThumb(k);
  if (hit) return hit;
  const { presignDocumentThumbDownload } = await import("@/lib/api/client");
  const { url } = await presignDocumentThumbDownload(token, conversationId, k);
  return cacheRemoteDocumentThumb(k, url);
}
