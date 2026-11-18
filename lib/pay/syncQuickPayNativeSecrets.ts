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
import {
  hasTransactionPinVault,
  readTransactionPinForNativeQuickPay,
} from "@/lib/security/transactionPinVault";
import type { QuickPayRecipient } from "@/lib/pay/quickPayRecipient";
import { getQuickPayNearbyRecipientSnapshot } from "@/lib/pay/quickPayNearbyRecipientCache";
import { Platform } from "react-native";

/** Token + PIN + commerçant BLE affiché sur la notif (RAM). */
export async function syncQuickPayNativeRuntime(opts?: {
  pin?: string | null;
  balanceFcfa?: number;
  phone?: string;
  recipient?: QuickPayRecipient | null;
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
  let pin = opts?.pin?.replace(/\D/g, "").slice(0, 4) ?? "";
  if (pin.length !== 4) {
    if (!(await hasTransactionPinVault())) {
      await clearQuickPayNotifNativeSecrets();
      return;
    }
    pin = (await readTransactionPinForNativeQuickPay()) ?? "";
  }
  if (pin.length !== 4) return;

  const recipient =
    opts?.recipient !== undefined
      ? opts.recipient
      : getQuickPayNearbyRecipientSnapshot();
  const recipientJson =
    recipient?.accountId?.trim()
      ? JSON.stringify({
          accountId: recipient.accountId.trim(),
          name: recipient.name,
          phoneDigits: recipient.phoneDigits ?? null,
        })
      : "{}";

  await syncQuickPayNotifNativeSecrets({
    apiBaseUrl: API_BASE_URL,
    accessToken: token,
    recipientJson,
    transactionPin: pin,
    balanceFcfa: Math.floor(opts?.balanceFcfa ?? -1),
    phoneDigits: String(opts?.phone ?? "").replace(/\D/g, ""),
  });
}

export async function clearQuickPayNativeRuntime(): Promise<void> {
  await clearQuickPayNotifNativeSecrets();
}
