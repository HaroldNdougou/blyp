export function normalizeVoiceFileUri(uri: string): string {
  const u = String(uri ?? "").trim();
  if (!u) return u;
  if (u.startsWith("file://") || u.startsWith("content://")) return u;
  return `file://${u}`;
}
