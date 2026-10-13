import { assetUrl } from "@/lib/assets/cdn";

/** Clé fichier CDN `avatars/{key}.jpg` (aligné historique / CloudFront). */
export function phoneDigitsForAvatar(
  phone: string | null | undefined,
): string | null {
  const d = String(phone ?? "").replace(/\D/g, "");
  if (!d) return null;
  const nine = d.length >= 9 ? d.slice(-9) : d;
  if (/^6\d{8}$/.test(nine)) return nine;
  if (d.length >= 8 && d.length <= 15) return d;
  return null;
}

export function peerAvatarUrl(phone: string | null | undefined): string | null {
  const key = phoneDigitsForAvatar(phone);
  if (!key) return null;
  return assetUrl(`avatars/${key}.jpg`);
}
