import * as FileSystem from "expo-file-system";

let cachedUrl = "";
let cachedBase64: string | null = null;

export function invalidateQuickPayNotifAvatarCache(): void {
  cachedUrl = "";
  cachedBase64 = null;
}

/** JPEG/PNG en base64 (sans préfixe data:) pour RemoteViews Android. */
export async function avatarBase64ForQuickPayNotif(
  url: string | null | undefined,
): Promise<string | null> {
  const u = url?.trim();
  if (!u) return null;
  if (u === cachedUrl && cachedBase64) return cachedBase64;
  try {
    const dest = `${FileSystem.cacheDirectory ?? ""}blyp-qp-merchant.jpg`;
    const { uri } = await FileSystem.downloadAsync(u, dest);
    const b64 = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    cachedUrl = u;
    cachedBase64 = b64?.length ? b64 : null;
    return cachedBase64;
  } catch {
    return null;
  }
}

export function merchantInitialsFromName(name: string | null | undefined): string {
  const parts = (name ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 1).toUpperCase();
  return (parts[0]!.slice(0, 1) + parts[parts.length - 1]!.slice(0, 1)).toUpperCase();
}
