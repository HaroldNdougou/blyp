import { getAccessToken } from "@/lib/auth/authSession";
import { API_BASE_URL, USE_MOCK_API } from "@/lib/config";
import {
  getQuickPayNotifCached,
  hydrateQuickPayNotifPref,
} from "@/lib/pay/quickPayNotifPref";
import {
  clearQuickPayNotifNativeSecrets,
  syncQuickPayNotifNativeSecrets,
} from "@/lib/pay/quickPayNotifNative";
import { loadQuickPayRecipient } from "@/lib/pay/quickPayRecipient";
import {
  hasTransactionPinVault,
  readTransactionPinForNativeQuickPay,
} from "@/lib/security/transactionPinVault";
import { Platform } from "react-native";

/** Alimente le moteur natif (notif sans ouvrir React). */
export async function syncQuickPayNativeRuntime(opts?: {
  pin?: string | null;
  balanceFcfa?: number;
  phone?: string;
}): Promise<void> {
  if (Platform.OS !== "android" || USE_MOCK_API) return;
  await hydrateQuickPayNotifPref();
  if (!getQuickPayNotifCached()) {
    await clearQuickPayNotifNativeSecrets();
    return;
  }
  const token = getAccessToken();
  if (!token) {
    await clearQuickPayNotifNativeSecrets();
    return;
  }
  const recipient = await loadQuickPayRecipient();
  if (!recipient?.accountId) {
    await clearQuickPayNotifNativeSecrets();
    return;
  }
  let pin = opts?.pin?.replace(/\D/g, "").slice(0, 4) ?? "";
  if (pin.length !== 4) {
    if (!(await hasTransactionPinVault())) {
      await clearQuickPayNotifNativeSecrets();
      return;
    }
    pin = (await readTransactionPinForNativeQuickPay()) ?? "";
  }
  if (pin.length !== 4) return;

  await syncQuickPayNotifNativeSecrets({
    apiBaseUrl: API_BASE_URL,
    accessToken: token,
    recipientJson: JSON.stringify(recipient),
    transactionPin: pin,
    balanceFcfa: Math.floor(opts?.balanceFcfa ?? -1),
    phoneDigits: String(opts?.phone ?? "").replace(/\D/g, ""),
  });
}

export async function clearQuickPayNativeRuntime(): Promise<void> {
  await clearQuickPayNotifNativeSecrets();
}
