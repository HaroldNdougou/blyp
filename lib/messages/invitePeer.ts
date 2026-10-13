import { resolveBlypInviteDownloadUrl } from "@/lib/invite/downloadUrl";
import { e164ToWhatsAppDigits, normalizeContactPhoneE164 } from "@/lib/phone/e164";
import Constants from "expo-constants";
import { Linking, Share } from "react-native";

function readInviteUrl(): string {
  const extra = Constants.expoConfig?.extra as
    | { EXPO_PUBLIC_INVITE_URL?: string }
    | undefined;
  const fromExtra = extra?.EXPO_PUBLIC_INVITE_URL?.trim() ?? "";
  const fromEnv = process.env.EXPO_PUBLIC_INVITE_URL?.trim() ?? "";
  return resolveBlypInviteDownloadUrl(fromExtra || fromEnv || null);
}

/** Ouvre WhatsApp avec texte d’invitation (wa.me), sinon partage natif. */
export async function invitePeerOnWhatsApp(
  phone: string,
  message: string,
): Promise<void> {
  const e164 =
    phone.startsWith("+") ? phone : normalizeContactPhoneE164(phone);
  const waDigits = e164 ? e164ToWhatsAppDigits(e164) : phone.replace(/\D/g, "");
  const url = `https://wa.me/${waDigits}?text=${encodeURIComponent(message)}`;
  try {
    const can = await Linking.canOpenURL(url);
    if (can) {
      await Linking.openURL(url);
      return;
    }
  } catch {
    /* fallback */
  }
  await Share.share({ message });
}

export function buildInviteMessage(
  _inviterFirstName: string,
  t: (key: string, opts?: Record<string, string>) => string,
): string {
  const link = readInviteUrl();
  return t("messages.inviteShareText", { link });
}
