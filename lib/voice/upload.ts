/** PUT signé S3 — FileSystem, hors chemin Pay. */

import { getVoiceFileSystem } from "@/lib/voice/fileSystem";

export async function uploadVoiceFile(
  uploadUrl: string,
  localUri: string,
): Promise<void> {
  if (uploadUrl.startsWith("mock://")) return;
  const FS = await getVoiceFileSystem();
  const result = await FS.uploadAsync(uploadUrl, localUri, {
    httpMethod: "PUT",
    headers: { "Content-Type": "audio/mp4" },
    uploadType: FS.FileSystemUploadType.BINARY_CONTENT,
  });
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`upload ${result.status}`);
  }
}

export async function cacheVoiceFile(
  key: string,
  remoteUrl: string,
): Promise<string> {
  const FS = await getVoiceFileSystem();
  const dir = `${FS.cacheDirectory}blyp-voice/`;
  const info = await FS.getInfoAsync(dir);
  if (!info.exists) {
    await FS.makeDirectoryAsync(dir, { intermediates: true });
  }
  const safe = key.replace(/[^a-zA-Z0-9._-]+/g, "_");
  const dest = `${dir}${safe}`;
  const existing = await FS.getInfoAsync(dest);
  if (existing.exists) return dest;
  const dl = await FS.downloadAsync(remoteUrl, dest);
  return dl.uri;
}
