/** APK / page de téléchargement (en attendant Play Store / App Store). */
export const BLYP_APP_DOWNLOAD_URL =
  "https://blyppay.com/download/blyp-pay.apk";

export function resolveBlypInviteDownloadUrl(
  override?: string | null,
): string {
  const custom = override?.trim();
  return (custom || BLYP_APP_DOWNLOAD_URL).replace(/\/$/, "");
}
