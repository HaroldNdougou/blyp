/**
 * Assets via CDN (point 9) — CloudFront quand EXPO_PUBLIC_ASSETS_CDN_URL est défini.
 */
import Constants from "expo-constants";

function readCdnBase(): string {
  const extra = Constants.expoConfig?.extra as
    | { EXPO_PUBLIC_ASSETS_CDN_URL?: string }
    | undefined;
  const fromExtra = extra?.EXPO_PUBLIC_ASSETS_CDN_URL?.trim() ?? "";
  const fromEnv = process.env.EXPO_PUBLIC_ASSETS_CDN_URL?.trim() ?? "";
  return (fromExtra || fromEnv).replace(/\/$/, "");
}

const CDN_BASE = readCdnBase();

/** URL absolue d’un asset (avatar, etc.). Sans CDN → uri tel quel / null. */
export function assetUrl(pathOrUrl: string | null | undefined): string | null {
  if (!pathOrUrl) return null;
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  if (!CDN_BASE) return null;
  const path = pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`;
  return `${CDN_BASE}${path}`;
}

export function hasAssetsCdn(): boolean {
  return CDN_BASE.length > 0;
}
