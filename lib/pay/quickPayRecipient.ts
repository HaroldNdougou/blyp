import * as SecureStore from "expo-secure-store";

const KEY = "blyp_quick_pay_recipient_v1";

export type QuickPayRecipient = {
  accountId: string;
  name: string;
  phoneDigits: string | null;
};

let cached: QuickPayRecipient | null | undefined;

export async function loadQuickPayRecipient(): Promise<QuickPayRecipient | null> {
  if (cached !== undefined) return cached;
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    if (!raw) {
      cached = null;
      return null;
    }
    const o = JSON.parse(raw) as QuickPayRecipient;
    const accountId = String(o?.accountId ?? "").trim();
    const name = String(o?.name ?? "").trim();
    if (!accountId || !name) {
      cached = null;
      return null;
    }
    cached = {
      accountId,
      name,
      phoneDigits: o.phoneDigits ? String(o.phoneDigits).replace(/\D/g, "").slice(-9) : null,
    };
    return cached;
  } catch {
    cached = null;
    return null;
  }
}

export function getQuickPayRecipientCached(): QuickPayRecipient | null {
  return cached === undefined ? null : cached;
}

export async function rememberQuickPayRecipient(
  input: QuickPayRecipient | null,
): Promise<void> {
  if (!input?.accountId || !input.name?.trim()) {
    cached = null;
    try {
      await SecureStore.deleteItemAsync(KEY);
    } catch {
      /* ignore */
    }
    void import("@/lib/pay/syncQuickPayNotif").then((m) =>
      m.syncQuickPayNotif({ interactive: false }),
    );
    return;
  }
  const next: QuickPayRecipient = {
    accountId: String(input.accountId).trim(),
    name: String(input.name).trim(),
    phoneDigits: input.phoneDigits
      ? String(input.phoneDigits).replace(/\D/g, "").slice(-9)
      : null,
  };
  cached = next;
  try {
    await SecureStore.setItemAsync(KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  void import("@/lib/pay/syncQuickPayNotif").then((m) =>
    m.syncQuickPayNotif({ interactive: false }),
  );
  void import("@/lib/pay/syncQuickPayNativeSecrets").then((m) =>
    m.syncQuickPayNativeRuntime(),
  );
}

export async function clearQuickPayRecipient(): Promise<void> {
  cached = null;
  try {
    await SecureStore.deleteItemAsync(KEY);
  } catch {
    /* ignore */
  }
}
