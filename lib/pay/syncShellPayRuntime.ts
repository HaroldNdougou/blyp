import { getAccessToken } from "@/lib/auth/authSession";
import type { ApiUser } from "@/lib/api/types";
import { USE_MOCK_API } from "@/lib/config";
import { getQuickPayNearbyRecipientSnapshot } from "@/lib/pay/quickPayNearbyRecipientCache";
import type { QuickPayRecipient } from "@/lib/pay/quickPayRecipient";
import {
  getQuickPayRecipientCached,
  loadQuickPayRecipient,
} from "@/lib/pay/quickPayRecipient";
import {
  hasTransactionPinVault,
  readTransactionPinForNativeQuickPay,
} from "@/lib/security/transactionPinVault";
import { Platform } from "react-native";

function toJson(r: QuickPayRecipient): object {
  return {
    accountId: r.accountId.trim(),
    name: r.name.trim(),
    phoneDigits: r.phoneDigits ?? null,
  };
}

function mergeCandidates(
  ...lists: (QuickPayRecipient | null | undefined)[]
): QuickPayRecipient[] {
  const out: QuickPayRecipient[] = [];
  const seen = new Set<string>();
  for (const r of lists) {
    const id = r?.accountId?.trim();
    const name = r?.name?.trim();
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    out.push({
      accountId: id,
      name,
      phoneDigits: r.phoneDigits ?? null,
    });
  }
  return out;
}

async function pushShellPayConfig(
  recipientJson: string,
  candidatesJson: string,
  pin: string,
  balanceFcfa: number,
): Promise<void> {
  const { NativeModules } = await import("react-native");
  const mod = NativeModules.BlypNativeShell as
    | {
        syncPayConfig?: (
          recipientJson: string,
          candidatesJson: string,
          transactionPin: string,
          balanceFcfa: number,
        ) => Promise<void>;
      }
    | undefined;
  await mod?.syncPayConfig?.(recipientJson, candidatesJson, pin, balanceFcfa);
}

/** Destinataire(s) + PIN pour payer depuis la coque native sans monter Pay RN. */
export async function syncShellPayRuntime(
  user: ApiUser | null | undefined,
): Promise<void> {
  if (Platform.OS !== "android" || USE_MOCK_API) return;
  const token = getAccessToken();
  if (!token || !user?.phone) {
    await clearShellPayRuntime();
    return;
  }
  if (!(await hasTransactionPinVault())) {
    await clearShellPayRuntime();
    return;
  }
  const pin = (await readTransactionPinForNativeQuickPay()) ?? "";
  if (pin.length !== 4) return;

  const nearby = getQuickPayNearbyRecipientSnapshot();
  const stored = getQuickPayRecipientCached() ?? (await loadQuickPayRecipient());
  const candidates = mergeCandidates(nearby, stored);
  const active = candidates[0] ?? null;
  const recipientJson = active ? JSON.stringify(toJson(active)) : "";
  const candidatesJson = JSON.stringify(candidates.map(toJson));

  await pushShellPayConfig(
    recipientJson,
    candidatesJson,
    pin,
    Math.floor(Number(user.balanceFcfa) || 0),
  );
}

export async function clearShellPayRuntime(): Promise<void> {
  if (Platform.OS !== "android") return;
  const { NativeModules } = await import("react-native");
  const mod = NativeModules.BlypNativeShell as
    | {
        syncPayConfig?: (
          recipientJson: string,
          candidatesJson: string,
          transactionPin: string,
          balanceFcfa: number,
        ) => Promise<void>;
      }
    | undefined;
  await mod?.syncPayConfig?.("", "[]", "", -1);
}
