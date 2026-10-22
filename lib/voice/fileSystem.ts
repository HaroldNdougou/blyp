/**
 * expo-file-system — chargement async (micro / cache vocal, pas au parse du fil).
 */
type FS = typeof import("expo-file-system/legacy");

let cached: FS | null = null;

export async function getVoiceFileSystem(): Promise<FS> {
  if (!cached) {
    cached = await import("expo-file-system/legacy");
  }
  return cached;
}
