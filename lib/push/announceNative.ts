import { resolveAppLanguage } from "@/lib/i18n/locale";
import { Platform } from "react-native";

type PaymentAnnounceNative = {
  setEnabled: (enabled: boolean) => Promise<void>;
  setLanguage: (lang: string) => Promise<void>;
  setActiveConversation?: (conversationId: string | null) => Promise<void>;
  announce: (
    amountFcfa: number,
    lang: string,
    txId: string | null,
  ) => Promise<void>;
};

function module(): PaymentAnnounceNative | null {
  if (Platform.OS !== "android") return null;
  const mod = (
    require("react-native").NativeModules as {
      BlypPaymentAnnounce?: PaymentAnnounceNative;
    }
  ).BlypPaymentAnnounce;
  return mod ?? null;
}

/** SecureStore → SharedPreferences natif (lecture sync au push FCM). */
export async function syncAnnouncePrefNative(
  enabled: boolean,
  lang?: string,
): Promise<void> {
  const native = module();
  if (!native?.setEnabled) return;
  await native.setEnabled(enabled);
  await native.setLanguage?.(lang ?? resolveAppLanguage());
}

export async function setActiveConversationNative(
  conversationId: string | null,
): Promise<void> {
  const native = module();
  if (!native?.setActiveConversation) return;
  await native.setActiveConversation(conversationId);
}

export async function announcePaymentNative(opts: {
  amountFcfa: number;
  txId?: string;
  lang?: string;
}): Promise<void> {
  const native = module();
  if (!native?.announce) return;
  await native.announce(
    opts.amountFcfa,
    opts.lang ?? resolveAppLanguage(),
    opts.txId?.trim() || null,
  );
}
