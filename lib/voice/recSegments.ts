import { base64ToBytes, bytesToBase64 } from "@/lib/ble/base64";
import FS from "@/lib/voice/fileSystem";
import { normalizeVoiceFileUri } from "@/lib/voice/recDraftPreview";

export type VoiceClipSegment = { uri: string; durationMs: number };

/** Assemble les segments (pause / reprise) en un seul fichier pour l’envoi. */
export async function mergeVoiceSegmentsForSend(
  segments: VoiceClipSegment[],
): Promise<VoiceClipSegment | null> {
  const parts = segments.filter((s) => String(s.uri ?? "").trim() && s.durationMs > 0);
  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0];

  const dir = `${FS.cacheDirectory}blyp-voice/`;
  const dirInfo = await FS.getInfoAsync(dir);
  if (!dirInfo.exists) {
    await FS.makeDirectoryAsync(dir, { intermediates: true });
  }
  const out = `${dir}merged-${Date.now()}.m4a`;

  const byteChunks: Uint8Array[] = [];
  let totalLen = 0;
  for (const p of parts) {
    const b64 = await FS.readAsStringAsync(normalizeVoiceFileUri(p.uri), {
      encoding: FS.EncodingType.Base64,
    });
    const bytes = base64ToBytes(b64);
    if (!bytes?.length) {
      throw new Error("voice_segment_read_failed");
    }
    byteChunks.push(bytes);
    totalLen += bytes.length;
  }

  const merged = new Uint8Array(totalLen);
  let offset = 0;
  for (const chunk of byteChunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }

  await FS.writeAsStringAsync(out, bytesToBase64(merged), {
    encoding: FS.EncodingType.Base64,
  });
  const durationMs = parts.reduce((a, p) => a + p.durationMs, 0);
  return { uri: out, durationMs };
}
